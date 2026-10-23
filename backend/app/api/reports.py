from fastapi import APIRouter, Depends, Query, status

from app.api.deps import get_case_service
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_CASE_READ, CAP_REVIEW
from app.schemas.case import CaseRecord, ReportDraftUpdate, ReviewFeedback
from app.schemas.report import DraftReport, ReportVersionSnapshot, ReportVersionSummary
from app.services.case_service import CaseService

router = APIRouter(prefix="/api/v1", tags=["reports"], dependencies=[Depends(require_auth)])


@router.get("/cases/{case_id}/report", response_model=DraftReport)
def get_report(
    case_id: str,
    version: int | None = Query(default=None, ge=1),
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> DraftReport:
    return service.get_report(case_id, version=version, principal=principal)


@router.put("/cases/{case_id}/report/draft", response_model=DraftReport)
def save_draft_report(
    case_id: str,
    payload: ReportDraftUpdate,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_REVIEW)),
) -> DraftReport:
    """Save draft sections without approve/reject. Approved reports remain immutable."""
    return service.save_draft_report(case_id, payload, principal=principal)


@router.get(
    "/cases/{case_id}/report/versions",
    response_model=list[ReportVersionSummary],
    summary="List report version history for a case",
)
def list_report_versions(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> list[ReportVersionSummary]:
    return service.list_report_versions(case_id, principal=principal)


@router.get(
    "/cases/{case_id}/report/versions/{version}",
    response_model=ReportVersionSnapshot,
    summary="Get a specific report version snapshot",
)
def get_report_version(
    case_id: str,
    version: int,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> ReportVersionSnapshot:
    return service.get_report_version(case_id, version, principal=principal)


@router.post("/cases/{case_id}/review", response_model=CaseRecord, status_code=status.HTTP_200_OK)
def submit_review(
    case_id: str,
    payload: ReviewFeedback,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_REVIEW)),
) -> CaseRecord:
    return service.submit_review(case_id, payload, principal=principal)
