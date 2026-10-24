"""Grounding checks for prompt-generated drafts (the "validation layer").

Runs inside ``ReportValidator`` so it re-checks after expert edits too. Only applies
to drafts with ``generation.prompt_version`` set — template/mock drafts carry no
inline citation markers. Produces warnings, never errors: a radiologist decides.
"""

from __future__ import annotations

import re

from app.llm.structured_output import MARKER_GROUP_RE, extract_markers
from app.schemas.report import DraftReport

SECTIONS = ("technique", "findings", "impression", "recommendations")
CITED_SECTIONS = ("findings", "impression")
MIN_CLAIM_CHARS = 25
MAX_LISTED_PER_SECTION = 3

# Certainty / absence claims a draft must not make. Hedged forms ("ekarte edilemez",
# "cannot be ruled out") are deliberately not matched.
OVERCLAIM_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("definitive diagnosis", re.compile(r"\bkesin\s+tan[ıi]|\bdefinitive(ly)?\b|\bdefinite diagnosis", re.I)),
    ("certainty", re.compile(r"\bkesinlikle\b|\bwithout (any )?doubt\b|\bşüphesiz\b", re.I)),
    ("confirmed diagnosis", re.compile(r"\btan[ıi]\w*\s+(doğrulan|kesinleş)\w*|\bconfirm(s|ed)? the diagnosis\b", re.I)),
    (
        "excluded diagnosis",
        re.compile(r"\b(ekarte edil|dışlan)(di|mıştır|miştir|ır)\b|\bruled out\b|\brules out\b", re.I),
    ),
    (
        "absence of disease",
        re.compile(
            r"\b(patoloji|lezyon|anormallik)\w*\s+(saptanmad|izlenmed|yoktur|bulunmamaktad)\w*"
            r"|\b(normal sınırlarda|çalışma normal)\b"
            r"|\bno (evidence of )?(abnormalit|patholog|lesion)\w*"
            r"|\b(normal study|within normal limits)\b",
            re.I,
        ),
    ),
)

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")


def _sentences(text: str) -> list[str]:
    out: list[str] = []
    for raw in _SENTENCE_SPLIT_RE.split(text):
        s = raw.strip().lstrip("-•*0123456789. )").strip()
        if not s:
            continue
        # A marker placed after the full stop ("… var. [F1].") belongs to the previous sentence.
        if out and not MARKER_GROUP_RE.sub("", s).strip(" .;,"):
            out[-1] = f"{out[-1]} {s}"
        else:
            out.append(s)
    return out


def _is_claim(sentence: str) -> bool:
    return len(sentence) >= MIN_CLAIM_CHARS and not sentence.endswith(":")


def _short(sentence: str, n: int = 90) -> str:
    return sentence if len(sentence) <= n else sentence[: n - 1] + "…"


def check_grounding(report: DraftReport) -> list[str]:
    if not report.generation.prompt_version:
        return []
    warnings: list[str] = []
    known = report.citation_map
    cited_anywhere: set[str] = set()

    for name in SECTIONS:
        text = getattr(report, name).text
        markers = extract_markers(text)
        cited_anywhere.update(markers)
        unknown = [m for m in markers if m not in known]
        if unknown:
            warnings.append(
                f"Grounding: {name} cites unknown reference(s) {', '.join(unknown)} — "
                "not in the findings/passages given to the model."
            )
        for label, pattern in OVERCLAIM_PATTERNS:
            match = pattern.search(text)
            if match:
                warnings.append(
                    f"Grounding: {name} contains a {label} statement (\"{match.group(0)}\"); "
                    "drafts must keep findings hedged."
                )

    for name in CITED_SECTIONS:
        uncited = [
            s for s in _sentences(getattr(report, name).text)
            if _is_claim(s) and not MARKER_GROUP_RE.search(s)
        ]
        if uncited:
            listed = "; ".join(f'"{_short(s)}"' for s in uncited[:MAX_LISTED_PER_SECTION])
            more = f" (+{len(uncited) - MAX_LISTED_PER_SECTION} more)" if len(uncited) > MAX_LISTED_PER_SECTION else ""
            warnings.append(f"Grounding: {len(uncited)} uncited statement(s) in {name}: {listed}{more}.")

    omitted = [a for a in known if a.startswith("F") and a not in cited_anywhere]
    if omitted:
        warnings.append(
            "Grounding: imaging finding(s) not mentioned in the draft: "
            + ", ".join(f"{a} ({known[a]})" for a in omitted)
            + "."
        )
    return warnings
