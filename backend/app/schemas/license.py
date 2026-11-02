"""Founder-managed licensed clinics and owner account summaries."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

LicenseStatus = Literal["active", "inactive", "pending"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class LicensedClinic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clinic_id: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=2, max_length=200)
    status: LicenseStatus = "active"
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    created_by: Optional[str] = None


class LicensedClinicCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=200)
    clinic_id: Optional[str] = Field(default=None, min_length=2, max_length=80)
    clinic_owner_email: Optional[str] = Field(default=None, min_length=3, max_length=120)
    clinic_owner_password: Optional[str] = Field(default=None, min_length=6, max_length=120)


class LicensedClinicUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    status: Optional[LicenseStatus] = None


class LicensedClinicSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    clinic_id: str
    name: str
    status: LicenseStatus
    created_at: datetime
    updated_at: datetime
    created_by: Optional[str] = None
    staff_count: int = 0
    vet_count: int = 0
    clinic_owner_count: int = 0
    case_count: int = 0
    submission_count: int = 0


ClinicStaffRole = Literal["vet", "clinic_owner"]


class ClinicStaffSummary(BaseModel):
    """Veteriner hekim veya klinik admin (clinic_owner) — kurucunun asıl yönetim nesnesi."""

    model_config = ConfigDict(extra="forbid")

    email: str
    display_name: Optional[str] = None
    role: ClinicStaffRole
    active: bool = True
    clinic_id: Optional[str] = None
    clinic_name: Optional[str] = None
    case_count: int = 0


class ClinicStaffCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=6, max_length=120)
    role: ClinicStaffRole
    clinic_id: str = Field(min_length=2, max_length=80)
    display_name: Optional[str] = Field(default=None, max_length=120)


class ClinicStaffUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: Optional[bool] = None
    clinic_id: Optional[str] = Field(default=None, min_length=2, max_length=80)
    role: Optional[ClinicStaffRole] = None
    display_name: Optional[str] = Field(default=None, max_length=120)
    password: Optional[str] = Field(default=None, min_length=6, max_length=120)


class OwnerAccountSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str
    display_name: Optional[str] = None
    active: bool = True
    clinic_id: Optional[str] = None
    pet_count: int = 0
    submission_count: int = 0
    case_count: int = 0


class OwnerAccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: bool
