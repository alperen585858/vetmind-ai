"""RQ task entrypoints — must be importable by the worker process."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def run_analyze_job(case_id: str, job_id: str) -> None:
    """Executed inside ``rq worker``. Rebuilds a process-local AppContainer."""
    from app.container import AppContainer
    from app.schemas.enums import CaseLifecycleStatus, JobStatus, PipelineOutcome

    container = AppContainer()
    case = container.repo.get_case(case_id)
    job = container.repo.get_job(job_id)
    if case is None or job is None:
        logger.error("RQ analyze missing case/job case=%s job=%s", case_id, job_id)
        return
    try:
        result = container.orchestrator.run(case, job)
        container.repo.save_job(result.job)
        container.repo.save_case(case)
    except Exception as exc:  # noqa: BLE001
        logger.exception("RQ analyze failed")
        job.status = JobStatus.FAILED
        job.outcome = PipelineOutcome.FAILED
        job.error_message = f"RQ worker error: {type(exc).__name__}"
        case.status = CaseLifecycleStatus.FAILED
        container.repo.save_job(job)
        container.repo.save_case(case)
