"""Phase 14 — pets, owner imaging submissions, admin user directory."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enums import Species

SubmissionStatus = Literal[
    "draft",
    "pending_verification",
    "needs_info",
    "verified",
    "rejected",
    "linked",
]

ManagedRole = Literal["vet", "expert", "owner", "clinic_owner", "admin"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class PetRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pet_id: str = Field(default_factory=lambda: f"pet-{uuid4().hex[:12]}")
    owner_subject: str
    clinic_id: Optional[str] = None
    name: str = Field(min_length=1, max_length=120)
    species: Species
    breed: Optional[str] = None
    age_years: Optional[float] = Field(default=None, ge=0, le=80)
    sex: Optional[str] = None
    medical_history: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class PetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    species: Species
    breed: Optional[str] = None
    age_years: Optional[float] = Field(default=None, ge=0, le=80)
    sex: Optional[str] = None
    medical_history: Optional[str] = None


class PetUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    breed: Optional[str] = None
    age_years: Optional[float] = Field(default=None, ge=0, le=80)
    sex: Optional[str] = None
    medical_history: Optional[str] = None


class ImagingSubmission(BaseModel):
    """Owner imaging request — requires vet verification before clinical processing."""

    model_config = ConfigDict(extra="forbid")

    submission_id: str = Field(default_factory=lambda: f"sub-{uuid4().hex[:12]}")
    pet_id: str
    pet_owner_subject: str
    clinic_id: Optional[str] = None
    status: SubmissionStatus = "draft"
    chief_complaint: Optional[str] = None
    clinical_notes: Optional[str] = None
    dicom_ingest_id: Optional[str] = None
    document_ingest_id: Optional[str] = None
    vet_notes: Optional[str] = None
    missing_info_request: Optional[str] = None
    assigned_reviewer_id: Optional[str] = None
    linked_case_id: Optional[str] = None
    verified_by: Optional[str] = None
    verified_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    # For tenancy helpers (alias pet owner as owner_subject)
    owner_subject: Optional[str] = None


class SubmissionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pet_id: str
    chief_complaint: Optional[str] = None
    clinical_notes: Optional[str] = None


class SubmissionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chief_complaint: Optional[str] = None
    clinical_notes: Optional[str] = None
    dicom_ingest_id: Optional[str] = None
    document_ingest_id: Optional[str] = None


class SubmissionVetAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["accept", "reject", "request_info"]
    vet_notes: Optional[str] = None
    missing_info_request: Optional[str] = None
    assigned_reviewer_id: Optional[str] = None
    run_analyze: bool = False


class ManagedUser(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str
    role: ManagedRole
    clinic_id: Optional[str] = None
    display_name: Optional[str] = None
    active: bool = True
    # Password only set on create/reset; never returned in list responses.
    password: Optional[str] = None


class ManagedUserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=6, max_length=120)
    role: ManagedRole
    clinic_id: Optional[str] = None
    display_name: Optional[str] = None


class ManagedUserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Optional[ManagedRole] = None
    clinic_id: Optional[str] = None
    display_name: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=6, max_length=120)


class ClinicStaffStats(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clinic_id: str
    case_count: int = 0
    awaiting_review: int = 0
    approved: int = 0
    pending_submissions: int = 0
    staff: list[ManagedUser] = Field(default_factory=list)
