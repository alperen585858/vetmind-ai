"""Pet profiles and medical history. WorkflowService delegates these methods."""

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


class PetService(HostBound):
    """Pet profiles and medical history. WorkflowService delegates these methods."""

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

