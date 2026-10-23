"""Append real case activity events (never invent history)."""

from __future__ import annotations

from app.schemas.case import CaseActivityEvent, CaseRecord


def append_activity(
    case: CaseRecord,
    *,
    kind: str,
    actor_subject: str,
    detail: str | None = None,
) -> CaseRecord:
    """Mutate case.activity in place and return the case."""
    case.activity.append(
        CaseActivityEvent(kind=kind, actor_subject=actor_subject, detail=detail)
    )
    return case
