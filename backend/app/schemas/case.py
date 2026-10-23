from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.dicom import DicomStudyMeta
from app.schemas.documents import CaseDocumentContext
from app.schemas.enums import (
    AnatomicalRegion,
    CaseLifecycleStatus,
    MockScenario,
    Modality,
    ReviewAction,
    Species,
)
from app.schemas.findings import StructuredFindings, StudyInfo
from app.schemas.model_input import ImagingModelInput
from app.schemas.report import DraftReport, ReportVersionSnapshot

CasePriority = Literal["normal", "high", "urgent"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class StructuredClinicalHistory(BaseModel):
    """Clinic-structured history fields (persisted). Free-text remains on clinical_history."""

    model_config = ConfigDict(extra="forbid")

    complaint: Optional[str] = None
    onset: Optional[str] = None
    course: Optional[str] = None
    medications: Optional[str] = None
    relevant_history: Optional[str] = None
    handoff_notes: Optional[str] = None


class CaseCreate(BaseModel):
    """Synthetic case intake (manual metadata). DICOM upload is a separate endpoint."""

    model_config = ConfigDict(extra="forbid")

    patient_name: str = Field(min_length=1, max_length=120)
    species: Species
    breed: Optional[str] = None
    patient_age_years: Optional[float] = Field(default=None, ge=0, le=80)
    modality: Modality
    anatomical_region: AnatomicalRegion
    clinical_history: Optional[str] = None
    clinical_history_structured: Optional[StructuredClinicalHistory] = None
    priority: CasePriority = "normal"
    assigned_reviewer_id: Optional[str] = Field(default=None, max_length=80)
    scenario: Optional[MockScenario] = None
    study: StudyInfo = Field(default_factory=StudyInfo)
    referring_clinic: Optional[str] = None


class ReviewFeedback(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reviewer_id: str = Field(min_length=1, max_length=80)
    action: ReviewAction
    comment: Optional[str] = None
    edited_technique: Optional[str] = None
    edited_findings: Optional[str] = None
    edited_impression: Optional[str] = None
    edited_recommendations: Optional[str] = None


class ReportDraftUpdate(BaseModel):
    """Save editable draft sections without approve/reject. Never touches immutable reports."""

    model_config = ConfigDict(extra="forbid")

    editor_id: str = Field(min_length=1, max_length=80)
    technique: Optional[str] = None
    findings: Optional[str] = None
    impression: Optional[str] = None
    recommendations: Optional[str] = None
    note: Optional[str] = None


class CaseAssignmentUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assigned_reviewer_id: Optional[str] = Field(default=None, max_length=80)
    priority: Optional[CasePriority] = None


class CaseRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    status: CaseLifecycleStatus = CaseLifecycleStatus.CREATED
    patient_name: str
    species: Species
    breed: Optional[str] = None
    patient_age_years: Optional[float] = None
    modality: Modality
    anatomical_region: AnatomicalRegion
    clinical_history: Optional[str] = None
    clinical_history_structured: Optional[StructuredClinicalHistory] = None
    priority: CasePriority = "normal"
    assigned_reviewer_id: Optional[str] = None
    scenario: Optional[MockScenario] = None
    study: StudyInfo = Field(default_factory=StudyInfo)
    referring_clinic: Optional[str] = None
    # Phase 5: ownership / clinic isolation (null = legacy unscoped demo row).
    owner_subject: Optional[str] = None
    clinic_id: Optional[str] = None
    dicom_study: Optional[DicomStudyMeta] = None
    dicom_ingest_id: Optional[str] = None
    quarantine_dir: Optional[str] = None
    document_context: Optional[CaseDocumentContext] = None
    classification_confirmed: bool = True
    # Explicit verified grants for future pixel inference (default deny when False/unverifiable).
    imaging_source_permission_verified: bool = False
    imaging_analysis_consent_verified: bool = False
    latest_job_id: Optional[str] = None
    model_input: Optional[ImagingModelInput] = None
    structured_findings: Optional[StructuredFindings] = None
    draft_report: Optional[DraftReport] = None
    # Phase 4: append-only version history (approved snapshots are immutable).
    report_versions: list[ReportVersionSnapshot] = Field(default_factory=list)
    current_report_version: Optional[int] = None
    review_history: list[ReviewFeedback] = Field(default_factory=list)


class CaseSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str
    patient_name: str
    species: Species
    breed: Optional[str] = None
    patient_age_years: Optional[float] = None
    modality: Modality
    anatomical_region: AnatomicalRegion
    status: CaseLifecycleStatus
    priority: CasePriority = "normal"
    assigned_reviewer_id: Optional[str] = None
    scenario: Optional[MockScenario] = None
    created_at: datetime
    latest_job_id: Optional[str] = None
    classification_confirmed: bool = True
    study_instance_uid: Optional[str] = None
    series_count: Optional[int] = None
    instance_count: Optional[int] = None
    owner_subject: Optional[str] = None
    clinic_id: Optional[str] = None
    referring_clinic: Optional[str] = None
