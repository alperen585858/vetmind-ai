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
    route_reason: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class PipelineResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job: AnalysisJob
    findings: Optional[StructuredFindings] = None
    report: Optional[DraftReport] = None
    outcome: PipelineOutcome
    messages: list[str] = Field(default_factory=list)
