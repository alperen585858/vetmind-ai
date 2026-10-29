"""Per-user account / preference settings (persisted server-side)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str
    display_name: str = ""
    org: str = ""
    email_notifications: bool = True
    push_notifications: bool = True
    report_ready_alerts: bool = True
    message_alerts: bool = True
    compact_sidebar: bool = False
    language: Literal["tr", "en"] = "tr"
    updated_at: datetime = Field(default_factory=utcnow)


class UserSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: Optional[str] = Field(default=None, max_length=120)
    org: Optional[str] = Field(default=None, max_length=120)
    email_notifications: Optional[bool] = None
    push_notifications: Optional[bool] = None
    report_ready_alerts: Optional[bool] = None
    message_alerts: Optional[bool] = None
    compact_sidebar: Optional[bool] = None
    language: Optional[Literal["tr", "en"]] = None
