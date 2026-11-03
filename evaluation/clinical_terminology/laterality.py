"""Literal laterality signals; never infer side from anatomy or morphology."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Side = Literal["LEFT", "RIGHT", "MIDLINE", "BILATERAL", "UNKNOWN", "AMBIGUOUS"]

# Explicit language markers only; not a medical interpretation engine.
_MARKERS: dict[Side, tuple[str, ...]] = {
    "LEFT": (r"\bleft\b", r"\bsol\b"),
    "RIGHT": (r"\bright\b", r"\bsağ\b", r"\bsag\b"),
    "MIDLINE": (r"\bmidline\b", r"\borta\s+hat\b"),
    "BILATERAL": (r"\bbilateral\b", r"\biki\s+taraflı\b", r"\biki\s+tarafli\b"),
    "UNKNOWN": (),
    "AMBIGUOUS": (),
}
_COMPILED = {
    side: tuple(re.compile(pattern, flags=re.IGNORECASE | re.UNICODE) for pattern in patterns)
    for side, patterns in _MARKERS.items()
}


@dataclass(frozen=True, slots=True)
class LateralitySignal:
    side: Side
    explicit: bool
    conflicting: bool


def detect_laterality(text: str) -> LateralitySignal:
    if not isinstance(text, str):
        raise TypeError("laterality input must be text")
    found = {side for side, regexes in _COMPILED.items() if any(r.search(text) for r in regexes)}
    if not found:
        return LateralitySignal(side="UNKNOWN", explicit=False, conflicting=False)
    if len(found) > 1:
        return LateralitySignal(side="AMBIGUOUS", explicit=True, conflicting=True)
    only = next(iter(found))
    return LateralitySignal(side=only, explicit=True, conflicting=False)


def sides_compatible(reference: Side, prediction: Side) -> bool:
    """Unknown and ambiguous are never affirmative evidence of side agreement."""
    return reference == prediction and reference not in ("UNKNOWN", "AMBIGUOUS")
