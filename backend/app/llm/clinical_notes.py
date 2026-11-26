"""Clinical notes added after a case was sent ("Klinik öyküye ek bilgi", #68).

Notes live in ``CaseRecord.clinical_notes_log``. They used to be appended to the free-text
``clinical_history`` as ``[<ISO time> · <subject>] <body>``, which leaked raw stamps into
the complaint / history fields. New notes are no longer appended; stamps already stored in
older records are stripped when the history is read, and the notes are given to the models
as their own section instead.
"""

from __future__ import annotations

import re

from app.schemas.case import CaseRecord

# "[2026-11-23T12:04:39.984157+00:00 · anonymous] aaa" up to the next stamp or the end.
_STAMP = re.compile(
    r"(?:\n\n|^)\[\d{4}-\d{2}-\d{2}T[0-9:.+\-Z]+ · [^\]\n]+\] .*?(?=\n\n\[\d{4}-\d{2}-\d{2}T|\Z)",
    re.DOTALL,
)

NOTES_HEADING = {
    "tr": "Vaka gönderildikten sonra eklenen klinik bilgi:",
    "en": "Clinical information added after the case was sent:",
}


def strip_note_stamps(text: str | None) -> str:
    """Free-text history without the legacy note stamps."""
    return _STAMP.sub("", text or "").strip()


def clinical_notes_text(case: CaseRecord, *, language: str = "tr") -> str:
    """Clinical (not internal) notes as their own section; "" when there are none."""
    bodies = [n.body.strip() for n in case.clinical_notes_log if n.kind == "clinical" and n.body.strip()]
    if not bodies:
        return ""
    heading = NOTES_HEADING.get(language, NOTES_HEADING["tr"])
    return "\n".join([heading, *(f"- {b}" for b in bodies)])


def history_with_notes(case: CaseRecord, *, language: str = "tr") -> str:
    """Clean free-text history followed by the notes section (what models should read)."""
    parts = [strip_note_stamps(case.clinical_history), clinical_notes_text(case, language=language)]
    return "\n\n".join(p for p in parts if p)
