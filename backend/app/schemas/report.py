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
    """LLM (or mock LLM) radiology report draft. Always requires expert review.

    ``version`` / ``immutable`` support Phase 4 lifecycle. Approved reports set
    ``immutable=True`` and must not be silently overwritten.
    """

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
        "Optional RAG citations list retrieved demo passages (retrieval similarity score only). "
        "Score is not clinical confidence. Citations are not clinical evidence and do not validate findings."
    )
    # Phase 4 versioning (defaults keep older persisted payloads valid).
    version: int = 1
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    immutable: bool = False
    revision_notes: Optional[str] = None
    reviewed_by: Optional[str] = None


class ReportVersionSnapshot(BaseModel):
    """Immutable-capable snapshot stored on the case for history / print-by-version."""

    model_config = ConfigDict(extra="forbid")

    version: int
    report_id: str
    case_id: str
    created_at: datetime
    updated_at: datetime
    author_or_source: str
    status: ReportStatus
    expert_review_status: ExpertReviewStatus = ExpertReviewStatus.PENDING
    immutable: bool = False
    revision_notes: Optional[str] = None
    reviewed_by: Optional[str] = None
    source_kind: SourceKind = SourceKind.MOCK
    model_id: str = ""
    model_version: str = ""
    synthetic: bool = True
    content: DraftReport


class ReportVersionSummary(BaseModel):
    """List row for report history UI (no full section bodies)."""

    model_config = ConfigDict(extra="forbid")

    version: int
    report_id: str
    case_id: str
    created_at: datetime
    updated_at: datetime
    author_or_source: str
    status: ReportStatus
    expert_review_status: ExpertReviewStatus
    immutable: bool
    revision_notes: Optional[str] = None
    reviewed_by: Optional[str] = None
    source_kind: SourceKind
    model_id: str
    model_version: str
    synthetic: bool
    is_current: bool = False
