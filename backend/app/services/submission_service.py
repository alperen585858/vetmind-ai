"""Owner imaging submissions and veterinary verification."""

from __future__ import annotations

import re
import threading
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Literal

from fastapi import HTTPException, status

from app.auth.passwords import hash_password, is_password_hash, needs_rehash, password_policy_detail
from app.http_errors import api_error
from app.auth.principal import AuthPrincipal
from app.auth.security import DEMO_USERS, DemoUserRecord, demo_password_hash
from app.auth.tenancy import assert_case_access, can_access_owned
from app.schemas.case import CaseCreate, CaseRecord
from app.schemas.dicom import ConfirmClassificationRequest
from app.schemas.enums import AnatomicalRegion, CaseLifecycleStatus, Modality
from app.schemas.findings import StudyInfo
from app.schemas.workflow import (
    AttachmentRef,
    ClinicStaffStats,
    ImagingSubmission,
    InfoRequest,
    InfoRequestReply,
    ManagedUser,
    ManagedUserCreate,
    ManagedUserPublic,
    ManagedUserUpdate,
    PetCreate,
    PetHistoryEntry,
    PetMedicalHistory,
    PetRecord,
    PetUpdate,
    SubmissionAttach,
    SubmissionCreate,
    SubmissionUpdate,
    SubmissionVetAction,
)
from app.services.activity import append_activity
from app.services.case_service import CaseService
from app.services.dicom_service import DicomService
from app.services.notification_service import NotificationService
from app.services.workflow_store import WorkflowStore

if TYPE_CHECKING:
    from app.services.payment_service import PaymentService

from app.services.host_bound import HostBound


def _now() -> datetime:
    return datetime.now(timezone.utc)


class SubmissionService(HostBound):
    """Owner imaging submissions and veterinary verification."""

    def create_submission(self, payload: SubmissionCreate, *, principal: AuthPrincipal) -> ImagingSubmission:
        """Create a draft imaging request. Finalization requires demo payment approval."""
        pet = self.get_pet(payload.pet_id, principal=principal)
        owner = principal.subject if principal.via != "disabled" else pet.owner_subject
        if principal.role == "owner" and pet.owner_subject != owner and principal.via == "jwt":
            raise HTTPException(status_code=403, detail="Pet does not belong to you.")
        sub = ImagingSubmission(
            pet_id=pet.pet_id,
            pet_owner_subject=pet.owner_subject,
            owner_subject=pet.owner_subject,
            clinic_id=pet.clinic_id or principal.clinic_id,
            status="draft",
            chief_complaint=payload.chief_complaint,
            clinical_notes=payload.clinical_notes,
        )
        return self._store.save_submission(sub)

    def link_payment(
        self,
        submission_id: str,
        *,
        payment_id: str,
        payment_status: str,
        principal: AuthPrincipal,
    ) -> ImagingSubmission:
        sub = self.get_submission(submission_id, principal=principal)
        sub = sub.model_copy(
            update={
                "payment_id": payment_id,
                "payment_status": payment_status,
                "updated_at": _now(),
            }
        )
        return self._store.save_submission(sub)

    def finalize_submission(
        self,
        submission_id: str,
        *,
        principal: AuthPrincipal,
        payment_id: str | None = None,
    ) -> ImagingSubmission:
        """Promote draft → pending_verification after approved demo payment (idempotent)."""
        sub = self.get_submission(submission_id, principal=principal)
        if principal.via == "jwt" and principal.role == "owner":
            if sub.pet_owner_subject != principal.subject:
                raise HTTPException(status_code=404, detail="Submission not found.")

        # Already past draft — idempotent return (no duplicate notify / case).
        if sub.status in {"pending_verification", "needs_info", "verified", "linked", "rejected"}:
            return sub

        if sub.status != "draft":
            raise HTTPException(
                status_code=409,
                detail=f"Cannot finalize submission in status '{sub.status}'.",
            )

        if self._payments is None:
            raise HTTPException(status_code=500, detail="Payment service not configured.")
        payment = self._payments.assert_approved_for_submission(sub.submission_id)
        if payment_id and payment.payment_id != payment_id:
            raise HTTPException(status_code=409, detail="Payment does not match submission.")

        pet = self.get_pet(sub.pet_id, principal=principal)
        sub = sub.model_copy(
            update={
                "status": "pending_verification",
                "payment_id": payment.payment_id,
                "payment_status": payment.status,
                "updated_at": _now(),
            }
        )
        saved = self._store.save_submission(sub)
        self._notify_clinic_vets(
            clinic_id=saved.clinic_id,
            kind="submission_created",
            title="Yeni görüntüleme talebi",
            body=f"{pet.name}: {saved.chief_complaint or 'Görüntüleme talebi'}",
            link_path=f"/basvurular/{saved.submission_id}",
            dedupe_key=f"submission_created:{saved.submission_id}",
            submission_id=saved.submission_id,
        )
        return saved

    def list_submissions(
        self,
        *,
        principal: AuthPrincipal,
        status_filter: str | None = None,
    ) -> list[ImagingSubmission]:
        rows = self._store.list_submissions()
        out: list[ImagingSubmission] = []
        for s in rows:
            if status_filter and s.status != status_filter:
                continue
            # Unpaid drafts stay private to the owner until demo payment finalizes.
            if (
                s.status == "draft"
                and principal.via != "disabled"
                and principal.role in {"vet", "clinic_owner", "expert"}
            ):
                continue
            if principal.via == "disabled":
                out.append(s)
                continue
            if principal.role == "owner":
                if s.pet_owner_subject == principal.subject:
                    out.append(s)
            elif principal.role in {"vet", "clinic_owner", "admin", "expert"}:
                if not self._tenant_isolation or principal.role == "admin":
                    out.append(s)
                elif s.clinic_id and s.clinic_id == principal.clinic_id:
                    out.append(s)
        return out

    def get_submission(self, submission_id: str, *, principal: AuthPrincipal) -> ImagingSubmission:
        sub = self._store.get_submission(submission_id)
        if sub is None:
            raise HTTPException(status_code=404, detail="Submission not found.")
        if principal.via == "disabled":
            return sub
        if principal.role == "owner" and sub.pet_owner_subject != principal.subject:
            raise HTTPException(status_code=404, detail="Submission not found.")
        if (
            principal.role in {"vet", "clinic_owner", "expert"}
            and self._tenant_isolation
            and sub.clinic_id
            and principal.clinic_id
            and sub.clinic_id != principal.clinic_id
        ):
            raise HTTPException(status_code=404, detail="Submission not found.")
        return sub

    def delete_submission(self, submission_id: str, *, principal: AuthPrincipal) -> None:
        """Remove a submission from the list. Linked clinical cases are kept; submission row is deleted."""
        sub = self.get_submission(submission_id, principal=principal)
        if principal.via == "jwt":
            if principal.role == "owner":
                if sub.pet_owner_subject != principal.subject:
                    raise HTTPException(status_code=404, detail="Submission not found.")
            elif principal.role not in {"vet", "clinic_owner", "admin", "demo", "service"}:
                raise HTTPException(status_code=403, detail="Not allowed to delete submissions.")
        if sub.status == "linked" and sub.linked_case_id:
            raise HTTPException(
                status_code=409,
                detail="Cannot delete a submission already linked to a clinical case.",
            )
        if not self._store.delete_submission(submission_id):
            raise HTTPException(status_code=404, detail="Submission not found.")

    def update_submission(
        self, submission_id: str, payload: SubmissionUpdate, *, principal: AuthPrincipal
    ) -> ImagingSubmission:
        sub = self.get_submission(submission_id, principal=principal)
        if sub.status in {"verified", "linked", "rejected"}:
            raise HTTPException(status_code=409, detail="Submission is locked after vet decision.")
        answering = principal.role == "owner" and sub.status == "needs_info"
        if answering:
            sub.status = "pending_verification"
            # Answer all OPEN info requests when owner updates clinical notes.
            now = _now()
            answered_ids: list[str] = []
            updated_reqs: list[InfoRequest] = []
            for irq in sub.info_requests:
                if irq.status == "OPEN":
                    reply_body = payload.clinical_notes or payload.chief_complaint or "Yanıtlandı"
                    updated_reqs.append(
                        irq.model_copy(
                            update={
                                "status": "ANSWERED",
                                "reply": reply_body,
                                "answered_at": now,
                            }
                        )
                    )
                    answered_ids.append(irq.request_id)
                else:
                    updated_reqs.append(irq)
            sub.info_requests = updated_reqs
            for rid in answered_ids:
                self._notify_clinic_vets(
                    clinic_id=sub.clinic_id,
                    kind="info_request_answered",
                    title="Eksik bilgi yanıtlandı",
                    body=f"Başvuru {sub.submission_id}",
                    link_path="/basvurular",
                    dedupe_key=f"info_request_answered:{sub.submission_id}:{rid}",
                    submission_id=sub.submission_id,
                )
        prev_dicom = sub.dicom_ingest_id
        prev_doc = sub.document_ingest_id
        data = payload.model_dump(exclude_unset=True)
        # Preserve primary ids when already set; extras go via attach_submission.
        if prev_dicom and data.get("dicom_ingest_id") and data["dicom_ingest_id"] != prev_dicom:
            att = AttachmentRef(
                kind="dicom",
                ingest_id=data.pop("dicom_ingest_id"),
                uploaded_by=principal.subject,
            )
            sub.attachments = [*sub.attachments, att]
            self._notify_clinic_vets(
                clinic_id=sub.clinic_id,
                kind="attachment_added",
                title="Ek DICOM yüklendi",
                body=f"Başvuru {sub.submission_id}",
                link_path="/basvurular",
                dedupe_key=f"attachment_added:{sub.submission_id}:{att.attachment_id}",
                submission_id=sub.submission_id,
            )
        if prev_doc and data.get("document_ingest_id") and data["document_ingest_id"] != prev_doc:
            att = AttachmentRef(
                kind="document",
                ingest_id=data.pop("document_ingest_id"),
                uploaded_by=principal.subject,
            )
            sub.attachments = [*sub.attachments, att]
            self._notify_clinic_vets(
                clinic_id=sub.clinic_id,
                kind="attachment_added",
                title="Ek belge yüklendi",
                body=f"Başvuru {sub.submission_id}",
                link_path="/basvurular",
                dedupe_key=f"attachment_added:{sub.submission_id}:{att.attachment_id}",
                submission_id=sub.submission_id,
            )
        sub = sub.model_copy(update={**data, "updated_at": _now(), "info_requests": sub.info_requests, "attachments": sub.attachments, "status": sub.status})
        saved = self._store.save_submission(sub)
        if saved.dicom_ingest_id and saved.dicom_ingest_id != prev_dicom:
            self._notify_clinic_vets(
                clinic_id=saved.clinic_id,
                kind="attachment_added",
                title="DICOM eklendi",
                body=f"Başvuru {saved.submission_id} için DICOM yüklendi",
                link_path="/basvurular",
                dedupe_key=f"dicom_uploaded:{saved.submission_id}:{saved.dicom_ingest_id}",
                submission_id=saved.submission_id,
            )
        return saved

    def attach_submission(
        self, submission_id: str, payload: SubmissionAttach, *, principal: AuthPrincipal
    ) -> ImagingSubmission:
        """Add DICOM/document to an open submission without orphaning prior ingests."""
        sub = self.get_submission(submission_id, principal=principal)
        if sub.status in {"verified", "linked", "rejected"}:
            raise HTTPException(status_code=409, detail="Submission is locked after vet decision.")
        if principal.role not in {"owner", "vet", "clinic_owner", "admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Not allowed to attach files.")
        existing_ids = {a.ingest_id for a in sub.attachments}
        if sub.dicom_ingest_id:
            existing_ids.add(sub.dicom_ingest_id)
        if sub.document_ingest_id:
            existing_ids.add(sub.document_ingest_id)
        if payload.ingest_id in existing_ids:
            return sub
        att = AttachmentRef(
            kind=payload.kind,
            ingest_id=payload.ingest_id,
            uploaded_by=principal.subject,
            label=payload.label,
        )
        if payload.kind == "dicom" and not sub.dicom_ingest_id:
            sub.dicom_ingest_id = payload.ingest_id
        elif payload.kind == "document" and not sub.document_ingest_id:
            sub.document_ingest_id = payload.ingest_id
        sub.attachments = [*sub.attachments, att]
        sub.updated_at = _now()
        saved = self._store.save_submission(sub)
        # Draft uploads stay quiet until demo payment finalizes the request.
        if saved.status != "draft":
            self._notify_clinic_vets(
                clinic_id=saved.clinic_id,
                kind="attachment_added",
                title="Dosya eklendi" if payload.kind == "document" else "DICOM eklendi",
                body=f"Başvuru {saved.submission_id}",
                link_path="/basvurular",
                dedupe_key=f"attachment_added:{saved.submission_id}:{att.attachment_id}",
                submission_id=saved.submission_id,
            )
        return saved

    def reply_info_request(
        self,
        submission_id: str,
        request_id: str,
        payload: InfoRequestReply,
        *,
        principal: AuthPrincipal,
    ) -> ImagingSubmission:
        sub = self.get_submission(submission_id, principal=principal)
        if principal.role == "owner" and sub.pet_owner_subject != principal.subject and principal.via == "jwt":
            raise HTTPException(status_code=403, detail="Not allowed.")
        found = False
        updated: list[InfoRequest] = []
        for irq in sub.info_requests:
            if irq.request_id == request_id:
                if irq.status == "CLOSED":
                    raise HTTPException(status_code=409, detail="Info request is closed.")
                found = True
                updated.append(
                    irq.model_copy(
                        update={
                            "status": "ANSWERED",
                            "reply": payload.reply,
                            "answered_at": _now(),
                        }
                    )
                )
            else:
                updated.append(irq)
        if not found:
            raise HTTPException(status_code=404, detail="Info request not found.")
        sub.info_requests = updated
        if sub.status == "needs_info":
            sub.status = "pending_verification"
        if payload.reply and not (sub.clinical_notes or "").strip():
            sub.clinical_notes = payload.reply
        elif payload.reply:
            sub.clinical_notes = f"{(sub.clinical_notes or '').rstrip()}\n\n[Yanıt] {payload.reply}".strip()
        sub.updated_at = _now()
        saved = self._store.save_submission(sub)
        self._notify_clinic_vets(
            clinic_id=saved.clinic_id,
            kind="info_request_answered",
            title="Bilgi isteği yanıtlandı",
            body=payload.reply[:200],
            link_path="/basvurular",
            dedupe_key=f"info_request_answered:{saved.submission_id}:{request_id}",
            submission_id=saved.submission_id,
        )
        return saved

    def close_info_request(
        self, submission_id: str, request_id: str, *, principal: AuthPrincipal
    ) -> ImagingSubmission:
        if principal.role not in {"vet", "clinic_owner", "admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Only veterinarians can close info requests.")
        sub = self.get_submission(submission_id, principal=principal)
        found = False
        updated: list[InfoRequest] = []
        for irq in sub.info_requests:
            if irq.request_id == request_id:
                found = True
                updated.append(
                    irq.model_copy(update={"status": "CLOSED", "closed_at": _now()})
                )
            else:
                updated.append(irq)
        if not found:
            raise HTTPException(status_code=404, detail="Info request not found.")
        sub.info_requests = updated
        sub.updated_at = _now()
        saved = self._store.save_submission(sub)
        self._notify_one(
            recipient=saved.pet_owner_subject,
            kind="info_request_closed",
            title="Bilgi isteği kapatıldı",
            body=f"Başvuru {saved.submission_id}",
            link_path="/basvurular",
            dedupe_key=f"info_request_closed:{saved.submission_id}:{request_id}",
            submission_id=saved.submission_id,
            clinic_id=saved.clinic_id,
        )
        return saved

    def vet_action(
        self, submission_id: str, payload: SubmissionVetAction, *, principal: AuthPrincipal
    ) -> ImagingSubmission | CaseRecord:
        if principal.role not in {"vet", "admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Only veterinarians can verify submissions.")
        sub = self.get_submission(submission_id, principal=principal)
        if sub.status not in {"pending_verification", "needs_info"}:
            raise HTTPException(status_code=409, detail=f"Cannot act on submission in status '{sub.status}'.")

        if payload.action == "request_info":
            body = (payload.missing_info_request or payload.vet_notes or "Lütfen eksik bilgileri tamamlayın.").strip()
            sub.status = "needs_info"
            sub.missing_info_request = body
            sub.vet_notes = payload.vet_notes
            irq = InfoRequest(
                status="OPEN",
                from_role=principal.role,
                from_subject=principal.subject,
                to_role="owner",
                body=body,
            )
            sub.info_requests = [*sub.info_requests, irq]
            sub.updated_at = _now()
            saved = self._store.save_submission(sub)
            self._notify_one(
                recipient=sub.pet_owner_subject,
                kind="submission_needs_info",
                title="Eksik bilgi istendi",
                body=saved.missing_info_request or "Veteriner ek bilgi istedi",
                link_path="/basvurular",
                dedupe_key=f"submission_needs_info:{saved.submission_id}:{irq.request_id}",
                submission_id=saved.submission_id,
                clinic_id=saved.clinic_id,
            )
            self._notify_one(
                recipient=sub.pet_owner_subject,
                kind="info_request_opened",
                title="Bilgi isteği açıldı",
                body=body[:200],
                link_path="/basvurular",
                dedupe_key=f"info_request_opened:{saved.submission_id}:{irq.request_id}",
                submission_id=saved.submission_id,
                clinic_id=saved.clinic_id,
            )
            return saved

        if payload.action == "reject":
            sub.status = "rejected"
            sub.vet_notes = payload.vet_notes
            sub.verified_by = principal.subject
            sub.verified_at = _now()
            sub.updated_at = _now()
            saved = self._store.save_submission(sub)
            self._notify_one(
                recipient=sub.pet_owner_subject,
                kind="submission_rejected",
                title="Başvuru reddedildi",
                body=saved.vet_notes or "Veteriner başvuruyu reddetti",
                link_path="/basvurular",
                dedupe_key=f"submission_rejected:{saved.submission_id}",
                submission_id=saved.submission_id,
                clinic_id=saved.clinic_id,
            )
            return saved

        # accept → create case (clinical processing only after verification)
        pet = self.get_pet(sub.pet_id, principal=principal)
        history = "\n".join(
            x
            for x in [
                sub.chief_complaint,
                sub.clinical_notes,
                pet.medical_history,
                payload.vet_notes,
            ]
            if x
        ) or "Owner imaging request (vet verified)."

        # Prefer proper DICOM confirm so quarantine study + modality bind to the case.
        if sub.dicom_ingest_id and self._dicom is not None:
            try:
                case = self._dicom.confirm(
                    sub.dicom_ingest_id,
                    ConfirmClassificationRequest(
                        accept_suggestion=True,
                        patient_name=pet.name,
                        clinical_history=history,
                        imaging_source_permission_verified=True,
                        imaging_analysis_consent_verified=True,
                        owner_name=pet.name,
                        owner_email=sub.pet_owner_subject,
                        owner_email_consent=True,
                        pet_owner_subject=sub.pet_owner_subject,
                    ),
                    principal=principal,
                )
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Owner DICOM could not be confirmed onto a case: {exc}",
                ) from exc
        else:
            case = self._cases.create_case(
                CaseCreate(
                    patient_name=pet.name,
                    species=pet.species,
                    breed=pet.breed,
                    patient_age_years=pet.age_years,
                    modality=Modality.OTHER,
                    anatomical_region=AnatomicalRegion.UNKNOWN,
                    clinical_history=history,
                    priority="normal",
                    assigned_reviewer_id=payload.assigned_reviewer_id,
                    study=StudyInfo(dicom_available=False),
                    referring_clinic=sub.clinic_id,
                    owner_name=pet.name,
                    owner_email=sub.pet_owner_subject,
                    owner_email_consent=True,
                    pet_owner_subject=sub.pet_owner_subject,
                ),
                principal=principal,
            )

        case.pet_id = pet.pet_id
        case.pet_owner_subject = sub.pet_owner_subject
        # Keep case ownership on the pet owner (not the verifying vet) for ACL + UI "Sahip".
        case.owner_subject = sub.pet_owner_subject or case.owner_subject
        case.submission_id = sub.submission_id
        case.vet_verified = True
        case.patient_age_years = pet.age_years
        case.breed = pet.breed or case.breed
        if payload.assigned_reviewer_id:
            case.assigned_reviewer_id = payload.assigned_reviewer_id
        if sub.dicom_ingest_id and not case.dicom_ingest_id:
            case.dicom_ingest_id = sub.dicom_ingest_id
        # Carry forward ALL submission DICOM/document attachments onto the verified case.
        merged_atts = list(case.attachment_refs)
        seen_ingests = {a.ingest_id for a in merged_atts}
        if sub.dicom_ingest_id and sub.dicom_ingest_id not in seen_ingests:
            merged_atts.append(
                AttachmentRef(
                    kind="dicom",
                    ingest_id=sub.dicom_ingest_id,
                    uploaded_by=sub.pet_owner_subject,
                    label="primary_dicom",
                )
            )
            seen_ingests.add(sub.dicom_ingest_id)
        for att in sub.attachments:
            if att.ingest_id in seen_ingests:
                continue
            merged_atts.append(att)
            seen_ingests.add(att.ingest_id)
        if sub.document_ingest_id and sub.document_ingest_id not in seen_ingests:
            merged_atts.append(
                AttachmentRef(
                    kind="document",
                    ingest_id=sub.document_ingest_id,
                    uploaded_by=sub.pet_owner_subject,
                    label="submission_document",
                )
            )
        case.attachment_refs = merged_atts
        # Phase 20: merge all linked DICOM study metadata for AI packaging / IntegrationBridge.
        try:
            from app.models.dicom_study_merge import merge_case_dicom_attachments

            case = merge_case_dicom_attachments(case, self._cases._repo)  # noqa: SLF001
        except Exception:
            pass
        actor = principal.subject
        append_activity(case, kind="submission_created", actor_subject=sub.pet_owner_subject, detail=sub.submission_id)
        if sub.dicom_ingest_id:
            append_activity(case, kind="dicom_uploaded", actor_subject=sub.pet_owner_subject, detail=sub.dicom_ingest_id)
        append_activity(case, kind="vet_verified", actor_subject=actor, detail="accept")
        if case.assigned_reviewer_id:
            append_activity(
                case,
                kind="radiologist_assigned",
                actor_subject=actor,
                detail=case.assigned_reviewer_id,
            )
        case.updated_at = _now()
        self._cases._repo.save_case(case)  # noqa: SLF001 — same process persistence

        sub.status = "linked"
        sub.linked_case_id = case.case_id
        sub.assigned_reviewer_id = payload.assigned_reviewer_id
        sub.verified_by = principal.subject
        sub.verified_at = _now()
        sub.vet_notes = payload.vet_notes
        sub.updated_at = _now()
        self._store.save_submission(sub)

        self._notify_one(
            recipient=sub.pet_owner_subject,
            kind="submission_verified",
            title="Başvuru doğrulandı",
            body=f"Vaka açıldı: {case.case_id}",
            link_path=f"/vakalar/{case.case_id}",
            dedupe_key=f"submission_verified:{sub.submission_id}",
            case_id=case.case_id,
            submission_id=sub.submission_id,
            clinic_id=sub.clinic_id,
        )
        if case.assigned_reviewer_id:
            urgent = case.priority in {"urgent", "stat"}
            self._notify_one(
                recipient=case.assigned_reviewer_id,
                kind="urgent_assignment" if urgent else "radiologist_assigned",
                title="STAT atama" if case.priority == "stat" else ("Acil atama" if urgent else "Radyolog ataması"),
                body=f"{case.patient_name} · {case.case_id}",
                link_path=f"/vakalar/{case.case_id}/calisma",
                dedupe_key=f"radiologist_assigned:{case.case_id}:{case.assigned_reviewer_id}",
                case_id=case.case_id,
                clinic_id=case.clinic_id,
            )

        if payload.run_analyze:
            try:
                self._cases.analyze(case.case_id, principal=principal)
                case = self._cases.get_case(case.case_id, principal=principal)
            except HTTPException:
                # Case is still linked; analyze can be retried from UI.
                pass
        return case

