"""Phase 17 — in-app notifications."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

NotificationKind = Literal[
    "submission_created",
    "submission_verified",
    "submission_rejected",
    "submission_needs_info",
    "radiologist_assigned",
    "case_message",
    "revision_requested",
    "report_approved",
    "urgent_assignment",
    "info_request_opened",
    "info_request_answered",
    "info_request_closed",
    "attachment_added",
    "clinical_history_updated",
    "support_message",
    "sla_warning",
    "sla_overdue",
]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AppNotification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notification_id: str = Field(default_factory=lambda: f"ntf-{uuid4().hex[:12]}")
    recipient_subject: str
    kind: NotificationKind
    title: str
    body: str
    link_path: str
    case_id: Optional[str] = None
    submission_id: Optional[str] = None
    clinic_id: Optional[str] = None
    dedupe_key: str
    created_at: datetime = Field(default_factory=utcnow)
    read_at: Optional[datetime] = None

    @property
    def unread(self) -> bool:
        return self.read_at is None


class NotificationListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[AppNotification]
    unread_count: int
