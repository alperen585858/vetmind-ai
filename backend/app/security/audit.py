"""Append-only security audit records (separate from operational logs).

Stores event type, actor reference, resource reference, timestamp, outcome.
Does not store patient names, DICOM pixels, credentials, or tokens.
"""

from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any
from uuid import uuid4


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
            event_id=f"aud-{uuid4().hex[:12]}",
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
