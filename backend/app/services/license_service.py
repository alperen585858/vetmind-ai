"""Founder license / clinic registry + owner account summaries."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Optional
from uuid import uuid4

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.schemas.license import (
    ClinicStaffCreate,
    ClinicStaffSummary,
    ClinicStaffUpdate,
    LicensedClinic,
    LicensedClinicCreate,
    LicensedClinicSummary,
    LicensedClinicUpdate,
    OwnerAccountSummary,
    OwnerAccountUpdate,
    utcnow,
)
from app.schemas.workflow import ManagedUserCreate, ManagedUserUpdate
from app.security.audit import AuditLogger, AuditOutcome
from app.services.license_store import LicenseStore

STAFF_ROLES = frozenset({"vet", "clinic_owner"})

if TYPE_CHECKING:
    from app.services.repository import CaseRepository
    from app.services.workflow_service import WorkflowService


def _slug_clinic_id(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-") or "clinic"
    base = base[:48]
    return f"{base}-{uuid4().hex[:6]}"


class LicenseService:
    def __init__(
        self,
        store: LicenseStore,
        *,
        workflow: "WorkflowService | None" = None,
        cases_repo: "CaseRepository | None" = None,
        audit: AuditLogger | None = None,
    ) -> None:
        self._store = store
        self._workflow = workflow
        self._cases_repo = cases_repo
        self._audit = audit

    def bind_workflow(self, workflow: "WorkflowService") -> None:
        self._workflow = workflow

    def bind_cases_repo(self, repo: "CaseRepository") -> None:
        self._cases_repo = repo

    def _require_founder(self, principal: AuthPrincipal) -> None:
        if principal.via == "disabled":
            return
        if principal.role != "founder":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Founder only.",
            )

    def _audit_event(
        self,
        *,
        event_type: str,
        actor: str,
        resource: str,
        outcome: AuditOutcome | str = AuditOutcome.SUCCESS,
        detail: str | None = None,
        clinic_id: str | None = None,
    ) -> None:
        if self._audit is None:
            return
        self._audit.record(
            event_type=event_type,
            actor=actor,
            resource=resource,
            outcome=outcome,
            detail=detail,
            clinic_id=clinic_id,
        )

    def is_clinic_login_allowed(self, clinic_id: str | None, *, role: str) -> bool:
        """Inactive clinics block non-founder/admin logins for that clinic_id."""
        if not clinic_id:
            return True
        if role in {"founder", "admin"}:
            return True
        clinic = self._store.get_clinic(clinic_id)
        if clinic is None:
            return True
        return clinic.status != "inactive"

    def _clinic_name(self, clinic_id: str | None) -> str | None:
        if not clinic_id:
            return None
        row = self._store.get_clinic(clinic_id)
        return row.name if row else None

    def _summarize(self, clinic: LicensedClinic) -> LicensedClinicSummary:
        staff_count = 0
        vet_count = 0
        clinic_owner_count = 0
        case_count = 0
        submission_count = 0
        if self._workflow is not None:
            users = self._workflow._store.list_users()  # noqa: SLF001 — internal metrics
            clinic_users = [u for u in users if u.clinic_id == clinic.clinic_id and u.active]
            staff_count = sum(1 for u in clinic_users if u.role in STAFF_ROLES)
            vet_count = sum(1 for u in clinic_users if u.role == "vet")
            clinic_owner_count = sum(1 for u in clinic_users if u.role == "clinic_owner")
            submissions = self._workflow._store.list_submissions()  # noqa: SLF001
            submission_count = sum(1 for s in submissions if s.clinic_id == clinic.clinic_id)
        if self._cases_repo is not None:
            case_count = sum(
                1 for c in self._cases_repo.list_cases() if getattr(c, "clinic_id", None) == clinic.clinic_id
            )
        return LicensedClinicSummary(
            clinic_id=clinic.clinic_id,
            name=clinic.name,
            status=clinic.status,
            created_at=clinic.created_at,
            updated_at=clinic.updated_at,
            created_by=clinic.created_by,
            staff_count=staff_count,
            vet_count=vet_count,
            clinic_owner_count=clinic_owner_count,
            case_count=case_count,
            submission_count=submission_count,
        )

    def list_clinics(self, *, principal: AuthPrincipal) -> list[LicensedClinicSummary]:
        self._require_founder(principal)
        return [self._summarize(c) for c in self._store.list_clinics()]

    def get_clinic(self, clinic_id: str, *, principal: AuthPrincipal) -> LicensedClinicSummary:
        self._require_founder(principal)
        clinic = self._store.get_clinic(clinic_id)
        if clinic is None:
            raise HTTPException(status_code=404, detail="Clinic not found.")
        return self._summarize(clinic)

    def create_clinic(self, payload: LicensedClinicCreate, *, principal: AuthPrincipal) -> LicensedClinicSummary:
        self._require_founder(principal)
        clinic_id = (payload.clinic_id or "").strip() or _slug_clinic_id(payload.name)
        if self._store.get_clinic(clinic_id) is not None:
            raise HTTPException(status_code=409, detail="Clinic id already exists.")
        actor = principal.subject if principal.via != "disabled" else "demo"
        clinic = LicensedClinic(
            clinic_id=clinic_id,
            name=payload.name.strip(),
            status="active",
            created_by=actor,
        )
        self._store.save_clinic(clinic)

        if payload.clinic_owner_email and self._workflow is not None:
            password = payload.clinic_owner_password or "demo1234"
            self._workflow.create_user(
                ManagedUserCreate(
                    email=payload.clinic_owner_email.strip().lower(),
                    password=password,
                    role="clinic_owner",
                    clinic_id=clinic_id,
                    display_name=payload.clinic_owner_email.split("@")[0],
                ),
                principal=principal,
            )

        self._audit_event(
            event_type="license.clinic.create",
            actor=actor,
            resource=f"/founder/licenses/{clinic_id}",
            clinic_id=clinic_id,
            detail=clinic.name,
        )
        return self._summarize(clinic)

    def update_clinic(
        self,
        clinic_id: str,
        payload: LicensedClinicUpdate,
        *,
        principal: AuthPrincipal,
    ) -> LicensedClinicSummary:
        self._require_founder(principal)
        clinic = self._store.get_clinic(clinic_id)
        if clinic is None:
            raise HTTPException(status_code=404, detail="Clinic not found.")
        data = payload.model_dump(exclude_unset=True)
        if "name" in data and data["name"] is not None:
            data["name"] = data["name"].strip()
        data["updated_at"] = utcnow()
        updated = clinic.model_copy(update=data)
        self._store.save_clinic(updated)
        actor = principal.subject if principal.via != "disabled" else "demo"
        self._audit_event(
            event_type="license.clinic.update",
            actor=actor,
            resource=f"/founder/licenses/{clinic_id}",
            clinic_id=clinic_id,
            detail=str(data),
        )
        return self._summarize(updated)

    def list_staff(
        self,
        *,
        principal: AuthPrincipal,
        clinic_id: str | None = None,
    ) -> list[ClinicStaffSummary]:
        """List veterinarians and clinic admins (optionally filtered by clinic)."""
        self._require_founder(principal)
        if self._workflow is None:
            return []
        users = [
            u
            for u in self._workflow._store.list_users()  # noqa: SLF001
            if u.role in STAFF_ROLES and (clinic_id is None or u.clinic_id == clinic_id)
        ]
        cases = self._cases_repo.list_cases() if self._cases_repo is not None else []
        out: list[ClinicStaffSummary] = []
        for u in users:
            email = u.email.lower()
            if u.role == "vet":
                case_count = sum(
                    1 for c in cases if (getattr(c, "owner_subject", None) or "").lower() == email
                )
            else:
                case_count = sum(
                    1 for c in cases if getattr(c, "clinic_id", None) == u.clinic_id
                )
            out.append(
                ClinicStaffSummary(
                    email=u.email,
                    display_name=u.display_name,
                    role=u.role,  # type: ignore[arg-type]
                    active=u.active,
                    clinic_id=u.clinic_id,
                    clinic_name=self._clinic_name(u.clinic_id),
                    case_count=case_count,
                )
            )
        return sorted(out, key=lambda s: (s.clinic_id or "", s.role, s.email.lower()))

    def create_staff(self, payload: ClinicStaffCreate, *, principal: AuthPrincipal) -> ClinicStaffSummary:
        self._require_founder(principal)
        if self._workflow is None:
            raise HTTPException(status_code=500, detail="Workflow not wired.")
        clinic = self._store.get_clinic(payload.clinic_id)
        if clinic is None:
            raise HTTPException(status_code=404, detail="Clinic not found. Create the license first.")
        if clinic.status == "inactive":
            raise HTTPException(status_code=400, detail="Cannot add staff to an inactive clinic.")
        created = self._workflow.create_user(
            ManagedUserCreate(
                email=payload.email.strip().lower(),
                password=payload.password,
                role=payload.role,
                clinic_id=payload.clinic_id,
                display_name=payload.display_name or payload.email.split("@")[0],
            ),
            principal=principal,
        )
        actor = principal.subject if principal.via != "disabled" else "demo"
        self._audit_event(
            event_type="license.staff.create",
            actor=actor,
            resource=f"/founder/licenses/staff/{created.email}",
            clinic_id=payload.clinic_id,
            detail=f"{payload.role}:{created.email}",
        )
        rows = {s.email.lower(): s for s in self.list_staff(principal=principal)}
        row = rows.get(created.email.lower())
        if row is None:
            raise HTTPException(status_code=500, detail="Staff created but not readable.")
        return row

    def update_staff(
        self,
        email: str,
        payload: ClinicStaffUpdate,
        *,
        principal: AuthPrincipal,
    ) -> ClinicStaffSummary:
        self._require_founder(principal)
        if self._workflow is None:
            raise HTTPException(status_code=500, detail="Workflow not wired.")
        existing = self._workflow._store.get_user(email.lower())  # noqa: SLF001
        if existing is None:
            raise HTTPException(status_code=404, detail="Staff account not found.")
        if existing.role not in STAFF_ROLES:
            raise HTTPException(status_code=400, detail="Target account is not vet or clinic_owner.")
        data = payload.model_dump(exclude_unset=True)
        if "clinic_id" in data and data["clinic_id"]:
            clinic = self._store.get_clinic(data["clinic_id"])
            if clinic is None:
                raise HTTPException(status_code=404, detail="Clinic not found.")
        self._workflow.update_user(email, ManagedUserUpdate(**data), principal=principal)
        actor = principal.subject if principal.via != "disabled" else "demo"
        self._audit_event(
            event_type="license.staff.update",
            actor=actor,
            resource=f"/founder/licenses/staff/{email.lower()}",
            clinic_id=data.get("clinic_id") or existing.clinic_id,
            detail=str(data),
        )
        rows = {s.email.lower(): s for s in self.list_staff(principal=principal)}
        row = rows.get(email.lower())
        if row is None:
            raise HTTPException(status_code=404, detail="Staff account not found.")
        return row

    def list_owners(self, *, principal: AuthPrincipal) -> list[OwnerAccountSummary]:
        self._require_founder(principal)
        if self._workflow is None:
            return []
        users = [u for u in self._workflow._store.list_users() if u.role == "owner"]  # noqa: SLF001
        pets = self._workflow._store.list_pets()  # noqa: SLF001
        submissions = self._workflow._store.list_submissions()  # noqa: SLF001
        cases = self._cases_repo.list_cases() if self._cases_repo is not None else []
        out: list[OwnerAccountSummary] = []
        for u in users:
            email = u.email.lower()
            pet_count = sum(1 for p in pets if p.owner_subject.lower() == email)
            submission_count = sum(1 for s in submissions if s.pet_owner_subject.lower() == email)
            case_count = sum(
                1
                for c in cases
                if (getattr(c, "pet_owner_subject", None) or "").lower() == email
            )
            out.append(
                OwnerAccountSummary(
                    email=u.email,
                    display_name=u.display_name,
                    active=u.active,
                    clinic_id=u.clinic_id,
                    pet_count=pet_count,
                    submission_count=submission_count,
                    case_count=case_count,
                )
            )
        return sorted(out, key=lambda o: o.email.lower())

    def update_owner(
        self,
        email: str,
        payload: OwnerAccountUpdate,
        *,
        principal: AuthPrincipal,
    ) -> OwnerAccountSummary:
        self._require_founder(principal)
        if self._workflow is None:
            raise HTTPException(status_code=500, detail="Workflow not wired.")
        existing = self._workflow._store.get_user(email.lower())  # noqa: SLF001
        if existing is None:
            raise HTTPException(status_code=404, detail="Owner not found.")
        if existing.role != "owner":
            raise HTTPException(status_code=400, detail="Target account is not an owner.")
        self._workflow.update_user(
            email,
            ManagedUserUpdate(active=payload.active),
            principal=principal,
        )
        owners = {o.email.lower(): o for o in self.list_owners(principal=principal)}
        row = owners.get(email.lower())
        if row is None:
            raise HTTPException(status_code=404, detail="Owner not found.")
        return row
