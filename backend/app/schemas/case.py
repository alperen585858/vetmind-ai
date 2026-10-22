from datetime import datetime, timezone
from typing import Optional

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
from app.schemas.report import DraftReport


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CaseCreate(BaseModel):
    """Synthetic case intake (manual metadata). DICOM upload is a separate endpoint."""

    model_config = ConfigDict(extra="forbid")

    patient_name: str = Field(min_length=1, max_length=120)
    species: Species
    breed: Optional[str] = None
    modality: Modality
    anatomical_region: AnatomicalRegion
    clinical_history: Optional[str] = None
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


class CaseRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    status: CaseLifecycleStatus = CaseLifecycleStatus.CREATED
    patient_name: str
    species: Species
    breed: Optional[str] = None
    modality: Modality
    anatomical_region: AnatomicalRegion
    clinical_history: Optional[str] = None
    scenario: Optional[MockScenario] = None
    study: StudyInfo = Field(default_factory=StudyInfo)
    referring_clinic: Optional[str] = None
    dicom_study: Optional[DicomStudyMeta] = None
    dicom_ingest_id: Optional[str] = None
    quarantine_dir: Optional[str] = None
    document_context: Optional[CaseDocumentContext] = None
    classification_confirmed: bool = True
    latest_job_id: Optional[str] = None
    model_input: Optional[ImagingModelInput] = None
    structured_findings: Optional[StructuredFindings] = None
    draft_report: Optional[DraftReport] = None
    review_history: list[ReviewFeedback] = Field(default_factory=list)


class CaseSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str
    patient_name: str
    species: Species
    modality: Modality
    anatomical_region: AnatomicalRegion
    status: CaseLifecycleStatus
    scenario: Optional[MockScenario] = None
    created_at: datetime
    latest_job_id: Optional[str] = None
