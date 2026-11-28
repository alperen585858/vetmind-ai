"""Append-only security audit records (separate from operational logs).

Stores event type, actor reference, resource reference, timestamp, outcome.
Does not store patient names, DICOM pixels, credentials, or tokens.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any
from uuid import uuid4

_ID_LOCK = threading.Lock()
_last_id_ns = 0


def new_event_id() -> str:
    """Time-ordered audit id (#127): ``aud-<16 hex ns>-<6 hex random>``.

    Lists sort by (timestamp, event_id). Timestamps often tie (Windows clock ticks ~15 ms),
    and a random id made the order of such events random. The nanosecond part only grows
    within a process, so ties keep the order the events were written in.
    """
    global _last_id_ns
    with _ID_LOCK:
        ns = max(time.time_ns(), _last_id_ns + 1)
        _last_id_ns = ns
    return f"aud-{ns:016x}-{uuid4().hex[:6]}"


class AuditOutcome(str, Enum):
    SUCCESS = "success"
    DENIED = "denied"
    ERROR = "error"
    INFO = "info"


@dataclass(frozen=True)
class AuditEvent:
    event_id: str
    event_type: str
    actor: str
    resource: str
    outcome: str
    timestamp: str
    detail: str | None = None
    clinic_id: str | None = None


MAX_QUERY_LIMIT = 500


@dataclass(frozen=True)
class AuditQuery:
    """Filters for the admin audit screen (issue #106). All optional; combined with AND.

    ``event_type`` ending in ``.`` is a prefix ("auth." = every auth event), otherwise exact.
    ``actor`` is a case-insensitive substring. ``since`` / ``until`` are ISO-8601 instants
    (inclusive / exclusive). ``cursor`` is the ``next_cursor`` of the previous page.
    """

    event_type: str | None = None
    actor: str | None = None
    outcome: str | None = None
    clinic_id: str | None = None
    since: str | None = None
    until: str | None = None
    limit: int = 100
    cursor: str | None = None


def _cursor_of(event: dict[str, Any]) -> str:
    return f"{event['timestamp']}|{event['event_id']}"


def _like_escape(value: str) -> str:
    """Make %, _ and the escape char itself literal inside ``LIKE ... ESCAPE '!'``."""
    return value.replace("!", "!!").replace("%", "!%").replace("_", "!_")


def _parse_cursor(cursor: str | None) -> tuple[str, str] | None:
    if not cursor or "|" not in cursor:
        return None
    ts, eid = cursor.rsplit("|", 1)
    return (ts, eid) if ts and eid else None


def _matches(event: dict[str, Any], q: AuditQuery, after: tuple[str, str] | None) -> bool:
    et = event.get("event_type") or ""
    if q.event_type:
        if q.event_type.endswith("."):
            if not et.startswith(q.event_type):
                return False
        elif et != q.event_type:
            return False
    if q.actor and q.actor.strip().lower() not in (event.get("actor") or "").lower():
        return False
    if q.outcome and event.get("outcome") != q.outcome:
        return False
    if q.clinic_id and event.get("clinic_id") != q.clinic_id:
        return False
    ts = event.get("timestamp") or ""
    if q.since and ts < q.since:
        return False
    if q.until and ts >= q.until:
        return False
    if after is not None and (ts, event.get("event_id") or "") >= after:
        return False
    return True


class AuditLogger:
    """Thread-safe audit sink: the ``audit_events`` table when ``conn`` is given (#102),
    else a JSONL file at ``path``, else memory only (tests)."""

    def __init__(self, path: Path | None = None, *, conn: Any = None) -> None:
        self._conn = conn
        self._in_db = conn is not None
        self._path = None if conn is not None else path
        self._lock = threading.Lock()
        self._memory: list[AuditEvent] = []
        if self._path is not None:
            self._path.parent.mkdir(parents=True, exist_ok=True)

    @property
    def path(self) -> Path | None:
        return self._path

    def record(
        self,
        *,
        event_type: str,
        actor: str,
        resource: str,
        outcome: AuditOutcome | str = AuditOutcome.SUCCESS,
        detail: str | None = None,
        clinic_id: str | None = None,
    ) -> AuditEvent:
        outcome_s = outcome.value if isinstance(outcome, AuditOutcome) else str(outcome)
        event = AuditEvent(
            event_id=new_event_id(),
            event_type=event_type,
            actor=actor[:120],
            resource=resource[:240],
            outcome=outcome_s,
            timestamp=datetime.now(timezone.utc).isoformat(),
            detail=(detail[:240] if detail else None),
            clinic_id=clinic_id,
        )
        line = json.dumps(asdict(event), ensure_ascii=False) + "\n"
        if self._in_db:
            self.insert(event)
            return event
        with self._lock:
            self._memory.append(event)
            if self._path is not None:
                with self._path.open("a", encoding="utf-8") as fh:
                    fh.write(line)
        return event

    def insert(self, event: AuditEvent) -> None:
        """Write one event to the database (also used to import old JSONL files)."""
        with self._lock:
            self._insert(event)

    def _insert(self, event: AuditEvent) -> None:
        self._conn.execute(
            "INSERT INTO audit_events (event_id, timestamp, event_type, actor, outcome, clinic_id, payload)"
            " VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING",
            (event.event_id, event.timestamp, event.event_type, event.actor, event.outcome, event.clinic_id,
             json.dumps(asdict(event), ensure_ascii=False)),
        )
        self._conn.commit()

    def query(self, q: AuditQuery) -> tuple[list[dict[str, Any]], str | None]:
        """Newest first. Returns (events, next_cursor); next_cursor is None on the last page."""
        limit = max(1, min(MAX_QUERY_LIMIT, q.limit))
        after = _parse_cursor(q.cursor)
        if self._in_db:
            return self._query_db(q, limit, after)
        with self._lock:
            events = [asdict(e) for e in self._memory] if self._path is None else self._read_file()
        events.sort(key=lambda e: (e.get("timestamp") or "", e.get("event_id") or ""), reverse=True)
        hits: list[dict[str, Any]] = []
        for event in events:
            if _matches(event, q, after):
                hits.append(event)
                if len(hits) > limit:
                    break
        page = hits[:limit]
        return page, (_cursor_of(page[-1]) if len(hits) > limit else None)

    def _read_file(self) -> list[dict[str, Any]]:
        """JSONL mode: the file is the full history (memory only holds this process)."""
        if self._path is None or not self._path.exists():
            return [asdict(e) for e in self._memory]
        out: list[dict[str, Any]] = []
        with self._path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # a torn last line must not break the screen
        return out

    def _query_db(
        self, q: AuditQuery, limit: int, after: tuple[str, str] | None
    ) -> tuple[list[dict[str, Any]], str | None]:
        where: list[str] = []
        params: list[Any] = []
        if q.event_type:
            if q.event_type.endswith("."):
                # SUBSTR works the same on SQLite and Postgres and needs no LIKE escaping.
                where.append("SUBSTR(event_type, 1, ?) = ?")
                params.extend([len(q.event_type), q.event_type])
            else:
                where.append("event_type = ?")
                params.append(q.event_type)
        if q.actor and q.actor.strip():
            where.append("LOWER(actor) LIKE ? ESCAPE '!'")
            params.append("%" + _like_escape(q.actor.strip().lower()) + "%")
        if q.outcome:
            where.append("outcome = ?")
            params.append(q.outcome)
        if q.clinic_id:
            where.append("clinic_id = ?")
            params.append(q.clinic_id)
        if q.since:
            where.append("timestamp >= ?")
            params.append(q.since)
        if q.until:
            where.append("timestamp < ?")
            params.append(q.until)
        if after is not None:
            where.append("(timestamp < ? OR (timestamp = ? AND event_id < ?))")
            params.extend([after[0], after[0], after[1]])
        sql = "SELECT payload FROM audit_events"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY timestamp DESC, event_id DESC LIMIT ?"
        params.append(limit + 1)
        with self._lock:
            rows = self._conn.execute(sql, tuple(params)).fetchall()
        events = [json.loads(r["payload"]) if isinstance(r["payload"], str) else dict(r["payload"]) for r in rows]
        page = events[:limit]
        return page, (_cursor_of(page[-1]) if len(events) > limit else None)

    def list_events(self, *, limit: int = 200) -> list[dict[str, Any]]:
        if self._in_db:
            with self._lock:
                rows = self._conn.execute(
                    "SELECT payload FROM audit_events ORDER BY timestamp DESC, event_id DESC LIMIT ?",
                    (max(1, limit),),
                ).fetchall()
            return [json.loads(r["payload"]) for r in reversed(rows)]
        with self._lock:
            items = self._memory[-max(1, limit) :]
        return [asdict(e) for e in items]
