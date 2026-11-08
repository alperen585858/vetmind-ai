from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enums import JobStatus, PipelineOutcome
from app.schemas.findings import StructuredFindings
from app.schemas.report import DraftReport


class AnalysisJob(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: str
    case_id: str
    status: JobStatus = JobStatus.QUEUED
    outcome: Optional[PipelineOutcome] = None
    error_message: Optional[str] = None
    routed_model_ids: list[str] = Field(default_factory=list)
    routed_model_versions: list[str] = Field(default_factory=list)
    route_reason: Optional[str] = None
    route_rule_id: Optional[str] = None
    matched_capabilities: list[str] = Field(default_factory=list)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    # Phase 3 job control — cancel is cooperative; FE poll abort ≠ cancel.
    cancel_requested: bool = False
    idempotency_key: Optional[str] = None
    timeout_s: Optional[float] = None
    analysis_mode: str = "mock"  # mock | real | mixed — advisory from routed source_kinds
    # Checkpoint progress only (orchestrator stage boundaries) — never time/GPU estimates.
    pipeline_stage: Optional[str] = None
    progress_pct: int = 0
    stage_label: Optional[str] = None
    vision_adapter_index: Optional[int] = None
    vision_adapter_total: Optional[int] = None
    # VLM multi-batch progress (honest visual counts — not metadata-only).
    vision_batch_index: Optional[int] = None
    vision_batch_total: Optional[int] = None
    vision_frames_detected: Optional[int] = None
    vision_frames_decoded: Optional[int] = None
    vision_frames_analyzed: Optional[int] = None
    vision_series_total: Optional[int] = None
    vision_series_done: Optional[int] = None
    vision_analysis_scope: Optional[str] = None
    vision_detail: Optional[str] = None


class PipelineResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job: AnalysisJob
    findings: Optional[StructuredFindings] = None
    report: Optional[DraftReport] = None
    outcome: PipelineOutcome
    messages: list[str] = Field(default_factory=list)
