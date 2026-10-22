from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enums import ExpertReviewStatus, ReportStatus, SourceKind
from app.schemas.rag import RagPassage

REPORT_SCHEMA_VERSION = "1.0.0"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class GenerationMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_id: str
    model_id: str
    model_version: str
    source_kind: SourceKind = SourceKind.MOCK
    generated_at: datetime = Field(default_factory=utcnow)
    synthetic: bool = True
    clinically_validated: bool = False


class ReportSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    cited_finding_ids: list[str] = Field(default_factory=list)


class DraftReport(BaseModel):
    """LLM (or mock LLM) radiology report draft. Always requires expert review."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = REPORT_SCHEMA_VERSION
    report_id: str
    case_id: str
    status: ReportStatus = ReportStatus.DRAFT
    generation: GenerationMetadata
    technique: ReportSection
    findings: ReportSection
    impression: ReportSection
    recommendations: ReportSection
    validation_warnings: list[str] = Field(default_factory=list)
    expert_review_status: ExpertReviewStatus = ExpertReviewStatus.PENDING
    synthetic: bool = True
    clinically_validated: bool = False
    reviewer_comment: Optional[str] = None
    rag_citations: list[RagPassage] = Field(default_factory=list)
    rag_note: str = (
        "Optional RAG citations are demo lexical matches only. "
        "They are not clinical evidence and do not validate findings."
    )
