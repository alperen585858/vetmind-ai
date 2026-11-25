"""Admin security / audit log screen API (issue #106). Read-only."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_actor
from app.auth.tenancy import principal_is_global
from app.container import AppContainer
from app.http_errors import api_error
from app.security.audit import AuditOutcome, AuditQuery
from app.security.audit_insights import (
    CSV_COLUMNS,
    csv_cell,
    find_suspicious,
    flagged_actors,
    is_flagged,
    summarize,
)

router = APIRouter(prefix="/api/v1/admin/audit", tags=["admin-audit"])

EXPORT_MAX_ROWS = 5000
# Events read for the summary cards and suspicious list (last 7 days, newest first).
SUMMARY_MAX_EVENTS = 5000
Outcome = Literal["success", "denied", "error", "info"]


class AuditEventOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: str
    timestamp: str
    event_type: str
    actor: str
    resource: str
    outcome: str
    detail: Optional[str] = None
    clinic_id: Optional[str] = None
    suspicious: bool = False


class AuditPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[AuditEventOut]
    next_cursor: Optional[str] = None
    # Set when a clinic owner only sees their own clinic.
    scoped_to_clinic: Optional[str] = None


class SuspiciousItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["failed_logins", "rate_limited", "refresh_reuse"]
    actor: Optional[str] = None
    count: int
    first_at: str
    last_at: str


class TypeCount(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_type: str
    count: int


class AuditSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events_24h: int
    events_7d: int
    logins_24h: int
    failed_logins_24h: int
    rate_limited_24h: int
    by_type_7d: list[TypeCount] = Field(default_factory=list)
    suspicious: list[SuspiciousItem] = Field(default_factory=list)
    scoped_to_clinic: Optional[str] = None


def _scope(principal: AuthPrincipal) -> Optional[str]:
    """None = sees everything; a clinic id = only that clinic's events. 403 for others."""
    if principal_is_global(principal) or principal.role in {"admin", "service"}:
        return None
    if principal.role == "clinic_owner" and principal.clinic_id:
        return principal.clinic_id
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=api_error("audit_forbidden", "Only administrators can view the audit log."),
    )


def _query(
    scope: Optional[str],
    *,
    event_type: Optional[str],
    actor: Optional[str],
    outcome: Optional[str],
    clinic_id: Optional[str],
    since: Optional[str],
    until: Optional[str],
    limit: int,
    cursor: Optional[str],
) -> AuditQuery:
    return AuditQuery(
        event_type=(event_type or "").strip() or None,
        actor=(actor or "").strip() or None,
        outcome=outcome,
        # A clinic owner's own clinic always wins over any clinic filter they send.
        clinic_id=scope or ((clinic_id or "").strip() or None),
        since=since,
        until=until,
        limit=limit,
        cursor=cursor,
    )


def _recent(container: AppContainer, scope: Optional[str], now: datetime) -> list[dict[str, Any]]:
    since = (now - timedelta(days=7)).isoformat()
    events, _ = container.audit.query(AuditQuery(clinic_id=scope, since=since, limit=SUMMARY_MAX_EVENTS))
    return events


def _iso(value: Optional[str], name: str) -> Optional[str]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=api_error("invalid_date", f"'{name}' must be an ISO date.")) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _record(container: AppContainer, principal: AuthPrincipal, event: str, detail: Optional[str] = None) -> None:
    container.audit.record(
        event_type=event,
        actor=principal.subject,
        resource="/api/v1/admin/audit",
        outcome=AuditOutcome.INFO,
        detail=detail,
        clinic_id=principal.clinic_id,
    )


@router.get("", response_model=AuditPage)
def list_audit(
    event_type: Optional[str] = Query(default=None, max_length=80),
    actor: Optional[str] = Query(default=None, max_length=120),
    outcome: Optional[Outcome] = None,
    clinic_id: Optional[str] = Query(default=None, max_length=80),
    since: Optional[str] = Query(default=None, max_length=40),
    until: Optional[str] = Query(default=None, max_length=40),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: Optional[str] = Query(default=None, max_length=120),
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_actor),
) -> AuditPage:
    scope = _scope(principal)
    q = _query(
        scope, event_type=event_type, actor=actor, outcome=outcome, clinic_id=clinic_id,
        since=_iso(since, "since"), until=_iso(until, "until"), limit=limit, cursor=cursor,
    )
    items, next_cursor = container.audit.query(q)
    brute = flagged_actors(find_suspicious(_recent(container, scope, datetime.now(timezone.utc))))
    if cursor is None:
        # One record per opened screen / new filter, not per "load more".
        _record(container, principal, "admin.audit_view")
    return AuditPage(
        items=[AuditEventOut(**{k: e.get(k) for k in AuditEventOut.model_fields if k != "suspicious"},
                             suspicious=is_flagged(e, brute)) for e in items],
        next_cursor=next_cursor,
        scoped_to_clinic=scope,
    )


@router.get("/summary", response_model=AuditSummary)
def audit_summary(
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_actor),
) -> AuditSummary:
    scope = _scope(principal)
    now = datetime.now(timezone.utc)
    events = _recent(container, scope, now)
    return AuditSummary(**summarize(events, now=now), suspicious=find_suspicious(events), scoped_to_clinic=scope)


@router.get("/export.csv")
def export_audit_csv(
    event_type: Optional[str] = Query(default=None, max_length=80),
    actor: Optional[str] = Query(default=None, max_length=120),
    outcome: Optional[Outcome] = None,
    clinic_id: Optional[str] = Query(default=None, max_length=80),
    since: Optional[str] = Query(default=None, max_length=40),
    until: Optional[str] = Query(default=None, max_length=40),
    container: AppContainer = Depends(get_container),
    principal: AuthPrincipal = Depends(require_actor),
) -> Response:
    scope = _scope(principal)
    base = dict(
        event_type=event_type, actor=actor, outcome=outcome, clinic_id=clinic_id,
        since=_iso(since, "since"), until=_iso(until, "until"),
    )
    rows: list[dict[str, Any]] = []
    cursor: Optional[str] = None
    while len(rows) < EXPORT_MAX_ROWS:
        page, cursor = container.audit.query(_query(scope, **base, limit=500, cursor=cursor))
        rows.extend(page)
        if cursor is None:
            break
    rows = rows[:EXPORT_MAX_ROWS]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_COLUMNS)
    for e in rows:
        writer.writerow([csv_cell(e.get(col)) for col in CSV_COLUMNS])
    _record(container, principal, "admin.audit_export", detail=f"{len(rows)} rows")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    return Response(
        content="﻿" + buf.getvalue(),  # BOM so Excel reads UTF-8 (Turkish letters)
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="vetmind-audit-{stamp}.csv"',
            "X-Audit-Rows": str(len(rows)),
            "X-Audit-Truncated": "1" if cursor is not None else "0",
        },
    )
