"""Versioned DICOM metadata contracts (Phase 2B). Metadata only — no pixel diagnosis."""

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enums import (
    AnatomicalRegion,
    ClassificationConfidence,
    ClassificationStatus,
    DicomValidationCode,
    DicomValidationSeverity,
    Modality,
    Species,
)

DICOM_SCHEMA_VERSION = "1.0.0"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DicomValidationIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: DicomValidationCode
    severity: DicomValidationSeverity
    message: str
    filename: Optional[str] = None
    sop_instance_uid: Optional[str] = None


class QuarantineObjectRef(BaseModel):
    """Persisted pointer into the local quarantine store."""

    model_config = ConfigDict(extra="forbid")

    original_filename: str
    stored_filename: str
    relative_path: str
    size_bytes: int
    sha256: str
    content_kind: str = "dicom"


class DicomInstanceMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sop_instance_uid: str
    instance_number: Optional[int] = None
    filename: Optional[str] = None
    transfer_syntax_uid: Optional[str] = None
    rows: Optional[int] = None
    columns: Optional[int] = None
    pixel_spacing: Optional[str] = None
    slice_thickness: Optional[str] = None
    image_orientation_patient: Optional[str] = None
    image_position_patient: Optional[str] = None
    has_pixel_data: bool = False
    pixel_data_analyzed: bool = False
    quarantine_relative_path: Optional[str] = None
    # Phase 20: which quarantine ingest produced this instance (multi-series AI package).
    ingest_id: Optional[str] = None


class DicomSeriesMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    series_instance_uid: str
    series_number: Optional[int] = None
    modality: Optional[Modality] = None
    series_description: Optional[str] = None
    body_part_examined: Optional[str] = None
    instances: list[DicomInstanceMeta] = Field(default_factory=list)


class DicomStudyMeta(BaseModel):
    """Study → Series → Instance hierarchy from DICOM metadata tags only."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = DICOM_SCHEMA_VERSION
    study_instance_uid: str
    study_description: Optional[str] = None
    accession_number: Optional[str] = None
    study_date: Optional[str] = None
    patient_id_synthetic: Optional[str] = None
    patient_name_from_dicom: Optional[str] = None
    series: list[DicomSeriesMeta] = Field(default_factory=list)

    @property
    def series_count(self) -> int:
        return len(self.series)

    @property
    def instance_count(self) -> int:
        return sum(len(s.instances) for s in self.series)


class ClassificationSuggestion(BaseModel):
    """Metadata-derived routing hints. Not a clinical diagnosis."""

    model_config = ConfigDict(extra="forbid")

    suggested_modality: Modality
    suggested_anatomical_region: AnatomicalRegion
    confidence: ClassificationConfidence
    needs_confirmation: bool = True
    classification_status: ClassificationStatus = ClassificationStatus.AMBIGUOUS
    suggested_species: Optional[Species] = None
    species_confidence: ClassificationConfidence = ClassificationConfidence.UNKNOWN
    rationale: list[str] = Field(default_factory=list)
    source_tags: dict[str, Optional[str]] = Field(default_factory=dict)
    note: str = (
        "Classification is based on DICOM metadata heuristics only. "
        "No pixel-based anatomical recognition was performed. "
        "Species is suggested only when DICOM text reliably indicates canine/feline; "
        "missing species is never invented."
    )


class DicomIngestionRecord(BaseModel):
    """Ingest session before a CaseRecord exists.

    Classification confirmation is ingest-scoped (`accepted` + optional `case_id`).
    CaseLifecycleStatus.AWAITING_CLASSIFICATION_CONFIRMATION is reserved/unused;
    cases are created only after successful confirm with classification_confirmed=True.
    """

    model_config = ConfigDict(extra="forbid")

    ingest_id: str
    created_at: datetime = Field(default_factory=utcnow)
    schema_version: str = DICOM_SCHEMA_VERSION
    patient_name: str
    species: Species
    breed: Optional[str] = None
    clinical_history: Optional[str] = None
    referring_clinic: Optional[str] = None
    owner_subject: Optional[str] = None
    clinic_id: Optional[str] = None
    study: Optional[DicomStudyMeta] = None
    issues: list[DicomValidationIssue] = Field(default_factory=list)
    classification: Optional[ClassificationSuggestion] = None
    accepted: bool = False
    case_id: Optional[str] = None
    blocked: bool = False
    block_reason: Optional[str] = None
    quarantine_dir: Optional[str] = None
    quarantined_files: list[QuarantineObjectRef] = Field(default_factory=list)


class DicomUploadResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingest_id: str
    blocked: bool
    block_reason: Optional[str] = None
    issues: list[DicomValidationIssue]
    study: Optional[DicomStudyMeta]
    classification: Optional[ClassificationSuggestion]
    quarantine_dir: Optional[str] = None
    quarantined_file_count: int = 0
    note: str = (
        "DICOM metadata ingest only. Pixel data is ignored for diagnosis. "
        "Uploaded bytes are retained in quarantine for future authorized adapters. "
        "Confirm classification before analysis when needs_confirmation is true."
    )


class ConfirmClassificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accept_suggestion: bool = True
    modality: Optional[Modality] = None
    anatomical_region: Optional[AnatomicalRegion] = None
    patient_name: Optional[str] = None
    clinical_history: Optional[str] = None
    # Wired from UI consent. Does NOT by itself authorize pixel inference
    # (see pixel_authorization + allows_pixel_analysis on capabilities).
    imaging_source_permission_verified: bool = False
    imaging_analysis_consent_verified: bool = False
