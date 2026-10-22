from fastapi import APIRouter, Depends, status

from app.api.deps import get_case_service
from app.auth.deps import require_auth, require_capability
from app.auth.rbac import CAP_ANALYZE, CAP_CASE_READ, CAP_CASE_WRITE
from app.schemas.case import CaseCreate, CaseRecord, CaseSummary
from app.schemas.model_input import ImagingModelInput
from app.services.case_service import CaseService

router = APIRouter(
    prefix="/api/v1/cases",
    tags=["cases"],
    dependencies=[Depends(require_auth)],
)


@router.post("", response_model=CaseRecord, status_code=status.HTTP_201_CREATED)
def create_case(
    payload: CaseCreate,
    service: CaseService = Depends(get_case_service),
    _auth=Depends(require_capability(CAP_CASE_WRITE)),
) -> CaseRecord:
    return service.create_case(payload)


@router.get("", response_model=list[CaseSummary])
def list_cases(
    service: CaseService = Depends(get_case_service),
    _auth=Depends(require_capability(CAP_CASE_READ)),
) -> list[CaseSummary]:
    return service.list_cases()


@router.get("/{case_id}", response_model=CaseRecord)
def get_case(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    _auth=Depends(require_capability(CAP_CASE_READ)),
) -> CaseRecord:
    return service.get_case(case_id)


@router.post("/{case_id}/model-input", response_model=ImagingModelInput)
def prepare_model_input(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    _auth=Depends(require_capability(CAP_ANALYZE)),
) -> ImagingModelInput:
    """Build the versioned ImagingModelInput package Vision AI adapters consume."""
    return service.prepare_model_input(case_id)


@router.get("/{case_id}/model-input", response_model=ImagingModelInput)
def get_model_input(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    _auth=Depends(require_capability(CAP_CASE_READ)),
) -> ImagingModelInput:
    case = service.get_case(case_id)
    if case.model_input is None:
        return service.prepare_model_input(case_id)
    return case.model_input


@router.get("/{case_id}/findings")
def get_findings(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    _auth=Depends(require_capability(CAP_CASE_READ)),
):
    return service.get_findings(case_id)
