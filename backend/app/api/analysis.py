from fastapi import APIRouter, Depends, Header, status

from app.api.deps import get_case_service
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_ANALYZE, CAP_CASE_READ
from app.schemas.jobs import AnalysisJob, PipelineResult
from app.services.case_service import CaseService

router = APIRouter(prefix="/api/v1", tags=["analysis"], dependencies=[Depends(require_auth)])


@router.post(
    "/cases/{case_id}/analyze",
    response_model=PipelineResult,
    status_code=status.HTTP_200_OK,
    summary="Run analysis synchronously (mock or configured adapters)",
)
def analyze_case(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_ANALYZE)),
) -> PipelineResult:
    return service.analyze(case_id, principal=principal)


@router.post(
    "/cases/{case_id}/analyze/async",
    response_model=AnalysisJob,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Enqueue analysis (thread or RQ); idempotent while in-flight",
)
def analyze_case_async(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_ANALYZE)),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> AnalysisJob:
    return service.enqueue_analyze(case_id, idempotency_key=idempotency_key, principal=principal)


@router.get(
    "/jobs/{job_id}",
    response_model=AnalysisJob,
    summary="Get analysis job status",
)
def get_job(
    job_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_CASE_READ)),
) -> AnalysisJob:
    return service.get_job(job_id, principal=principal)


@router.post(
    "/jobs/{job_id}/cancel",
    response_model=AnalysisJob,
    summary="Request cooperative job cancel (does not kill in-flight adapters immediately)",
)
def cancel_job(
    job_id: str,
    service: CaseService = Depends(get_case_service),
    principal: AuthPrincipal = Depends(require_capability(CAP_ANALYZE)),
) -> AnalysisJob:
    return service.request_cancel_job(job_id, principal=principal)
