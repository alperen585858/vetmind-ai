"""Expert response SLA: urgent/STAT = 24h, others = 48h."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.schemas.case import CaseRecord
from app.schemas.enums import CaseLifecycleStatus

URGENT_PRIORITIES = frozenset({"urgent", "stat"})
SLA_HOURS_URGENT = 24
SLA_HOURS_STANDARD = 48
# Notify assignee when remaining time is at or below this threshold.
WARN_WITHIN_HOURS = 6

OPEN_REVIEW_STATUSES = frozenset(
    {
        CaseLifecycleStatus.AWAITING_REVIEW,
        CaseLifecycleStatus.MANUAL_REVIEW,
    }
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def is_urgent_priority(priority: str | None) -> bool:
    return (priority or "normal") in URGENT_PRIORITIES


def sla_hours_for(priority: str | None) -> int:
    return SLA_HOURS_URGENT if is_urgent_priority(priority) else SLA_HOURS_STANDARD


def compute_review_due_at(since: datetime, priority: str | None) -> datetime:
    return since + timedelta(hours=sla_hours_for(priority))


def apply_review_sla(
    case: CaseRecord,
    *,
    now: datetime | None = None,
    restart: bool = False,
) -> bool:
    """
    Ensure review_due_at is set while the case awaits expert response.
    Returns True when the case object was mutated.
    """
    now = now or _now()
    changed = False

    if case.status not in OPEN_REVIEW_STATUSES:
        if case.review_due_at is not None:
            case.review_due_at = None
            changed = True
        return changed

    if restart or case.awaiting_review_since is None:
        case.awaiting_review_since = now
        changed = True

    due = compute_review_due_at(case.awaiting_review_since, case.priority)
    if case.review_due_at != due:
        case.review_due_at = due
        changed = True
    return changed


def clear_review_sla(case: CaseRecord) -> bool:
    """Clear open due clock after expert responds (approve/reject/revision)."""
    if case.review_due_at is None:
        return False
    case.review_due_at = None
    return True


def remaining_seconds(case: CaseRecord, *, now: datetime | None = None) -> float | None:
    if case.review_due_at is None:
        return None
    now = now or _now()
    return (case.review_due_at - now).total_seconds()
