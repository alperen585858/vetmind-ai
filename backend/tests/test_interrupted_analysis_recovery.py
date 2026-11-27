"""#118: analyses a restarted process left unfinished are closed at startup."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.schemas.enums import CaseLifecycleStatus, JobStatus
from app.schemas.jobs import AnalysisJob
from app.settings import Settings
from tests.conftest import make_payload


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        storage_backend="sqlite",
        sqlite_path=tmp_path / "vetmind.sqlite3",
        quarantine_root=tmp_path / "quarantine",
        analyze_gate_path=tmp_path / "analyze_gate.count",
        max_concurrent_analyze=2,
    )


def _leave_analysis_running(container: AppContainer, status: JobStatus) -> tuple[str, str]:
    """What a killed process leaves behind: job in flight, case ANALYZING, slots held."""
    client = TestClient(create_app(container))
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    repo = container.repo
    job = AnalysisJob(
        job_id="job-interrupted",
        case_id=case_id,
        status=status,
        started_at=datetime.now(timezone.utc),
    )
    repo.save_job(job)
    case = repo.get_case(case_id)
    case.latest_job_id = job.job_id
    case.status = CaseLifecycleStatus.ANALYZING
    repo.save_case(case)
    gate = container.cases._analyze_gate
    assert gate.try_acquire() and gate.try_acquire()
    assert not gate.try_acquire()  # both slots leaked
    return case_id, job.job_id


@pytest.mark.parametrize("status", [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.CANCEL_REQUESTED])
def test_restart_closes_interrupted_job_and_allows_reanalyze(tmp_path: Path, status: JobStatus) -> None:
    settings = _settings(tmp_path)
    case_id, job_id = _leave_analysis_running(AppContainer(settings=settings), status)

    # Before the fix the new process answered 409 analysis_in_progress forever.
    restarted = AppContainer(settings=settings)
    assert restarted.analysis.recover_interrupted_jobs() == 1

    job = restarted.repo.get_job(job_id)
    assert job.status == JobStatus.FAILED
    assert "restarted" in (job.error_message or "")
    assert job.completed_at is not None
    assert restarted.repo.get_case(case_id).status == CaseLifecycleStatus.FAILED

    client = TestClient(create_app(restarted))
    again = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert again.status_code == 200, again.text  # gate slots released too (no 429)
    assert again.json()["job"]["status"] == JobStatus.COMPLETED.value


def test_restart_keeps_prior_draft_reviewable(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    container = AppContainer(settings=settings)
    client = TestClient(create_app(container))
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    assert client.post(f"/api/v1/cases/{case_id}/analyze").status_code == 200

    # Re-analyze interrupted by a restart must not throw away the existing draft.
    case = container.repo.get_case(case_id)
    job = AnalysisJob(job_id="job-rerun", case_id=case_id, status=JobStatus.RUNNING)
    container.repo.save_job(job)
    case.latest_job_id = job.job_id
    case.status = CaseLifecycleStatus.ANALYZING
    container.repo.save_case(case)

    restarted = AppContainer(settings=settings)
    assert restarted.analysis.recover_interrupted_jobs() == 1
    recovered = restarted.repo.get_case(case_id)
    assert recovered.status == CaseLifecycleStatus.AWAITING_REVIEW
    assert recovered.draft_report is not None


def test_finished_jobs_are_left_alone(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    container = AppContainer(settings=settings)
    client = TestClient(create_app(container))
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    done = client.post(f"/api/v1/cases/{case_id}/analyze").json()

    restarted = AppContainer(settings=settings)
    assert restarted.analysis.recover_interrupted_jobs() == 0
    assert restarted.repo.get_job(done["job"]["job_id"]).status == JobStatus.COMPLETED
    assert restarted.repo.get_case(case_id).status == container.repo.get_case(case_id).status


def test_rq_backend_is_not_touched(tmp_path: Path) -> None:
    """RQ jobs survive in Redis and its workers share the gate: nothing to recover here."""
    container = AppContainer(settings=_settings(tmp_path))
    container.cases._jobs = object()  # anything but the thread backend
    case_id, job_id = _leave_analysis_running(container, JobStatus.RUNNING)
    assert container.analysis.recover_interrupted_jobs() == 0
    assert container.repo.get_job(job_id).status == JobStatus.RUNNING
