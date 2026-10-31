"""Mask personal data in free-text clinical history before it leaves the backend.

Applied in ``build_generation_input`` so every provider (including remote HTTP/API
models) only ever sees placeholders such as ``[TELEFON]`` or ``[SAHİP]``.
Regex-based and conservative: clinical numbers (L1-L2, 3 hafta, ALT 245) are kept.
It lowers risk; it does not replace a DPA / KVKK review for real patient data.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field

_UPPER = "A-ZÇĞİÖŞÜ"
_LOWER = "a-zçğıöşü"
_NAME = rf"[{_UPPER}][{_LOWER}]+(?:[ \t]+[{_UPPER}][{_LOWER}]+){{0,2}}"

# (label, placeholder, pattern). Order matters: specific identifiers before phones.
_PATTERNS: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    ("email", "[E-POSTA]", re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")),
    ("iban", "[IBAN]", re.compile(r"\bTR\d{2}(?:[ ]?\d{4}){5}[ ]?\d{2}\b", re.I)),
    ("tc_kimlik", "[TC-KİMLİK]", re.compile(r"(?<![\d-])[1-9]\d{10}(?![\d-])")),
    (
        "phone",
        "[TELEFON]",
        re.compile(
            r"(?<![\w-])(?:\+?90[ .-]?)?(?:\(0?[2-5]\d{2}\)|0?[2-5]\d{2})"
            r"[ .-]?\d{3}[ .-]?\d{2}[ .-]?\d{2}(?![\w-])"
        ),
    ),
    (
        "owner",
        "[SAHİP]",
        re.compile(
            rf"(\b(?:[Hh]ayvan sahibi|[Ss]ahibi|[Ss]ahip|[Oo]wner)(?:nin adı|'nin adı)?"
            rf"\s*[:\-–]?\s*){_NAME}"
        ),
    ),
    ("person", "[KİŞİ]", re.compile(rf"\b(?:Sayın|Bay|Bayan)\s+{_NAME}|\b{_NAME}\s+(?:Bey|Hanım)\b")),
)


# Instruction-like sentences aimed at the model ("ignore all previous instructions…") are not
# clinical content; they are removed before any LLM call (defence in depth next to the prompt rule).
_INSTRUCTION = re.compile(
    r"[^.!?\n]*\b(?:ignore (?:all |any )?(?:the )?(?:previous|prior|above) (?:instructions|rules)"
    r"|disregard (?:all |the )?(?:previous|prior|above)"
    r"|(?:önceki|yukarıdaki) (?:tüm )?(?:talimat|kural)\w*\s+(?:yok say|görmezden gel|unut)\w*"
    r"|you are now\b|system prompt|sistem (?:prompt|talimat)\w*"
    r"|(?:write|say|state|yaz|söyle)\w* that the (?:study|report) is (?:completely )?normal)"
    r"[^.!?\n]*[.!?]?",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class RedactionResult:
    text: str
    counts: dict[str, int] = field(default_factory=dict)


def redact_personal_data(
    text: str | None, *, known: Iterable[tuple[str | None, str]] = ()
) -> RedactionResult:
    """Replace personal identifiers. ``known`` pairs are (exact value, placeholder),
    e.g. the patient's name → ``[HASTA]``; matched case-insensitively as whole words."""
    if not text:
        return RedactionResult(text or "")
    counts: Counter[str] = Counter()
    out = text
    for value, placeholder in known:
        value = (value or "").strip()
        if len(value) < 3:
            continue
        pattern = re.compile(rf"(?<!\w){re.escape(value)}(?!\w)", re.IGNORECASE)
        out, n = pattern.subn(placeholder, out)
        if n:
            counts[placeholder.strip("[]").replace("İ", "I").lower()] += n
    out, n = _INSTRUCTION.subn(" [TALİMAT-BENZERİ METİN ÇIKARILDI] ", out)
    if n:
        counts["instruction"] += n
        out = re.sub(r"\s{2,}", " ", out).strip()
    for label, placeholder, pattern in _PATTERNS:
        if label == "owner":
            out, n = pattern.subn(lambda m: f"{m.group(1)}{placeholder}", out)
        else:
            out, n = pattern.subn(placeholder, out)
        if n:
            counts[label] += n
    return RedactionResult(out, dict(counts))
