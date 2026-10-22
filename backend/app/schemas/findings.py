from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    Modality,
    ModelExecutionStatus,
    SourceKind,
    Species,
)

FINDINGS_SCHEMA_VERSION = "1.1.0"


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


class PotentialConflict(BaseModel):
    """Flagged incompatibility between preserved findings. Not resolved automatically."""

    model_config = ConfigDict(extra="forbid")

    conflict_id: str
    finding_ids: list[str]
    anatomical_location_key: str
    reason: str
    note: str = (
        "Potential incompatibility preserved for expert review. "
        "Agreement between models would also not prove clinical correctness. "
        "No confidence scores are fabricated."
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
