from fastapi import APIRouter, Depends, status

from app.api.deps import get_case_service
from app.auth.deps import require_auth, require_capability
from app.auth.rbac import CAP_CASE_READ, CAP_REVIEW
from app.schemas.case import CaseRecord, ReviewFeedback
from app.schemas.report import DraftReport
from app.services.case_service import CaseService

router = APIRouter(prefix="/api/v1", tags=["reports"], dependencies=[Depends(require_auth)])


@router.get("/cases/{case_id}/report", response_model=DraftReport)
def get_report(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    _auth=Depends(require_capability(CAP_CASE_READ)),
) -> DraftReport:
    return service.get_report(case_id)


@router.post("/cases/{case_id}/review", response_model=CaseRecord, status_code=status.HTTP_200_OK)
def submit_review(
    case_id: str,
    payload: ReviewFeedback,
    service: CaseService = Depends(get_case_service),
    _auth=Depends(require_capability(CAP_REVIEW)),
) -> CaseRecord:
    return service.submit_review(case_id, payload)
