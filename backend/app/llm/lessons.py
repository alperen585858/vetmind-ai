"""Revision lessons: expert corrections the report model should remember.

When a radiologist asks for a revision and ticks "remember", the note becomes a
``RevisionLesson`` tagged with the case's region / species / modality / finding codes.
Later drafts for *similar* cases get the matching lessons in their prompt, so the same
mistake is not repeated. Lessons are guidance only: they never add findings, and the
expert can switch any lesson off.

Storage is a small JSON file (``data/revision_lessons.json``) or in-memory when no path.
Lesson text is PII-redacted before it is stored.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from app.llm.privacy import redact_personal_data

MAX_LESSON_CHARS = 500
DEFAULT_MAX_LESSONS = 3
# Regions too broad to match on alone: also require the same modality.
_BROAD_REGIONS = frozenset({"OTHER", "UNKNOWN"})


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RevisionLesson(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lesson_id: str
    instruction: str = Field(min_length=1, max_length=MAX_LESSON_CHARS)
    region: str
    species: str
    modality: str
    finding_codes: list[str] = Field(default_factory=list)
    reason_codes: list[str] = Field(default_factory=list)
    source_case_id: Optional[str] = None
    created_by: str
    created_at: datetime = Field(default_factory=_now)
    active: bool = True
    times_applied: int = 0
    last_applied_at: Optional[datetime] = None


class LessonContext(BaseModel):
    """What a draft is about — the only fields lesson matching looks at."""

    model_config = ConfigDict(extra="forbid")

    region: str
    species: str
    modality: str
    finding_codes: list[str] = Field(default_factory=list)


def clean_instruction(text: str, *, known: Iterable[tuple[str | None, str]] = ()) -> str:
    redacted = redact_personal_data(text or "", known=list(known)).text
    collapsed = " ".join(redacted.split())
    return collapsed[:MAX_LESSON_CHARS].strip()


def _score(lesson: RevisionLesson, ctx: LessonContext) -> float | None:
    """None = not applicable. Higher = more specific match."""
    if not lesson.active:
        return None
    if lesson.region != ctx.region:
        return None
    if lesson.region in _BROAD_REGIONS and lesson.modality != ctx.modality:
        return None
    if lesson.species not in {"other", ctx.species} and ctx.species != "other":
        return None
    score = 1.0
    if lesson.species == ctx.species:
        score += 1.0
    if lesson.modality == ctx.modality:
        score += 0.5
    overlap = set(lesson.finding_codes) & set(ctx.finding_codes)
    score += 2.0 * len(overlap)
    return score


class LessonStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._lessons: dict[str, RevisionLesson] = {}
        self._load()

    # ---- persistence -------------------------------------------------
    def _load(self) -> None:
        if self.path is None or not self.path.is_file():
            return
        raw = json.loads(self.path.read_text(encoding="utf-8") or "{}")
        for item in raw.get("lessons", []):
            lesson = RevisionLesson.model_validate(item)
            self._lessons[lesson.lesson_id] = lesson

    def _save(self) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "note": "Expert revision lessons (PII-redacted). Guidance for the report model, not clinical rules.",
            "lessons": [lesson.model_dump(mode="json") for lesson in self._lessons.values()],
        }
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    # ---- CRUD ----------------------------------------------------------
    def add(
        self,
        *,
        instruction: str,
        context: LessonContext,
        created_by: str,
        source_case_id: str | None = None,
        reason_codes: Iterable[str] = (),
    ) -> RevisionLesson:
        lesson = RevisionLesson(
            lesson_id=f"lesson-{uuid4().hex[:10]}",
            instruction=instruction,
            region=context.region,
            species=context.species,
            modality=context.modality,
            finding_codes=sorted(set(context.finding_codes)),
            reason_codes=sorted(set(reason_codes)),
            source_case_id=source_case_id,
            created_by=created_by,
        )
        with self._lock:
            self._lessons[lesson.lesson_id] = lesson
            self._save()
        return lesson

    def list(self) -> list[RevisionLesson]:
        with self._lock:
            return sorted(self._lessons.values(), key=lambda x: x.created_at, reverse=True)

    def get(self, lesson_id: str) -> RevisionLesson | None:
        with self._lock:
            return self._lessons.get(lesson_id)

    def update(self, lesson_id: str, *, active: bool | None = None, instruction: str | None = None) -> RevisionLesson | None:
        with self._lock:
            lesson = self._lessons.get(lesson_id)
            if lesson is None:
                return None
            changes: dict = {}
            if active is not None:
                changes["active"] = active
            if instruction is not None:
                changes["instruction"] = instruction
            lesson = lesson.model_copy(update=changes)
            RevisionLesson.model_validate(lesson.model_dump())
            self._lessons[lesson_id] = lesson
            self._save()
            return lesson

    def delete(self, lesson_id: str) -> bool:
        with self._lock:
            if self._lessons.pop(lesson_id, None) is None:
                return False
            self._save()
            return True

    # ---- matching ------------------------------------------------------
    def match(self, ctx: LessonContext, *, limit: int = DEFAULT_MAX_LESSONS) -> list[RevisionLesson]:
        with self._lock:
            scored = [(s, lesson) for lesson in self._lessons.values() if (s := _score(lesson, ctx)) is not None]
        scored.sort(key=lambda x: (x[0], x[1].created_at), reverse=True)
        return [lesson for _, lesson in scored[: max(0, limit)]]

    def mark_applied(self, lesson_ids: Iterable[str]) -> None:
        ids = list(lesson_ids)
        if not ids:
            return
        with self._lock:
            now = _now()
            for lesson_id in ids:
                lesson = self._lessons.get(lesson_id)
                if lesson is not None:
                    self._lessons[lesson_id] = lesson.model_copy(
                        update={"times_applied": lesson.times_applied + 1, "last_applied_at": now}
                    )
            self._save()
