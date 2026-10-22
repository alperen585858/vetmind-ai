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
    """Thread-safe JSONL audit sink. In-memory when path is None (tests/demo)."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path
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
        with self._lock:
            self._memory.append(event)
            if self._path is not None:
                with self._path.open("a", encoding="utf-8") as fh:
                    fh.write(line)
        return event

    def list_events(self, *, limit: int = 200) -> list[dict[str, Any]]:
        with self._lock:
            items = self._memory[-max(1, limit) :]
        return [asdict(e) for e in items]
