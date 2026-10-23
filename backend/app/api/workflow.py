"""Phase 14 APIs — pets, imaging submissions, clinic stats, admin users."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import (
    CAP_ADMIN,
    CAP_CASE_READ,
    CAP_CLINIC_MANAGE,
    CAP_PETS,
    CAP_SUBMISSIONS,
    CAP_USERS_ADMIN,
)
from app.container import AppContainer
from app.schemas.case import CaseRecord
from app.schemas.workflow import (
    ClinicStaffStats,
    ImagingSubmission,
    InfoRequestReply,
    ManagedUser,
    ManagedUserCreate,
    ManagedUserUpdate,
    PetCreate,
    PetMedicalHistory,
    PetRecord,
    PetUpdate,
    SubmissionAttach,
    SubmissionCreate,
    SubmissionUpdate,
    SubmissionVetAction,
)

router = APIRouter(prefix="/api/v1", tags=["workflow"], dependencies=[Depends(require_auth)])


def _workflow(container: AppContainer = Depends(get_container)):
    return container.workflow


@router.post("/pets", response_model=PetRecord, status_code=status.HTTP_201_CREATED)
def create_pet(
    payload: PetCreate,
    principal: AuthPrincipal = Depends(require_capability(CAP_PETS)),
    service=Depends(_workflow),
) -> PetRecord:
    return service.create_pet(payload, principal=principal)


@router.get("/pets", response_model=list[PetRecord])
def list_pets(
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_workflow),
) -> list[PetRecord]:
    if not (
        principal.can(CAP_PETS)
        or principal.can(CAP_CASE_READ)
        or principal.can(CAP_CLINIC_MANAGE)
    ):
        raise HTTPException(status_code=403, detail="Not allowed.")
    return service.list_pets(principal=principal)


@router.get("/pets/{pet_id}", response_model=PetRecord)
def get_pet(
    pet_id: str,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_workflow),
) -> PetRecord:
    return service.get_pet(pet_id, principal=principal)


@router.patch("/pets/{pet_id}", response_model=PetRecord)
def update_pet(
    pet_id: str,
    payload: PetUpdate,
    principal: AuthPrincipal = Depends(require_capability(CAP_PETS)),
    service=Depends(_workflow),
) -> PetRecord:
    return service.update_pet(pet_id, payload, principal=principal)


@router.get("/pets/{pet_id}/medical-history", response_model=PetMedicalHistory)
def pet_medical_history(
    pet_id: str,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_workflow),
) -> PetMedicalHistory:
    """Chronological pet history derived from submissions, DICOM links, and cases."""
    if not (
        principal.can(CAP_PETS)
        or principal.can(CAP_CASE_READ)
        or principal.can(CAP_CLINIC_MANAGE)
        or principal.can(CAP_SUBMISSIONS)
    ):
        raise HTTPException(status_code=403, detail="Not allowed.")
    return service.pet_medical_history(pet_id, principal=principal)


@router.post("/submissions", response_model=ImagingSubmission, status_code=status.HTTP_201_CREATED)
def create_submission(
    payload: SubmissionCreate,
    principal: AuthPrincipal = Depends(require_capability(CAP_SUBMISSIONS)),
    service=Depends(_workflow),
) -> ImagingSubmission:
    return service.create_submission(payload, principal=principal)


@router.get("/submissions", response_model=list[ImagingSubmission])
def list_submissions(
    status: str | None = Query(default=None),
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_workflow),
) -> list[ImagingSubmission]:
    if not (principal.can(CAP_SUBMISSIONS) or principal.can(CAP_CASE_READ) or principal.can(CAP_CLINIC_MANAGE)):
        raise HTTPException(status_code=403, detail="Not allowed.")
    return service.list_submissions(principal=principal, status_filter=status)


@router.get("/submissions/{submission_id}", response_model=ImagingSubmission)
def get_submission(
    submission_id: str,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_workflow),
) -> ImagingSubmission:
    return service.get_submission(submission_id, principal=principal)


@router.patch("/submissions/{submission_id}", response_model=ImagingSubmission)
def update_submission(
    submission_id: str,
    payload: SubmissionUpdate,
    principal: AuthPrincipal = Depends(require_capability(CAP_SUBMISSIONS)),
    service=Depends(_workflow),
) -> ImagingSubmission:
    return service.update_submission(submission_id, payload, principal=principal)


@router.post("/submissions/{submission_id}/vet-action", response_model=CaseRecord | ImagingSubmission)
def vet_action(
    submission_id: str,
    payload: SubmissionVetAction,
    principal: AuthPrincipal = Depends(require_capability(CAP_SUBMISSIONS)),
    service=Depends(_workflow),
) -> CaseRecord | ImagingSubmission:
    """Vet verify / reject / request missing info. Accept creates a clinical case."""
    if principal.role not in {"vet", "admin", "demo", "service"} and principal.via != "disabled":
        raise HTTPException(status_code=403, detail="Veterinarian verification required.")
    return service.vet_action(submission_id, payload, principal=principal)


@router.post("/submissions/{submission_id}/attachments", response_model=ImagingSubmission)
def attach_submission(
    submission_id: str,
    payload: SubmissionAttach,
    principal: AuthPrincipal = Depends(require_capability(CAP_SUBMISSIONS)),
    service=Depends(_workflow),
) -> ImagingSubmission:
    """Attach additional DICOM/document ingest to an open submission (no duplicate case)."""
    return service.attach_submission(submission_id, payload, principal=principal)


@router.post(
    "/submissions/{submission_id}/info-requests/{request_id}/reply",
    response_model=ImagingSubmission,
)
def reply_submission_info_request(
    submission_id: str,
    request_id: str,
    payload: InfoRequestReply,
    principal: AuthPrincipal = Depends(require_capability(CAP_SUBMISSIONS)),
    service=Depends(_workflow),
) -> ImagingSubmission:
    return service.reply_info_request(submission_id, request_id, payload, principal=principal)


@router.post(
    "/submissions/{submission_id}/info-requests/{request_id}/close",
    response_model=ImagingSubmission,
)
def close_submission_info_request(
    submission_id: str,
    request_id: str,
    principal: AuthPrincipal = Depends(require_capability(CAP_SUBMISSIONS)),
    service=Depends(_workflow),
) -> ImagingSubmission:
    return service.close_info_request(submission_id, request_id, principal=principal)


@router.get("/clinic/stats", response_model=ClinicStaffStats)
def clinic_stats(
    principal: AuthPrincipal = Depends(require_capability(CAP_CLINIC_MANAGE)),
    service=Depends(_workflow),
) -> ClinicStaffStats:
    return service.clinic_stats(principal=principal)


@router.get("/admin/users", response_model=list[ManagedUser])
def list_users(
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_workflow),
) -> list[ManagedUser]:
    if not (principal.can(CAP_USERS_ADMIN) or principal.can(CAP_CLINIC_MANAGE) or principal.can(CAP_ADMIN)):
        # clinic_owner can list staff via clinic:manage
        if not principal.can(CAP_CLINIC_MANAGE):
            raise HTTPException(status_code=403, detail="Not allowed.")
    return service.list_users(principal=principal)


@router.post("/admin/users", response_model=ManagedUser, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: ManagedUserCreate,
    principal: AuthPrincipal = Depends(require_capability(CAP_ADMIN)),
    service=Depends(_workflow),
) -> ManagedUser:
    return service.create_user(payload, principal=principal)


@router.patch("/admin/users/{email}", response_model=ManagedUser)
def update_user(
    email: str,
    payload: ManagedUserUpdate,
    principal: AuthPrincipal = Depends(require_capability(CAP_ADMIN)),
    service=Depends(_workflow),
) -> ManagedUser:
    return service.update_user(email, payload, principal=principal)
