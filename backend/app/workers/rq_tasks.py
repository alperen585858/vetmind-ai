"""RQ task entrypoints — must be importable by the worker process."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def run_analyze_job(case_id: str, job_id: str) -> None:
    """Executed inside ``rq worker``. Rebuilds a process-local AppContainer.

    Uses CaseService.run_queued_analyze so versioning, cancel probe, and
    approve-race guards match the thread backend path.
    """
    from app.container import AppContainer

    container = AppContainer()
    try:
        container.cases.run_queued_analyze(case_id, job_id)
    except Exception:  # noqa: BLE001
        logger.exception("RQ analyze failed case=%s job=%s", case_id, job_id)
        from app.schemas.enums import CaseLifecycleStatus, JobStatus, PipelineOutcome

        job = container.repo.get_job(job_id)
        if job is not None and job.status not in {
            JobStatus.COMPLETED,
            JobStatus.CANCELLED,
            JobStatus.FAILED,
            JobStatus.TIMED_OUT,
        }:
            job.status = JobStatus.FAILED
            job.outcome = PipelineOutcome.FAILED
            job.error_message = "RQ worker error: unexpected exception."
            container.repo.save_job(job)
        latest = container.repo.get_case(case_id)
        if latest is not None and latest.status == CaseLifecycleStatus.ANALYZING:
            latest.status = CaseLifecycleStatus.FAILED
            container.repo.save_case(latest)
