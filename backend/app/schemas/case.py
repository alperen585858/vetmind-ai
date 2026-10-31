from datetime import datetime, timezone
from typing import Any, Literal, Optional
from uuid import uuid4

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
from app.schemas.workflow import AttachmentRef, ClinicalNoteEntry, InfoRequest

# Phase 12: NORMAL / URGENT / STAT (+ legacy "high" retained for existing rows).
CasePriority = Literal["normal", "high", "urgent", "stat"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CaseMessage(BaseModel):
    """Case-scoped vet ↔ radiologist message (tenant-scoped via parent case)."""

    model_config = ConfigDict(extra="forbid")

    message_id: str = Field(default_factory=lambda: f"msg-{uuid4().hex[:12]}")
    case_id: str = ""
    author_id: str = Field(min_length=1, max_length=80)
    author_role: str = Field(min_length=1, max_length=40)
    body: str = Field(min_length=1, max_length=4000)
    created_at: datetime = Field(default_factory=utcnow)
    read_by: list[str] = Field(default_factory=list)


class CaseMessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=4000)


class AiChatTurn(BaseModel):
    """Expert ↔ case-context LLM chat (not clinical advice; draft assistant only)."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)
    created_at: datetime = Field(default_factory=utcnow)
    author_id: Optional[str] = None


class AiChatAsk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=4000)


class AiChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str
    reply: str
    history: list[AiChatTurn] = Field(default_factory=list)
    provider: str = "mock"
    note: str = (
        "Vaka bağlamlı asistan yanıtı. Klinik karar / tanı yerine geçmez; "
        "uzman onayı olmadan iletilmez."
    )


class CaseMessageView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: str
    case_id: str
    author_id: str
    author_role: str
    body: str
    created_at: datetime
    unread: bool = False


class ClinicDashboardStats(BaseModel):
    """Clinic workboard counters (tenant-scoped)."""

    model_config = ConfigDict(extra="forbid")

    active_cases: int = 0
    awaiting_review: int = 0
    urgent_cases: int = 0
    completed_reports: int = 0
    unread_messages: int = 0


class StructuredClinicalHistory(BaseModel):
    """Clinic-structured history fields (persisted). Free-text remains on clinical_history."""

    model_config = ConfigDict(extra="forbid")

    complaint: Optional[str] = None
    onset: Optional[str] = None
    course: Optional[str] = None
    medications: Optional[str] = None
    relevant_history: Optional[str] = None
    handoff_notes: Optional[str] = None
    # Optional patient demographics from clinic wizard (not PHI-validated).
    sex: Optional[str] = Field(default=None, max_length=40)
    weight_kg: Optional[float] = Field(default=None, ge=0, le=200)
    neutered: Optional[bool] = None
    # Neurological exam snapshot as plain string map (wizard → review UI).
    neuro_exam: Optional[dict[str, Any]] = None


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
    reason_codes: list[str] = Field(
        default_factory=list,
        description="Training-signal codes: wrong_finding | missing_finding | report_quality | …",
    )
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


class CaseActivityEvent(BaseModel):
    """Persistent case activity (never invented — only emitted on real actions)."""

    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(default_factory=lambda: f"act-{uuid4().hex[:12]}")
    kind: str
    actor_subject: str
    at: datetime = Field(default_factory=utcnow)
    detail: Optional[str] = None


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
    # Expert response SLA clock (urgent/STAT=24h, else=48h from awaiting_review_since).
    awaiting_review_since: Optional[datetime] = None
    review_due_at: Optional[datetime] = None
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
    # Phase 12: case messaging + report delivery (approved content never mutated).
    messages: list[CaseMessage] = Field(default_factory=list)
    # Expert AI assistant chat (ChatGPT-style Q&A over case context). Cap in service.
    ai_chat: list[AiChatTurn] = Field(default_factory=list)
    report_available_at: Optional[datetime] = None
    report_delivered_at: Optional[datetime] = None
    report_viewed_at: Optional[datetime] = None
    # Phase 14: pet-owner linkage (owner ACL uses pet_owner_subject, not clinic-wide).
    pet_id: Optional[str] = None
    pet_owner_subject: Optional[str] = None
    submission_id: Optional[str] = None
    vet_verified: bool = True
    # Phase 17: append-only real activity events.
    activity: list[CaseActivityEvent] = Field(default_factory=list)
    # Phase 18: append-only notes, attachments, structured info requests.
    clinical_notes_log: list[ClinicalNoteEntry] = Field(default_factory=list)
    internal_notes: list[ClinicalNoteEntry] = Field(default_factory=list)
    info_requests: list[InfoRequest] = Field(default_factory=list)
    attachment_refs: list[AttachmentRef] = Field(default_factory=list)
    # Created by app.demo_seed (VETMIND_DEMO_SEED / scripts/seed_demo.py); removable as a set.
    demo_seed: bool = False


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
    awaiting_review_since: Optional[datetime] = None
    review_due_at: Optional[datetime] = None
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
    unread_messages: int = 0
    report_available_at: Optional[datetime] = None
    report_delivered_at: Optional[datetime] = None
    report_viewed_at: Optional[datetime] = None
    pet_id: Optional[str] = None
    pet_owner_subject: Optional[str] = None
    submission_id: Optional[str] = None
    vet_verified: bool = True
    # Report revision signal for list UIs (approved v1 stays locked; v2+ = revised).
    current_report_version: Optional[int] = None
    report_version_count: int = 0
