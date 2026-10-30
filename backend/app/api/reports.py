from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response

from app.api.deps import get_case_service, get_container
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_CASE_READ, CAP_REVIEW
from app.container import AppContainer
from app.schemas.case import CaseActivityEvent, CaseRecord, ReportDraftUpdate, ReviewFeedback
from app.schemas.enums import CaseLifecycleStatus, ReportStatus
from app.schemas.report import DraftReport, ReportVersionSnapshot, ReportVersionSummary
from app.services.case_service import CaseService
from app.services.pdf_report import build_approved_report_pdf

router = APIRouter(prefix="/api/v1", tags=["reports"], dependencies=[Depends(require_auth)])


@router.post("/cases/{case_id}/report/deliver", response_model=CaseRecord)
def mark_report_delivered(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> CaseRecord:
    """Mark approved report as delivered to clinic (does not alter report content)."""
    return service.mark_report_delivered(case_id, principal=principal)


@router.post("/cases/{case_id}/report/viewed", response_model=CaseRecord)
def mark_report_viewed(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> CaseRecord:
    """Record first clinic/viewer open of an approved report (immutable content preserved)."""
    return service.mark_report_viewed(case_id, principal=principal)


@router.get("/cases/{case_id}/report", response_model=DraftReport)
def get_report(
    case_id: str,
    version: int | None = Query(default=None, ge=1),
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> DraftReport:
    return service.get_report(case_id, version=version, principal=principal)


@router.post("/cases/{case_id}/report/manual-init", response_model=DraftReport)
def init_manual_report(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_REVIEW)),
) -> DraftReport:
    """Bootstrap a blank radiologist draft for failed/unsupported cases (no AI draft)."""
    return service.init_manual_report(case_id, principal=principal)


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


@router.get("/cases/{case_id}/report/pdf")
def download_approved_report_pdf(
    case_id: str,
    version: int | None = Query(default=None, ge=1),
    service: CaseService = Depends(get_case_service),
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> Response:
    """Download a server-generated PDF of an immutable approved report version."""
    case = service.get_case(case_id, principal=principal)
    if case.status != CaseLifecycleStatus.APPROVED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="PDF only for approved cases.")
    quarantine = container.quarantine
    if version is not None:
        snap = service.get_report_version(case_id, version, principal=principal)
        if not snap.immutable:
            raise HTTPException(status_code=409, detail="Selected version is not an approved immutable snapshot.")
        pdf = build_approved_report_pdf(case, snap, quarantine=quarantine)
        ver = version
    else:
        report = case.draft_report
        if report is None or not report.immutable or report.status != ReportStatus.APPROVED:
            snaps = [v for v in case.report_versions if v.immutable]
            if not snaps:
                raise HTTPException(status_code=409, detail="No immutable approved report to export.")
            snap = max(snaps, key=lambda s: s.version)
            pdf = build_approved_report_pdf(case, snap, quarantine=quarantine)
            ver = snap.version
        else:
            pdf = build_approved_report_pdf(case, report, quarantine=quarantine)
            ver = report.version
    filename = f"radyoloji-raporu-{case_id}-v{ver}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/cases/{case_id}/activity", response_model=list[CaseActivityEvent])
def list_case_activity(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> list[CaseActivityEvent]:
    return service.list_activity(case_id, principal=principal)
