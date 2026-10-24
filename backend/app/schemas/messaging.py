"""Owner ↔ radiologist / admin support messaging (not case-scoped clinical chat)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

MessageChannel = Literal["radiologist", "admin"]
ThreadStatus = Literal["open", "closed"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SupportMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: str = Field(default_factory=lambda: f"msg-{uuid4().hex[:12]}")
    author_subject: str = Field(min_length=1, max_length=120)
    author_role: str = Field(min_length=1, max_length=40)
    body: str = Field(min_length=1, max_length=4000)
    created_at: datetime = Field(default_factory=utcnow)
    read_by: list[str] = Field(default_factory=list)


class SupportThread(BaseModel):
    model_config = ConfigDict(extra="forbid")

    thread_id: str = Field(default_factory=lambda: f"thr-{uuid4().hex[:12]}")
    channel: MessageChannel
    owner_subject: str = Field(min_length=1, max_length=120)
    clinic_id: Optional[str] = None
    subject: str = Field(min_length=1, max_length=200)
    status: ThreadStatus = "open"
    related_case_id: Optional[str] = None
    related_submission_id: Optional[str] = None
    messages: list[SupportMessage] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class SupportThreadCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: MessageChannel
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    related_case_id: Optional[str] = None
    related_submission_id: Optional[str] = None


class SupportMessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=4000)


class SupportMessageView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: str
    author_subject: str
    author_role: str
    body: str
    created_at: datetime
    unread: bool = False


class SupportThreadSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    thread_id: str
    channel: MessageChannel
    owner_subject: str
    clinic_id: Optional[str] = None
    subject: str
    status: ThreadStatus
    related_case_id: Optional[str] = None
    related_submission_id: Optional[str] = None
    message_count: int = 0
    unread_count: int = 0
    last_message_preview: Optional[str] = None
    last_message_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class SupportThreadDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    thread: SupportThreadSummary
    messages: list[SupportMessageView]
