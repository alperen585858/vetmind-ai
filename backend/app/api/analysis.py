from fastapi import APIRouter, Depends, status

from app.api.deps import get_case_service
from app.schemas.jobs import AnalysisJob, PipelineResult
from app.services.case_service import CaseService

router = APIRouter(prefix="/api/v1", tags=["analysis"])


@router.post(
    "/cases/{case_id}/analyze",
    response_model=PipelineResult,
    status_code=status.HTTP_200_OK,
    summary="Run mock analysis synchronously",
    description=(
        "The mock AI pipeline runs **synchronously** inside this HTTP request. "
        "The returned `job_id` is a completed-run identifier, not evidence of a background queue. "
        "Polling `GET /jobs/{job_id}` after this call returns the already-finished job. "
        "No worker, broker, or async queue is used."
    ),
)
def analyze_case(case_id: str, service: CaseService = Depends(get_case_service)) -> PipelineResult:
    return service.analyze(case_id)


@router.get(
    "/jobs/{job_id}",
    response_model=AnalysisJob,
    summary="Get synchronous analysis run status",
    description=(
        "Returns the status of a prior synchronous analyze run. "
        "Jobs are not queued for later execution."
    ),
)
def get_job(job_id: str, service: CaseService = Depends(get_case_service)) -> AnalysisJob:
    return service.get_job(job_id)
