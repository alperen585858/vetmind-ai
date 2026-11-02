"""Founder-only licensed clinic and owner management API."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth, require_exact_roles
from app.container import AppContainer
from app.schemas.license import (
    ClinicStaffCreate,
    ClinicStaffSummary,
    ClinicStaffUpdate,
    LicensedClinicCreate,
    LicensedClinicSummary,
    LicensedClinicUpdate,
    OwnerAccountSummary,
    OwnerAccountUpdate,
)

router = APIRouter(
    prefix="/api/v1/founder/licenses",
    tags=["founder-licenses"],
    dependencies=[Depends(require_auth), Depends(require_exact_roles("founder"))],
)


def _svc(container: AppContainer = Depends(get_container)):
    return container.licenses


@router.get("", response_model=list[LicensedClinicSummary])
def list_licensed_clinics(
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> list[LicensedClinicSummary]:
    return service.list_clinics(principal=principal)


@router.post("", response_model=LicensedClinicSummary, status_code=201)
def create_licensed_clinic(
    payload: LicensedClinicCreate,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> LicensedClinicSummary:
    return service.create_clinic(payload, principal=principal)


@router.get("/staff", response_model=list[ClinicStaffSummary])
def list_clinic_staff(
    clinic_id: str | None = None,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> list[ClinicStaffSummary]:
    """Veterinerler ve klinik adminleri (clinic_owner)."""
    return service.list_staff(principal=principal, clinic_id=clinic_id)


@router.post("/staff", response_model=ClinicStaffSummary, status_code=201)
def create_clinic_staff(
    payload: ClinicStaffCreate,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> ClinicStaffSummary:
    return service.create_staff(payload, principal=principal)


@router.patch("/staff/{email}", response_model=ClinicStaffSummary)
def update_clinic_staff(
    email: str,
    payload: ClinicStaffUpdate,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> ClinicStaffSummary:
    return service.update_staff(email, payload, principal=principal)


@router.get("/owners", response_model=list[OwnerAccountSummary])
def list_owner_accounts(
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> list[OwnerAccountSummary]:
    return service.list_owners(principal=principal)


@router.patch("/owners/{email}", response_model=OwnerAccountSummary)
def update_owner_account(
    email: str,
    payload: OwnerAccountUpdate,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> OwnerAccountSummary:
    return service.update_owner(email, payload, principal=principal)


@router.get("/{clinic_id}", response_model=LicensedClinicSummary)
def get_licensed_clinic(
    clinic_id: str,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> LicensedClinicSummary:
    return service.get_clinic(clinic_id, principal=principal)


@router.patch("/{clinic_id}", response_model=LicensedClinicSummary)
def update_licensed_clinic(
    clinic_id: str,
    payload: LicensedClinicUpdate,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> LicensedClinicSummary:
    return service.update_clinic(clinic_id, payload, principal=principal)
