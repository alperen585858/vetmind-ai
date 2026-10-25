"""Append-only FeedbackEvent store for reject/revision/approve training signals.

No PHI, DICOM paths, or pixel data. Separate from ``security.audit`` and
``llm.feedback`` (AI-vs-expert text pairs).
"""

from __future__ import annotations

import json
import re
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from uuid import uuid4

REASON_CODES = frozenset(
    {
        "wrong_finding",
        "missing_finding",
        "report_quality",
        "wrong_laterality",
        "other",
    }
)

_EMAIL = re.compile(r"\b[\w.+-]+@[\w.-]+\.\w+\b")
_PHONE = re.compile(r"\b(?:\+?\d[\d\s().-]{7,}\d)\b")
_TC = re.compile(r"\b\d{11}\b")


def _redact(text: str | None) -> str | None:
    if not text:
        return None
    out = _EMAIL.sub("[EMAIL]", text)
    out = _PHONE.sub("[PHONE]", out)
    out = _TC.sub("[ID]", out)
    return out[:2000]


@dataclass(frozen=True)
class FeedbackEvent:
    event_id: str
    case_id: str
    report_version_id: str | None
    actor: str
    clinic_id: str | None
    decision: str  # approve | reject | request_revision
    reason_codes: tuple[str, ...]
    free_text: str | None
    model_ids: tuple[str, ...]
    finding_ids: tuple[str, ...]
    source_kind: str | None
    rag_passage_ids: tuple[str, ...]
    created_at: str

    def to_json(self) -> dict[str, Any]:
        data = asdict(self)
        data["reason_codes"] = list(self.reason_codes)
        data["model_ids"] = list(self.model_ids)
        data["finding_ids"] = list(self.finding_ids)
        data["rag_passage_ids"] = list(self.rag_passage_ids)
        return data


class FeedbackStore:
    """Thread-safe JSONL sink. In-memory when path is None (tests/demo)."""

    def __init__(self, path: Path | None = None) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._memory: list[FeedbackEvent] = []
        if self._path is not None:
            self._path.parent.mkdir(parents=True, exist_ok=True)

    @property
    def path(self) -> Path | None:
        return self._path

    def record(
        self,
        *,
        case_id: str,
        decision: str,
        actor: str,
        clinic_id: str | None = None,
        report_version_id: str | None = None,
        reason_codes: Iterable[str] | None = None,
        free_text: str | None = None,
        model_ids: Iterable[str] | None = None,
        finding_ids: Iterable[str] | None = None,
        source_kind: str | None = None,
        rag_passage_ids: Iterable[str] | None = None,
    ) -> FeedbackEvent:
        codes = tuple(c for c in (reason_codes or ()) if c in REASON_CODES)
        event = FeedbackEvent(
            event_id=f"fb-{uuid4().hex[:12]}",
            case_id=case_id,
            report_version_id=report_version_id,
            actor=actor,
            clinic_id=clinic_id,
            decision=decision,
            reason_codes=codes,
            free_text=_redact(free_text),
            model_ids=tuple(model_ids or ()),
            finding_ids=tuple(finding_ids or ()),
            source_kind=source_kind,
            rag_passage_ids=tuple(rag_passage_ids or ()),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        line = json.dumps(event.to_json(), ensure_ascii=False)
        with self._lock:
            self._memory.append(event)
            if self._path is not None:
                with self._path.open("a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
        return event

    def list_events(
        self,
        *,
        clinic_id: str | None = None,
        limit: int = 500,
    ) -> list[FeedbackEvent]:
        with self._lock:
            if self._path is not None and self._path.exists():
                items: list[FeedbackEvent] = []
                for raw in self._path.read_text(encoding="utf-8").splitlines():
                    if not raw.strip():
                        continue
                    data = json.loads(raw)
                    items.append(
                        FeedbackEvent(
                            event_id=data["event_id"],
                            case_id=data["case_id"],
                            report_version_id=data.get("report_version_id"),
                            actor=data["actor"],
                            clinic_id=data.get("clinic_id"),
                            decision=data["decision"],
                            reason_codes=tuple(data.get("reason_codes") or ()),
                            free_text=data.get("free_text"),
                            model_ids=tuple(data.get("model_ids") or ()),
                            finding_ids=tuple(data.get("finding_ids") or ()),
                            source_kind=data.get("source_kind"),
                            rag_passage_ids=tuple(data.get("rag_passage_ids") or ()),
                            created_at=data["created_at"],
                        )
                    )
            else:
                items = list(self._memory)
        if clinic_id is not None:
            items = [e for e in items if e.clinic_id == clinic_id]
        return items[-max(1, limit) :]

    def export_jsonl(self, *, clinic_id: str | None = None) -> str:
        events = self.list_events(clinic_id=clinic_id, limit=10_000)
        return "\n".join(json.dumps(e.to_json(), ensure_ascii=False) for e in events) + (
            "\n" if events else ""
        )
