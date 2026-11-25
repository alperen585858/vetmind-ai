"""Clinic-scoped patient (animal) records (issue #108).

Before this, a case carried the patient only as free text (name, species, breed), so the
same animal's earlier studies could not be found. A case now points at a ``PatientRecord``
through ``CaseRecord.patient_id``.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.enums import AnatomicalRegion, Modality, Species


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _clean(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = " ".join(value.split())
    return value or None


class PatientRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_id: str = Field(default_factory=lambda: f"pat-{uuid4().hex[:12]}")
    # Owning clinic; patients never cross clinics. None only for demo mode (auth off).
    clinic_id: Optional[str] = None
    # Who created the record (tenancy fallback when clinic_id is missing).
    owner_subject: Optional[str] = None
    name: str = Field(min_length=1, max_length=120)
    species: Species
    breed: Optional[str] = Field(default=None, max_length=80)
    sex: Optional[str] = Field(default=None, max_length=40)
    birth_date: Optional[date] = None
    # Unique inside a clinic when set.
    microchip: Optional[str] = Field(default=None, max_length=40)
    clinic_patient_no: Optional[str] = Field(default=None, max_length=40)
    # DICOM PatientID values seen on this animal's studies (used for match suggestions).
    dicom_patient_ids: list[str] = Field(default_factory=list)
    # Set when this record was merged into another one; such records are hidden.
    merged_into: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class PatientCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    species: Species
    breed: Optional[str] = Field(default=None, max_length=80)
    sex: Optional[str] = Field(default=None, max_length=40)
    birth_date: Optional[date] = None
    microchip: Optional[str] = Field(default=None, max_length=40)
    clinic_patient_no: Optional[str] = Field(default=None, max_length=40)

    @field_validator("name", "breed", "sex", "microchip", "clinic_patient_no", mode="before")
    @classmethod
    def _strip(cls, v: object) -> object:
        return _clean(v) if isinstance(v, str) else v


class PatientUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    species: Optional[Species] = None
    breed: Optional[str] = Field(default=None, max_length=80)
    sex: Optional[str] = Field(default=None, max_length=40)
    birth_date: Optional[date] = None
    microchip: Optional[str] = Field(default=None, max_length=40)
    clinic_patient_no: Optional[str] = Field(default=None, max_length=40)

    @field_validator("name", "breed", "sex", "microchip", "clinic_patient_no", mode="before")
    @classmethod
    def _strip(cls, v: object) -> object:
        return _clean(v) if isinstance(v, str) else v


class PatientMergeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # The duplicate that disappears; its cases move to the patient in the URL.
    duplicate_patient_id: str = Field(min_length=1, max_length=40)


class PriorStudy(BaseModel):
    """One earlier (or later) study of the same patient, for the prior-studies panel."""

    model_config = ConfigDict(extra="forbid")

    case_id: str
    created_at: datetime
    # DICOM StudyDate (YYYYMMDD) when known; the panel prefers it over created_at.
    study_date: Optional[str] = None
    modality: Modality
    anatomical_region: AnatomicalRegion
    status: str
    # Same modality and region as the case being read: a sensible comparison.
    comparable: bool = False
    has_dicom: bool = False
    approved_report_version: Optional[int] = None
    impression_excerpt: Optional[str] = None


class PatientStudies(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient: PatientRecord
    studies: list[PriorStudy] = Field(default_factory=list)


class PatientMatch(BaseModel):
    """Suggested existing patient for an uploaded study. Never applied automatically."""

    model_config = ConfigDict(extra="forbid")

    patient: PatientRecord
    reason: str  # dicom_patient_id | name_species
