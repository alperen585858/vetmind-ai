"""Decide whether a draft may carry differential diagnoses, and drop non-diagnoses.

A differential list only makes sense when the imaging model reported something that
could be abnormal. Technique notes ("image quality adequate") and descriptive anatomy
("hemispheres and sulci are visible") are not findings to diagnose from; listing
"structural or idiopathic disorder — low" next to them reads like a real suspicion.

Also removes items that are really *limitations* ("appearance not assessable due to
unknown sequence") and supporting/against phrases that only restate a limitation.
"""

from __future__ import annotations

import re
from typing import Iterable, Protocol, Sequence

from app.models.ontology import is_technique_code
from app.schemas.enums import FindingStatus

# Descriptive "this structure is visible" codes the VLM emits; not lesion claims.
_DESCRIPTIVE_CODE = re.compile(
    r"^(VISIBLE-ANATOMY|ANATOMIC-STRUCTURE|REGION-APPEARANCE|BRAIN-(STRUCTURE|PARENCHYMA|VENTRICLES?)|"
    r"VENTRICLE-(VIEW|VISUAL|STRUCTURE|SHAPE)|VENTRICULAR-SYSTEM|NORMAL-ANATOMY)(-|$)",
    re.IGNORECASE,
)

# A "diagnosis" that is really a statement about what could not be assessed.
_LIMITATION_TEXT = re.compile(
    r"değerlendirileme|degerlendirileme|belirsizli[gğ]|sekans|artefakt|teknik\s+(sınır|yetersiz)|"
    r"yetersiz\s+(görüntü|kalite)|tanısal\s+olmayan|non[-\s]?diagnostic|unassessable|"
    r"not\s+assess|indeterminate\s+(study|appearance)|unknown\s+sequence|image\s+quality",
    re.IGNORECASE,
)


class _FindingLike(Protocol):
    finding_code: str
    finding_status: FindingStatus


def is_descriptive_code(code: str) -> bool:
    return bool(_DESCRIPTIVE_CODE.search((code or "").strip().replace("_", "-")))


def is_actionable(finding: _FindingLike) -> bool:
    """A finding a radiologist could build a differential on."""
    code = finding.finding_code or ""
    if is_technique_code(code) or is_descriptive_code(code):
        return False
    return finding.finding_status != FindingStatus.NOT_ASSESSED


def actionable_findings(findings: Iterable[_FindingLike]) -> list[_FindingLike]:
    return [f for f in findings if is_actionable(f)]


def is_limitation_text(text: str) -> bool:
    return bool(_LIMITATION_TEXT.search(text or ""))


class _DiffLike(Protocol):
    name: str
    supporting: list[str]
    against: list[str]
    citations: list[str]


def filter_differentials(
    items: Sequence[_DiffLike],
    *,
    actionable_aliases: set[str],
) -> list[_DiffLike]:
    """Drop limitation-type items and reasoning-free items.

    Callers only invoke this when at least one actionable finding exists (no actionable
    finding → no list at all). Literature-only alternatives ([S#]) are kept: once there is
    a lesion, ranking alternatives from background passages is legitimate.
    ``actionable_aliases`` is used to keep items that cite an actionable finding even when
    their phrases were all limitation text.

    Mutates ``supporting``/``against`` of kept items to drop limitation-only phrases.
    """
    kept: list[_DiffLike] = []
    for d in items:
        if is_limitation_text(d.name):
            continue
        d.supporting = [p for p in d.supporting if p.strip() and not is_limitation_text(p)]
        d.against = [p for p in d.against if p.strip() and not is_limitation_text(p)]
        rests_on_finding = any(c in actionable_aliases for c in d.citations)
        if not d.citations:
            continue
        if not d.supporting and not d.against and not rests_on_finding:
            # Nothing on either side: a name with no reasoning is noise for the radiologist.
            continue
        kept.append(d)
    return kept
