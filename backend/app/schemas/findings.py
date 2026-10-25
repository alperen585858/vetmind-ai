from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    Modality,
    ModelExecutionStatus,
    SourceKind,
    Species,
)

FINDINGS_SCHEMA_VERSION = "1.2.0"

Laterality = Literal["LEFT", "RIGHT", "MIDLINE", "UNKNOWN"]


class ConflictReasonCode(str, Enum):
    DISTINCT_CODES = "distinct_codes"
    CROSS_FAMILY = "cross_family"
    OPPOSING_STATUS = "opposing_status"
    OPPOSING_LATERALITY = "opposing_laterality"
    SAME_SOP_DIVERGENT = "same_sop_divergent"
    MULTI_MODEL = "multi_model"


class EvidenceReference(BaseModel):
    """Evidence pointer. Optional DICOM UIDs link to ImagingModelInput frames when present."""

    model_config = ConfigDict(extra="forbid")

    evidence_id: str
    description: str
    series_hint: Optional[str] = None
    study_instance_uid: Optional[str] = None
    series_instance_uid: Optional[str] = None
    sop_instance_uid: Optional[str] = None
    frame_index: Optional[int] = None
    note: str = "Evidence reference only. Pixel-level imaging analysis may not have been performed."


class Finding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    finding_id: str
    finding_code: str
    description: str
    anatomical_location: str
    finding_status: FindingStatus
    source_model: str
    source_model_version: Optional[str] = None
    requires_review: bool = True
    evidence_references: list[EvidenceReference] = Field(default_factory=list)
    uncertainty_note: Optional[str] = None
    # Default False so REAL adapters are not labeled synthetic by schema default.
    # Mock adapters must set synthetic=True explicitly.
    synthetic: bool = False
    conflict_group_id: Optional[str] = None
    laterality: Laterality = "UNKNOWN"
    # Model-provided confidence only — never fabricate. Reject out-of-range when present.
    model_confidence: Optional[float] = None

    @field_validator("model_confidence")
    @classmethod
    def _confidence_range(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            return None
        if value < 0.0 or value > 1.0:
            raise ValueError("model_confidence must be in [0, 1] when present")
        return value


class PotentialConflict(BaseModel):
    """Flagged incompatibility between preserved findings. Not resolved automatically."""

    model_config = ConfigDict(extra="forbid")

    conflict_id: str
    finding_ids: list[str]
    anatomical_location_key: str
    reason: str
    reason_codes: list[str] = Field(default_factory=list)
    group_key: Optional[str] = None
    note: str = (
        "Olası uyumsuzluk uzman incelemesi için korundu. "
        "Modellerin uyuşması da klinik doğruluğu kanıtlamazdı. "
        "Uydurma güven skoru üretilmez."
    )


class StudyInfo(BaseModel):
    """Study metadata pointer. Phase 2B may populate from DICOM tags (not pixels)."""

    model_config = ConfigDict(extra="forbid")

    study_id: Optional[str] = None
    study_instance_uid: Optional[str] = None
    description: Optional[str] = None
    accession: Optional[str] = None
    dicom_available: bool = False
    series_count: Optional[int] = None
    instance_count: Optional[int] = None
    metadata_only: bool = True
    classification_confidence: Optional[str] = None
    # Phase-1 hardening: persist how classification was confirmed (backward-compatible).
    classification_status: Optional[str] = None
    classification_override: bool = False
    classification_rationale: list[str] = Field(default_factory=list)


class StructuredFindings(BaseModel):
    """Normalized imaging-model output. Missing findings ≠ disease exclusion."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = FINDINGS_SCHEMA_VERSION
    case_id: str
    study: StudyInfo = Field(default_factory=StudyInfo)
    species: Species
    modality: Modality
    anatomical_region: AnatomicalRegion
    source_model_id: str
    source_model_version: str
    source_kind: SourceKind = SourceKind.MOCK
    execution_status: ModelExecutionStatus
    findings: list[Finding] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    review_required: bool = True
    no_findings_returned: bool = False
    absences_not_confirmed: bool = True
    contributing_model_ids: list[str] = Field(default_factory=list)
    contributing_source_kinds: list[SourceKind] = Field(default_factory=list)
    potential_conflicts: list[PotentialConflict] = Field(default_factory=list)
    # Opaque processing metadata from adapters (timeouts, prep contract ids). Never PHI.
    processing_metadata: dict[str, str] = Field(default_factory=dict)
