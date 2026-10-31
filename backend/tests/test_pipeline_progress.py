from app.orchestration.progress import (
    STAGE_BASE_PCT,
    apply_pipeline_progress,
    vision_progress_pct,
)
from app.orchestration.orchestrator import AIOrchestrator
from app.schemas.jobs import AnalysisJob


def test_vision_progress_stays_below_normalize() -> None:
    assert vision_progress_pct(adapter_index=0, adapter_total=2) == STAGE_BASE_PCT["vision_adapters"]
    mid = vision_progress_pct(adapter_index=1, adapter_total=2)
    assert STAGE_BASE_PCT["vision_adapters"] < mid < STAGE_BASE_PCT["normalize_findings"]


def test_apply_pipeline_progress_sets_label_and_pct() -> None:
    job = AnalysisJob(job_id="job-x", case_id="case-x")
    apply_pipeline_progress(job, "llm_draft")
    assert job.pipeline_stage == "llm_draft"
    assert job.progress_pct == STAGE_BASE_PCT["llm_draft"]
    assert job.stage_label == "Taslak yazılıyor"


def test_new_job_starts_at_queued_zero() -> None:
    job = AIOrchestrator.new_job("case-z")
    assert job.pipeline_stage == "queued"
    assert job.progress_pct == 0
