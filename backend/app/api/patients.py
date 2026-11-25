"""Clinic patient records and prior studies (issue #108)."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_CASE_READ, CAP_CASE_WRITE
from app.auth.visibility import case_for_principal
from app.container import AppContainer
from app.schemas.case import CaseRecord
from app.schemas.patient import (
    PatientCreate,
    PatientMatch,
    PatientMergeRequest,
    PatientRecord,
    PatientStudies,
    PatientUpdate,
    PriorStudy,
)

router = APIRouter(prefix="/api/v1", tags=["patients"], dependencies=[Depends(require_auth)])


class CasePriorStudies(BaseModel):
    """Prior-studies panel of one case. ``patient`` is None until the case is linked."""

    model_config = ConfigDict(extra="forbid")

    patient: Optional[PatientRecord] = None
    studies: list[PriorStudy] = Field(default_factory=list)
    suggestions: list[PatientMatch] = Field(default_factory=list)


class CasePatientLink(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # None unlinks the case.
    patient_id: Optional[str] = Field(default=None, max_length=40)


@router.get("/patients", response_model=list[PatientRecord])
def search_patients(
    q: str | None = Query(default=None, max_length=120),
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> list[PatientRecord]:
    return container.patients.search(q, principal=principal)


@router.post("/patients", response_model=PatientRecord, status_code=201)
def create_patient(
    payload: PatientCreate,
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_WRITE)),
) -> PatientRecord:
    return container.patients.create(payload, principal=principal)


@router.get("/patients/{patient_id}", response_model=PatientRecord)
def get_patient(
    patient_id: str,
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> PatientRecord:
    return container.patients.get(patient_id, principal=principal)


@router.patch("/patients/{patient_id}", response_model=PatientRecord)
def update_patient(
    patient_id: str,
    payload: PatientUpdate,
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_WRITE)),
) -> PatientRecord:
    return container.patients.update(patient_id, payload, principal=principal)


@router.get("/patients/{patient_id}/studies", response_model=PatientStudies)
def patient_studies(
    patient_id: str,
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> PatientStudies:
    return container.patients.studies(patient_id, principal=principal)


@router.post("/patients/{patient_id}/merge", response_model=PatientRecord)
def merge_patients(
    patient_id: str,
    payload: PatientMergeRequest,
    container: AppContainer = Depends(get_container),
    # Clinic owners merge too but have no cases:write; the service checks the role.
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> PatientRecord:
    return container.patients.merge(patient_id, payload.duplicate_patient_id, principal=principal)


@router.get("/cases/{case_id}/prior-studies", response_model=CasePriorStudies)
def case_prior_studies(
    case_id: str,
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> CasePriorStudies:
    case = container.cases.get_case(case_id, principal=principal)
    if not case.patient_id:
        return CasePriorStudies(suggestions=container.patients.suggest_for_case(case, principal=principal))
    result = container.patients.studies(case.patient_id, principal=principal, relative_to=case)
    return CasePriorStudies(patient=result.patient, studies=result.studies)


@router.put("/cases/{case_id}/patient", response_model=CaseRecord)
def link_case_patient(
    case_id: str,
    payload: CasePatientLink,
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_WRITE)),
) -> CaseRecord:
    case = container.cases.get_case(case_id, principal=principal)
    linked = container.patients.link_case(case, payload.patient_id, principal=principal)
    saved = container.repo.save_case(linked)
    return case_for_principal(saved, principal)
