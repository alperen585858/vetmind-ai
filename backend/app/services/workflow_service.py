"""Phase 14 role workflows: pets, owner submissions, vet verification, admin users."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.auth.security import DEMO_USERS, DemoUserRecord
from app.auth.tenancy import assert_case_access, can_access_owned
from app.schemas.case import CaseCreate, CaseRecord
from app.schemas.dicom import ConfirmClassificationRequest
from app.schemas.enums import AnatomicalRegion, CaseLifecycleStatus, Modality
from app.schemas.findings import StudyInfo
from app.schemas.workflow import (
    ClinicStaffStats,
    ImagingSubmission,
    ManagedUser,
    ManagedUserCreate,
    ManagedUserUpdate,
    PetCreate,
    PetHistoryEntry,
    PetMedicalHistory,
    PetRecord,
    PetUpdate,
    SubmissionCreate,
    SubmissionUpdate,
    SubmissionVetAction,
)
from app.services.activity import append_activity
from app.services.case_service import CaseService
from app.services.dicom_service import DicomService
from app.services.notification_service import NotificationService
from app.services.workflow_store import WorkflowStore


def _now() -> datetime:
    return datetime.now(timezone.utc)


class WorkflowService:
    def __init__(
        self,
        store: WorkflowStore,
        cases: CaseService,
        *,
        dicom: DicomService | None = None,
        notifications: NotificationService | None = None,
        tenant_isolation: bool = False,
        auth_users: dict[str, DemoUserRecord] | None = None,
    ) -> None:
        self._store = store
        self._cases = cases
        self._dicom = dicom
        self._notifications = notifications
        self._tenant_isolation = tenant_isolation
        self._auth_users = auth_users if auth_users is not None else dict(DEMO_USERS)
        self._seed_managed_from_demo()

    def _seed_managed_from_demo(self) -> None:
        if self._store.list_users():
            return
        for email, rec in DEMO_USERS.items():
            self._store.save_user(
                ManagedUser(
                    email=email,
                    role=rec.role,  # type: ignore[arg-type]
                    clinic_id=rec.clinic_id,
                    display_name=email.split("@")[0],
                    active=True,
                    password=rec.password,
                )
            )

    def sync_auth_directory(self) -> dict[str, DemoUserRecord]:
        """Rebuild login directory from managed users + seed fallbacks."""
        directory: dict[str, DemoUserRecord] = {}
        for u in self._store.list_users():
            if not u.active:
                continue
            pwd = u.password or (DEMO_USERS.get(u.email.lower()).password if u.email.lower() in DEMO_USERS else None)
            if not pwd:
                continue
            directory[u.email.lower()] = DemoUserRecord(pwd, u.role, u.clinic_id)
        # Keep seed users that were never overridden
        for email, rec in DEMO_USERS.items():
            directory.setdefault(email, rec)
        self._auth_users.clear()
        self._auth_users.update(directory)
        return self._auth_users

    # --- Pets ---

    def create_pet(self, payload: PetCreate, *, principal: AuthPrincipal) -> PetRecord:
        if principal.via == "jwt" and principal.role not in {"owner", "admin"}:
            raise HTTPException(status_code=403, detail="Only pet owners can create pet profiles.")
        owner = principal.subject if principal.via != "disabled" else "owner@demo.local"
        pet = PetRecord(
            owner_subject=owner,
            clinic_id=principal.clinic_id,
            name=payload.name.strip(),
            species=payload.species,
            breed=payload.breed,
            age_years=payload.age_years,
            sex=payload.sex,
            medical_history=payload.medical_history,
        )
        return self._store.save_pet(pet)

    def list_pets(self, *, principal: AuthPrincipal) -> list[PetRecord]:
        rows = self._store.list_pets()
        out: list[PetRecord] = []
        for p in rows:
            if can_access_owned(principal, p, isolation=self._tenant_isolation):
                # Pet owners only see own pets even when isolation off in demo with auth
                if principal.role == "owner" and principal.via == "jwt":
                    if p.owner_subject != principal.subject:
                        continue
                out.append(p)
            elif principal.role == "owner" and p.owner_subject == principal.subject:
                out.append(p)
        if principal.via == "disabled":
            return rows
        if principal.role in {"vet", "expert", "clinic_owner", "admin"} and self._tenant_isolation:
            return [
                p
                for p in rows
                if principal.role == "admin"
                or (p.clinic_id and p.clinic_id == principal.clinic_id)
            ]
        if principal.role == "owner":
            return [p for p in rows if p.owner_subject == principal.subject]
        return out if out else rows

    def get_pet(self, pet_id: str, *, principal: AuthPrincipal) -> PetRecord:
        pet = self._store.get_pet(pet_id)
        if pet is None:
            raise HTTPException(status_code=404, detail="Pet not found.")
        if principal.via == "disabled":
            return pet
        if principal.role == "owner" and pet.owner_subject != principal.subject:
            raise HTTPException(status_code=404, detail="Pet not found.")
        if principal.role in {"vet", "expert", "clinic_owner"} and self._tenant_isolation:
            if pet.clinic_id and principal.clinic_id and pet.clinic_id != principal.clinic_id:
                raise HTTPException(status_code=404, detail="Pet not found.")
        return pet

    def update_pet(self, pet_id: str, payload: PetUpdate, *, principal: AuthPrincipal) -> PetRecord:
        pet = self.get_pet(pet_id, principal=principal)
        if principal.role == "owner" and pet.owner_subject != principal.subject and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Cannot update another owner's pet.")
        data = payload.model_dump(exclude_unset=True)
        pet = pet.model_copy(update={**data, "updated_at": _now()})
        return self._store.save_pet(pet)

    # --- Submissions ---

    def create_submission(self, payload: SubmissionCreate, *, principal: AuthPrincipal) -> ImagingSubmission:
        pet = self.get_pet(payload.pet_id, principal=principal)
        owner = principal.subject if principal.via != "disabled" else pet.owner_subject
        if principal.role == "owner" and pet.owner_subject != owner and principal.via == "jwt":
            raise HTTPException(status_code=403, detail="Pet does not belong to you.")
        sub = ImagingSubmission(
            pet_id=pet.pet_id,
            pet_owner_subject=pet.owner_subject,
            owner_subject=pet.owner_subject,
            clinic_id=pet.clinic_id or principal.clinic_id,
            status="pending_verification",
            chief_complaint=payload.chief_complaint,
            clinical_notes=payload.clinical_notes,
        )
        saved = self._store.save_submission(sub)
        self._notify_clinic_vets(
            clinic_id=saved.clinic_id,
            kind="submission_created",
            title="Yeni görüntüleme talebi",
            body=f"{pet.name}: {saved.chief_complaint or 'Görüntüleme talebi'}",
            link_path="/basvurular",
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

    def update_submission(
        self, submission_id: str, payload: SubmissionUpdate, *, principal: AuthPrincipal
    ) -> ImagingSubmission:
        sub = self.get_submission(submission_id, principal=principal)
        if sub.status in {"verified", "linked", "rejected"}:
            raise HTTPException(status_code=409, detail="Submission is locked after vet decision.")
        if principal.role == "owner" and sub.status == "needs_info":
            sub.status = "pending_verification"
        prev_dicom = sub.dicom_ingest_id
        data = payload.model_dump(exclude_unset=True)
        sub = sub.model_copy(update={**data, "updated_at": _now()})
        saved = self._store.save_submission(sub)
        if saved.dicom_ingest_id and saved.dicom_ingest_id != prev_dicom:
            self._notify_clinic_vets(
                clinic_id=saved.clinic_id,
                kind="submission_created",
                title="DICOM eklendi",
                body=f"Başvuru {saved.submission_id} için DICOM yüklendi",
                link_path="/basvurular",
                dedupe_key=f"dicom_uploaded:{saved.submission_id}:{saved.dicom_ingest_id}",
                submission_id=saved.submission_id,
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
            sub.status = "needs_info"
            sub.missing_info_request = payload.missing_info_request or payload.vet_notes
            sub.vet_notes = payload.vet_notes
            sub.updated_at = _now()
            saved = self._store.save_submission(sub)
            self._notify_one(
                recipient=sub.pet_owner_subject,
                kind="submission_needs_info",
                title="Eksik bilgi istendi",
                body=saved.missing_info_request or "Veteriner ek bilgi istedi",
                link_path="/basvurular",
                dedupe_key=f"submission_needs_info:{saved.submission_id}:{saved.updated_at.isoformat()}",
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

    def pet_medical_history(self, pet_id: str, *, principal: AuthPrincipal) -> PetMedicalHistory:
        pet = self.get_pet(pet_id, principal=principal)
        entries: list[PetHistoryEntry] = []
        if pet.medical_history:
            entries.append(
                PetHistoryEntry(
                    at=pet.created_at,
                    kind="clinical_history",
                    title="Klinik öykü",
                    detail=pet.medical_history,
                )
            )
        for sub in self._store.list_submissions():
            if sub.pet_id != pet_id:
                continue
            if principal.role == "owner" and sub.pet_owner_subject != principal.subject and principal.via == "jwt":
                continue
            entries.append(
                PetHistoryEntry(
                    at=sub.created_at,
                    kind="submission",
                    title=f"Görüntüleme talebi ({sub.status})",
                    detail=sub.chief_complaint or sub.clinical_notes,
                    submission_id=sub.submission_id,
                    dicom_ingest_id=sub.dicom_ingest_id,
                    case_id=sub.linked_case_id,
                    link_path="/basvurular",
                )
            )
            if sub.dicom_ingest_id:
                entries.append(
                    PetHistoryEntry(
                        at=sub.updated_at,
                        kind="dicom",
                        title="DICOM incelemesi",
                        detail=sub.dicom_ingest_id,
                        submission_id=sub.submission_id,
                        dicom_ingest_id=sub.dicom_ingest_id,
                        case_id=sub.linked_case_id,
                        link_path=f"/vakalar/{sub.linked_case_id}" if sub.linked_case_id else "/basvurular",
                    )
                )
        for case in self._cases._repo.list_cases():  # noqa: SLF001
            if case.pet_id != pet_id:
                continue
            if principal.via == "jwt" and not can_access_owned(
                principal, case, isolation=self._tenant_isolation
            ):
                continue
            if principal.role == "owner" and principal.via == "jwt" and case.status != CaseLifecycleStatus.APPROVED:
                continue
            approved = case.status == CaseLifecycleStatus.APPROVED
            entries.append(
                PetHistoryEntry(
                    at=case.created_at,
                    kind="case",
                    title=f"Vaka {case.case_id}",
                    detail=f"{case.modality.value} · {case.anatomical_region.value} · {case.status.value}",
                    case_id=case.case_id,
                    dicom_ingest_id=case.dicom_ingest_id,
                    report_available=approved,
                    link_path=f"/raporlar/{case.case_id}" if approved else f"/vakalar/{case.case_id}",
                )
            )
            if approved:
                entries.append(
                    PetHistoryEntry(
                        at=case.report_available_at or case.updated_at,
                        kind="report",
                        title="Onaylı rapor",
                        detail=case.draft_report.reviewed_by if case.draft_report else None,
                        case_id=case.case_id,
                        report_available=True,
                        link_path=f"/raporlar/{case.case_id}",
                    )
                )
        entries.sort(key=lambda e: e.at, reverse=True)
        return PetMedicalHistory(pet=pet, clinical_notes=pet.medical_history, timeline=entries)

    def _notify_one(
        self,
        *,
        recipient: str | None,
        kind: str,
        title: str,
        body: str,
        link_path: str,
        dedupe_key: str,
        case_id: str | None = None,
        submission_id: str | None = None,
        clinic_id: str | None = None,
    ) -> None:
        if self._notifications is None or not recipient:
            return
        self._notifications.notify(
            recipient_subject=recipient,
            kind=kind,  # type: ignore[arg-type]
            title=title,
            body=body,
            link_path=link_path,
            dedupe_key=dedupe_key,
            case_id=case_id,
            submission_id=submission_id,
            clinic_id=clinic_id,
        )

    def _notify_clinic_vets(
        self,
        *,
        clinic_id: str | None,
        kind: str,
        title: str,
        body: str,
        link_path: str,
        dedupe_key: str,
        submission_id: str | None = None,
    ) -> None:
        if self._notifications is None:
            return
        recipients: set[str] = set()
        if self._auth_users:
            for email, rec in self._auth_users.items():
                if rec.role in {"vet", "clinic_owner", "admin"} and (
                    not clinic_id or not rec.clinic_id or rec.clinic_id == clinic_id
                ):
                    recipients.add(email)
        for u in self._store.list_users():
            if u.active and u.role in {"vet", "clinic_owner", "admin"} and (
                not clinic_id or not u.clinic_id or u.clinic_id == clinic_id
            ):
                recipients.add(u.email)
        if not recipients:
            recipients.add("vet@demo.local")
        for email in recipients:
            self._notifications.notify(
                recipient_subject=email,
                kind=kind,  # type: ignore[arg-type]
                title=title,
                body=body,
                link_path=link_path,
                dedupe_key=f"{dedupe_key}:{email}",
                submission_id=submission_id,
                clinic_id=clinic_id,
            )

    # --- Admin users / clinic ---

    def list_users(self, *, principal: AuthPrincipal) -> list[ManagedUser]:
        if principal.role not in {"admin", "clinic_owner", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Not allowed.")
        users = self._store.list_users()
        if principal.role == "clinic_owner" and principal.via == "jwt":
            users = [u for u in users if u.clinic_id == principal.clinic_id]
        # Never expose passwords
        return [u.model_copy(update={"password": None}) for u in users]

    def create_user(self, payload: ManagedUserCreate, *, principal: AuthPrincipal) -> ManagedUser:
        if principal.role not in {"admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Admin only.")
        email = payload.email.strip().lower()
        if self._store.get_user(email) or email in DEMO_USERS:
            # Allow overwrite of seed via managed store
            pass
        user = ManagedUser(
            email=email,
            role=payload.role,
            clinic_id=payload.clinic_id,
            display_name=payload.display_name or email.split("@")[0],
            active=True,
            password=payload.password,
        )
        self._store.save_user(user)
        self.sync_auth_directory()
        return user.model_copy(update={"password": None})

    def update_user(self, email: str, payload: ManagedUserUpdate, *, principal: AuthPrincipal) -> ManagedUser:
        if principal.role not in {"admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Admin only.")
        existing = self._store.get_user(email.lower())
        if existing is None and email.lower() in DEMO_USERS:
            rec = DEMO_USERS[email.lower()]
            existing = ManagedUser(
                email=email.lower(),
                role=rec.role,  # type: ignore[arg-type]
                clinic_id=rec.clinic_id,
                password=rec.password,
                display_name=email.split("@")[0],
            )
        if existing is None:
            raise HTTPException(status_code=404, detail="User not found.")
        data = payload.model_dump(exclude_unset=True)
        user = existing.model_copy(update=data)
        self._store.save_user(user)
        self.sync_auth_directory()
        return user.model_copy(update={"password": None})

    def clinic_stats(self, *, principal: AuthPrincipal) -> ClinicStaffStats:
        if principal.role not in {"clinic_owner", "vet", "admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Not allowed.")
        clinic = principal.clinic_id or "clinic-demo-a"
        cases = self._cases.list_cases(principal=principal)
        pending = [
            s
            for s in self.list_submissions(principal=principal)
            if s.status in {"pending_verification", "needs_info"}
        ]
        staff = self.list_users(principal=principal)
        return ClinicStaffStats(
            clinic_id=clinic,
            case_count=len(cases),
            awaiting_review=sum(1 for c in cases if str(c.status.value if hasattr(c.status, "value") else c.status) == "awaiting_review"),
            approved=sum(1 for c in cases if str(c.status.value if hasattr(c.status, "value") else c.status) == "approved"),
            pending_submissions=len(pending),
            staff=staff,
        )
