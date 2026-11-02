"""Public contact / license interest inquiries for the founder inbox."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

ContactTopic = Literal["license", "demo", "partnership", "other"]
ContactStatus = Literal["new", "read", "closed"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ContactInquiry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inquiry_id: str = Field(default_factory=lambda: f"inq-{uuid4().hex[:12]}")
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    organization: Optional[str] = Field(default=None, max_length=200)
    topic: ContactTopic = "license"
    message: str = Field(min_length=10, max_length=4000)
    status: ContactStatus = "new"
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("name", "message", "phone", "organization", mode="before")
    @classmethod
    def _strip_text(cls, v: object) -> object:
        if isinstance(v, str):
            return v.strip()
        return v


class ContactInquiryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    organization: Optional[str] = Field(default=None, max_length=200)
    topic: ContactTopic = "license"
    message: str = Field(min_length=10, max_length=4000)


class ContactInquiryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ContactStatus


class ContactInquiryPublicReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inquiry_id: str
    status: str = "received"
    note: str = "Thanks — the VetMind team will get back to you."
