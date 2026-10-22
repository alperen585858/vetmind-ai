from fastapi import APIRouter, Depends, status

from app.api.deps import get_case_service
from app.auth.deps import require_auth, require_capability
from app.auth.rbac import CAP_ANALYZE, CAP_CASE_READ
from app.schemas.jobs import AnalysisJob, PipelineResult
from app.services.case_service import CaseService

router = APIRouter(prefix="/api/v1", tags=["analysis"], dependencies=[Depends(require_auth)])


@router.post(
    "/cases/{case_id}/analyze",
    response_model=PipelineResult,
    status_code=status.HTTP_200_OK,
    summary="Run mock analysis synchronously",
)
def analyze_case(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    _auth=Depends(require_capability(CAP_ANALYZE)),
) -> PipelineResult:
    return service.analyze(case_id)


@router.post(
    "/cases/{case_id}/analyze/async",
    response_model=AnalysisJob,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Enqueue analysis (thread or RQ)",
)
def analyze_case_async(
    case_id: str,
    service: CaseService = Depends(get_case_service),
    _auth=Depends(require_capability(CAP_ANALYZE)),
) -> AnalysisJob:
    return service.enqueue_analyze(case_id)


@router.get(
    "/jobs/{job_id}",
    response_model=AnalysisJob,
    summary="Get analysis job status",
)
def get_job(
    job_id: str,
    service: CaseService = Depends(get_case_service),
    _auth=Depends(require_capability(CAP_CASE_READ)),
) -> AnalysisJob:
    return service.get_job(job_id)
