"""Finding-code family map for conflict grouping (not clinical validation)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

_ONTOLOGY_PATH = Path(__file__).with_name("finding_ontology.yaml")


def normalize_code(finding_code: str) -> str:
    """Uppercase; treat underscore and hyphen as equivalent."""
    return (finding_code or "").strip().upper().replace("_", "-").replace(" ", "-")


@lru_cache(maxsize=1)
def _load() -> dict[str, Any]:
    if not _ONTOLOGY_PATH.exists():
        return {"families": {}, "opposing_pairs": []}
    data = yaml.safe_load(_ONTOLOGY_PATH.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        return {"families": {}, "opposing_pairs": []}
    return data


def clear_ontology_cache() -> None:
    _load.cache_clear()
    _allowed_codes.cache_clear()
    _opposing_set.cache_clear()


@lru_cache(maxsize=1)
def _allowed_codes() -> frozenset[str]:
    codes: set[str] = set()
    families = _load().get("families") or {}
    for members in families.values():
        if not isinstance(members, list):
            continue
        for m in members:
            codes.add(normalize_code(str(m)))
    return frozenset(codes)


@lru_cache(maxsize=1)
def _opposing_set() -> frozenset[frozenset[str]]:
    pairs: set[frozenset[str]] = set()
    raw = _load().get("opposing_pairs") or []
    if not isinstance(raw, list):
        return frozenset()
    for item in raw:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        a, b = normalize_code(str(item[0])), normalize_code(str(item[1]))
        if a and b and a != b:
            pairs.add(frozenset({a, b}))
    return frozenset(pairs)


def code_family(finding_code: str) -> str:
    """Return ontology family id, or the code itself if unmapped."""
    code = normalize_code(finding_code)
    families = _load().get("families") or {}
    for family_id, members in families.items():
        if not isinstance(members, list):
            continue
        normalized = {normalize_code(str(m)) for m in members}
        if code in normalized:
            return str(family_id).upper()
    return code


def same_family(code_a: str, code_b: str) -> bool:
    return code_family(code_a) == code_family(code_b)


def is_technique_code(finding_code: str) -> bool:
    return code_family(finding_code) == "TECHNIQUE"


def codes_oppose(code_a: str, code_b: str) -> bool:
    a = _CODE_ALIASES.get(normalize_code(code_a), normalize_code(code_a))
    b = _CODE_ALIASES.get(normalize_code(code_b), normalize_code(code_b))
    if not a or not b or a == b:
        return False
    # Match pairs whether stored as DILATION or DILATATION spelling.
    if frozenset({a, b}) in _opposing_set():
        return True
    a_alt = "VENTRICLE-DILATATION" if a == "VENTRICLE-DILATION" else a
    b_alt = "VENTRICLE-DILATATION" if b == "VENTRICLE-DILATION" else b
    return frozenset({a_alt, b}) in _opposing_set() or frozenset({a, b_alt}) in _opposing_set() or frozenset(
        {a_alt, b_alt}
    ) in _opposing_set()


def is_known_finding_code(finding_code: str) -> bool:
    return normalize_code(finding_code) in _allowed_codes()


# Spelling / synonym aliases → canonical hyphenated code (after normalize_code).
_CODE_ALIASES = {
    "VENTRICLE-DILATATION": "VENTRICLE-DILATION",
    "BRAIN-VENTRICLES": "BRAIN-VENTRICLE",
    # Descriptive ventricle sightings → one observational code family member.
    "VENTRICLE-VISUAL": "VENTRICLE-VIEW",
    "VENTRICLE-SHAPE": "VENTRICLE-STRUCTURE",
    "VENTRICULAR-SYSTEM": "BRAIN-VENTRICLE",
}


def canonicalize_finding_code(finding_code: str) -> str:
    """Map aliases to a canonical hyphenated form when known; else normalized raw."""
    code = normalize_code(finding_code)
    if not code:
        return "VLM-UNSPECIFIED"
    code = _CODE_ALIASES.get(code, code)
    # Prefer the first listed ontology member spelling for the same normalized key.
    families = _load().get("families") or {}
    for members in families.values():
        if not isinstance(members, list):
            continue
        for m in members:
            if normalize_code(str(m)) == code:
                # Prefer hyphenated form in YAML when present.
                raw = str(m).strip().upper().replace("_", "-")
                return _CODE_ALIASES.get(normalize_code(raw), raw)
    return code
