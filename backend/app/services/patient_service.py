"""Clinic patient records and the same animal's studies (issue #108)."""

from __future__ import annotations

import threading
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.auth.tenancy import can_access_owned
from app.http_errors import api_error
from app.schemas.case import CaseRecord
from app.schemas.enums import ReportStatus
from app.schemas.patient import (
    PatientCreate,
    PatientMatch,
    PatientRecord,
    PatientStudies,
    PatientUpdate,
    PriorStudy,
)
from app.security.audit import AuditLogger, AuditOutcome
from app.services.patient_store import PatientStore

_TR_FOLD = str.maketrans({"ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g",
                          "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c"})
SEARCH_LIMIT = 20
EXCERPT_CHARS = 240
# Who may merge duplicate patient records.
MERGE_ROLES = frozenset({"admin", "clinic_owner"})
# Who may create, edit and link patients (radiologists only read).
WRITE_ROLES = frozenset({"vet", "clinic_owner", "admin", "demo", "service"})


def fold(text: str | None) -> str:
    """Case- and accent-insensitive key ("Paşa" == "pasa")."""
    return " ".join((text or "").translate(_TR_FOLD).casefold().split())


def _now() -> datetime:
    return datetime.now(timezone.utc)


_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=api_error("patient_not_found", "Patient not found."))


class PatientService:
    def __init__(
        self,
        store: PatientStore,
        cases_repo,
        *,
        tenant_isolation: bool,
        audit: AuditLogger | None = None,
    ) -> None:
        self._store = store
        self._cases = cases_repo
        self._isolation = tenant_isolation
        self._audit = audit
        self._lock = threading.RLock()

    # --- access helpers ---------------------------------------------------------------

    def _visible(self, patient: PatientRecord, principal: AuthPrincipal) -> bool:
        return patient.merged_into is None and can_access_owned(principal, patient, isolation=self._isolation)

    def _case_visible(self, case: CaseRecord, principal: AuthPrincipal) -> bool:
        return can_access_owned(principal, case, isolation=self._isolation)

    @staticmethod
    def _assert_can_write(principal: AuthPrincipal) -> None:
        if principal.via == "disabled" or principal.role in WRITE_ROLES:
            return
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=api_error("patient_write_forbidden", "Your role cannot change patient records."),
        )

    def _record(self, event: str, principal: AuthPrincipal, resource: str, detail: str | None = None) -> None:
        if self._audit is not None:
            self._audit.record(
                event_type=event,
                actor=principal.subject,
                resource=resource,
                outcome=AuditOutcome.SUCCESS,
                detail=detail,
                clinic_id=principal.clinic_id,
            )

    def _assert_unique(self, candidate: PatientRecord) -> None:
        """Microchip and clinic patient number are unique inside one clinic."""
        for field in ("microchip", "clinic_patient_no"):
            value = fold(getattr(candidate, field))
            if not value:
                continue
            for other in self._store.list():
                if (
                    other.patient_id != candidate.patient_id
                    and other.merged_into is None
                    and other.clinic_id == candidate.clinic_id
                    and fold(getattr(other, field)) == value
                ):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=api_error(
                            f"patient_{field}_taken",
                            f"Another patient in this clinic already has this {field.replace('_', ' ')}.",
                            patient_id=other.patient_id,
                        ),
                    )

    # --- CRUD -----------------------------------------------------------------------------

    def create(self, payload: PatientCreate, *, principal: AuthPrincipal) -> PatientRecord:
        self._assert_can_write(principal)
        scoped = principal.via != "disabled"
        patient = PatientRecord(
            **payload.model_dump(),
            clinic_id=principal.clinic_id if scoped else None,
            owner_subject=principal.subject if scoped else None,
        )
        with self._lock:
            self._assert_unique(patient)
            self._store.save(patient)
        self._record("patient.create", principal, patient.patient_id)
        return patient

    def get(self, patient_id: str, *, principal: AuthPrincipal) -> PatientRecord:
        patient = self._store.get(patient_id)
        if patient is None or not self._visible(patient, principal):
            raise _NOT_FOUND
        return patient

    def update(self, patient_id: str, payload: PatientUpdate, *, principal: AuthPrincipal) -> PatientRecord:
        self._assert_can_write(principal)
        with self._lock:
            current = self.get(patient_id, principal=principal)
            data = payload.model_dump(exclude_unset=True)
            if data.get("name") is None:
                data.pop("name", None)
            if data.get("species") is None:
                data.pop("species", None)
            updated = current.model_copy(update={**data, "updated_at": _now()})
            self._assert_unique(updated)
            self._store.save(updated)
        self._record("patient.update", principal, patient_id)
        return updated

    def search(self, query: str | None, *, principal: AuthPrincipal) -> list[PatientRecord]:
        q = fold(query)
        hits: list[PatientRecord] = []
        for p in reversed(self._store.list()):  # newest first
            if not self._visible(p, principal):
                continue
            if q and not any(q in fold(v) for v in (p.name, p.microchip, p.clinic_patient_no, p.breed)):
                continue
            hits.append(p)
            if len(hits) >= SEARCH_LIMIT:
                break
        return hits

    # --- studies --------------------------------------------------------------------------

    @staticmethod
    def _approved(case: CaseRecord):
        approved = [v for v in case.report_versions if v.status == ReportStatus.APPROVED]
        return max(approved, key=lambda v: v.version) if approved else None

    @staticmethod
    def _study_date(case: CaseRecord) -> str | None:
        return case.dicom_study.study_date if case.dicom_study and case.dicom_study.study_date else None

    def _sort_key(self, case: CaseRecord) -> str:
        # DICOM StudyDate (YYYYMMDD) when known, else the case creation date.
        return self._study_date(case) or case.created_at.strftime("%Y%m%d%H%M%S")

    def patient_cases(self, patient_id: str, *, principal: AuthPrincipal) -> list[CaseRecord]:
        return [
            c for c in self._cases.list_cases()
            if c.patient_id == patient_id and self._case_visible(c, principal)
        ]

    def studies(
        self, patient_id: str, *, principal: AuthPrincipal, relative_to: CaseRecord | None = None
    ) -> PatientStudies:
        patient = self.get(patient_id, principal=principal)
        rows: list[PriorStudy] = []
        for case in sorted(self.patient_cases(patient_id, principal=principal), key=self._sort_key, reverse=True):
            if relative_to is not None and case.case_id == relative_to.case_id:
                continue
            approved = self._approved(case)
            impression = approved.content.impression.text.strip() if approved else ""
            rows.append(
                PriorStudy(
                    case_id=case.case_id,
                    created_at=case.created_at,
                    study_date=self._study_date(case),
                    modality=case.modality,
                    anatomical_region=case.anatomical_region,
                    status=str(case.status.value if hasattr(case.status, "value") else case.status),
                    comparable=relative_to is not None
                    and case.modality == relative_to.modality
                    and case.anatomical_region == relative_to.anatomical_region,
                    has_dicom=bool(case.dicom_ingest_id),
                    approved_report_version=approved.version if approved else None,
                    impression_excerpt=(impression[:EXCERPT_CHARS] + "…") if len(impression) > EXCERPT_CHARS else (impression or None),
                )
            )
        if relative_to is not None:
            # Comparable studies first, each group newest first (sort is stable).
            rows.sort(key=lambda r: not r.comparable)
        return PatientStudies(patient=patient, studies=rows)

    def prior_for_report(self, case: CaseRecord) -> CaseRecord | None:
        """Most recent *approved* earlier study of the same patient, modality and region.

        Used as report context. No principal: the case itself was already authorized, and
        only cases from the same clinic (or the same unscoped demo data) are considered.
        """
        if not case.patient_id:
            return None
        current_key = self._sort_key(case)
        best: CaseRecord | None = None
        for other in self._cases.list_cases():
            if (
                other.case_id == case.case_id
                or other.patient_id != case.patient_id
                or other.clinic_id != case.clinic_id
                or other.modality != case.modality
                or other.anatomical_region != case.anatomical_region
                or self._approved(other) is None
                or self._sort_key(other) > current_key
            ):
                continue
            if best is None or self._sort_key(other) > self._sort_key(best):
                best = other
        return best

    # --- linking and matching -------------------------------------------------------------

    def resolve_for_new_case(self, patient_id: str | None, *, principal: AuthPrincipal | None) -> PatientRecord | None:
        """Validate the patient chosen in the new-case wizard."""
        if not patient_id:
            return None
        if principal is None:
            patient = self._store.get(patient_id)
            if patient is None or patient.merged_into:
                raise _NOT_FOUND
            return patient
        return self.get(patient_id, principal=principal)

    def remember_dicom_id(self, patient: PatientRecord, case: CaseRecord) -> None:
        dicom_id = (case.dicom_study.patient_id_synthetic if case.dicom_study else None) or ""
        dicom_id = dicom_id.strip()
        if dicom_id and dicom_id not in patient.dicom_patient_ids:
            self._store.save(
                patient.model_copy(update={"dicom_patient_ids": [*patient.dicom_patient_ids, dicom_id][-20:], "updated_at": _now()})
            )

    def link_case(self, case: CaseRecord, patient_id: str | None, *, principal: AuthPrincipal) -> CaseRecord:
        """Point an existing case at a patient (or clear it). The caller saves the case."""
        self._assert_can_write(principal)
        if not patient_id:
            self._record("patient.unlink_case", principal, case.case_id, detail=case.patient_id)
            return case.model_copy(update={"patient_id": None})
        patient = self.get(patient_id, principal=principal)
        if self._isolation and principal.via != "disabled" and patient.clinic_id != case.clinic_id:
            # A case is only ever linked to a patient of its own clinic.
            raise _NOT_FOUND
        self.remember_dicom_id(patient, case)
        self._record("patient.link_case", principal, case.case_id, detail=patient_id)
        return case.model_copy(update={"patient_id": patient_id})

    def suggest_for_case(self, case: CaseRecord, *, principal: AuthPrincipal) -> list[PatientMatch]:
        if case.patient_id:
            return []
        dicom_id = (case.dicom_study.patient_id_synthetic if case.dicom_study else None) or ""
        dicom_id = dicom_id.strip()
        name = fold(case.patient_name)
        matches: list[PatientMatch] = []
        seen: set[str] = set()
        candidates = [
            p for p in reversed(self._store.list())
            if self._visible(p, principal) and (case.clinic_id is None or p.clinic_id in (None, case.clinic_id))
        ]
        if dicom_id:
            for p in candidates:
                if dicom_id in p.dicom_patient_ids:
                    matches.append(PatientMatch(patient=p, reason="dicom_patient_id"))
                    seen.add(p.patient_id)
        for p in candidates:
            if p.patient_id not in seen and name and fold(p.name) == name and p.species == case.species:
                matches.append(PatientMatch(patient=p, reason="name_species"))
        return matches[:5]

    # --- merge ----------------------------------------------------------------------------

    def merge(self, keep_id: str, duplicate_id: str, *, principal: AuthPrincipal) -> PatientRecord:
        if principal.via != "disabled" and principal.role not in MERGE_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=api_error("patient_merge_forbidden", "Only a clinic owner or admin can merge patients."),
            )
        if keep_id == duplicate_id:
            raise HTTPException(
                status_code=422, detail=api_error("patient_merge_same", "Choose two different patients.")
            )
        with self._lock:
            keep = self.get(keep_id, principal=principal)
            dup = self.get(duplicate_id, principal=principal)
            if keep.clinic_id != dup.clinic_id:
                raise HTTPException(
                    status_code=422,
                    detail=api_error("patient_merge_cross_clinic", "Patients of different clinics cannot be merged."),
                )
            moved = 0
            for case in self._cases.list_cases():
                if case.patient_id == duplicate_id:
                    self._cases.save_case(case.model_copy(update={"patient_id": keep_id}))
                    moved += 1
            ids = list(dict.fromkeys([*keep.dicom_patient_ids, *dup.dicom_patient_ids]))[-20:]
            keep = keep.model_copy(
                update={
                    "dicom_patient_ids": ids,
                    "microchip": keep.microchip or dup.microchip,
                    "clinic_patient_no": keep.clinic_patient_no or dup.clinic_patient_no,
                    "updated_at": _now(),
                }
            )
            self._store.save(keep)
            self._store.save(dup.model_copy(update={"merged_into": keep_id, "updated_at": _now()}))
        self._record("patient.merge", principal, keep_id, detail=f"{duplicate_id} ({moved} cases)")
        return keep
