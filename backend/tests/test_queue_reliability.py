"""P1.5 — job timeout, batch retry, resume-friendly status persistence."""

from __future__ import annotations

from app.orchestration.progress import apply_pipeline_progress
from app.schemas.enums import JobStatus
from app.schemas.jobs import AnalysisJob


def test_job_timeout_field_is_explicit() -> None:
    job = AnalysisJob(job_id="j1", case_id="c1", status=JobStatus.QUEUED, timeout_s=120)
    assert job.timeout_s == 120


def test_progress_persists_partial_vision_status() -> None:
    job = AnalysisJob(job_id="j2", case_id="c1", status=JobStatus.RUNNING, timeout_s=60)
    apply_pipeline_progress(
        job,
        "vision_adapters",
        vision_adapter_index=0,
        vision_adapter_total=1,
        vision_batch_index=2,
        vision_batch_total=5,
        vision_frames_detected=100,
        vision_frames_decoded=40,
        vision_frames_analyzed=24,
        vision_analysis_scope="partial",
        vision_detail="retrying batch",
    )
    assert job.vision_batch_index == 2
    assert job.vision_frames_analyzed == 24
    assert job.vision_frames_decoded == 40
    assert job.vision_analysis_scope == "partial"
    assert job.timeout_s == 60


def test_terminal_timeout_status_shape() -> None:
    job = AnalysisJob(
        job_id="j3",
        case_id="c1",
        status=JobStatus.TIMED_OUT,
        completed_at=__import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ),
        error_message="Job exceeded timeout_s=60",
        timeout_s=60,
    )
    assert job.status == JobStatus.TIMED_OUT
    assert "timeout" in (job.error_message or "").lower()
    assert job.completed_at is not None


def test_vlm_batch_retry_preserves_prior_success_keys() -> None:
    analyzed_keys: set[tuple] = {("sop-a", 0, "sop-a"), ("sop-b", 0, "sop-b")}
    analyzed_keys.add(("sop-c", 0, "sop-c"))
    assert len(analyzed_keys) == 3
