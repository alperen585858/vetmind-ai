"""Clinic staff ↔ radiologist / support-team messaging (not case-scoped clinical chat)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

MessageChannel = Literal["radiologist", "admin"]
ThreadStatus = Literal["open", "closed"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SupportMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: str = Field(default_factory=lambda: f"msg-{uuid4().hex[:12]}")
    author_subject: str = Field(min_length=1, max_length=120)
    author_role: str = Field(min_length=1, max_length=40)
    # Empty only after a deleted message's undo window has passed (content purged).
    body: str = Field(min_length=0, max_length=4000)
    created_at: datetime = Field(default_factory=utcnow)
    read_by: list[str] = Field(default_factory=list)
    # Soft delete: restorable for a short window, then the body is purged.
    deleted_at: Optional[datetime] = None
    deleted_by: Optional[str] = Field(default=None, max_length=120)


class SupportThread(BaseModel):
    model_config = ConfigDict(extra="forbid")

    thread_id: str = Field(default_factory=lambda: f"thr-{uuid4().hex[:12]}")
    channel: MessageChannel
    # Who started the conversation (kept as ``owner_subject`` for stored-row compatibility).
    owner_subject: str = Field(min_length=1, max_length=120)
    # Direct recipient (a specific radiologist). ``None`` on the admin channel = whole support team.
    recipient_subject: Optional[str] = Field(default=None, max_length=120)
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
    # Required on the radiologist channel: the radiologist to talk to.
    recipient_subject: Optional[str] = Field(default=None, max_length=120)
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    related_case_id: Optional[str] = None
    related_submission_id: Optional[str] = None

    @field_validator("subject", "body")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value


class SupportMessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value


class SupportMessageView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: str
    author_subject: str
    author_role: str
    body: str
    created_at: datetime
    unread: bool = False
    # Own messages: someone else in the conversation has read it.
    read_by_other: bool = False
    deleted: bool = False
    deleted_at: Optional[datetime] = None
    # Until when the deleter can undo (None once the body is purged or not deleted).
    restorable_until: Optional[datetime] = None


class SupportThreadSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    thread_id: str
    channel: MessageChannel
    owner_subject: str
    recipient_subject: Optional[str] = None
    # Display label of the other side, from the viewer's point of view.
    counterpart_name: Optional[str] = None
    counterpart_role: Optional[str] = None
    # The other side has the app open right now (live stream connected).
    counterpart_online: bool = False
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


class MessageRecipient(BaseModel):
    """Someone the current user may start a conversation with."""

    model_config = ConfigDict(extra="forbid")

    # ``support`` is the shared support-team inbox (all admins); otherwise an account email.
    subject: str
    display_name: str
    role: str
    channel: MessageChannel
