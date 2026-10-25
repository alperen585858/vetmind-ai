"""Finding-code family map for conflict grouping (not clinical validation)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

_ONTOLOGY_PATH = Path(__file__).with_name("finding_ontology.yaml")


@lru_cache(maxsize=1)
def _load() -> dict[str, Any]:
    if not _ONTOLOGY_PATH.exists():
        return {"families": {}}
    data = yaml.safe_load(_ONTOLOGY_PATH.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        return {"families": {}}
    return data


def code_family(finding_code: str) -> str:
    """Return ontology family id, or the code itself if unmapped."""
    code = (finding_code or "").strip().upper()
    families = _load().get("families") or {}
    for family_id, members in families.items():
        if not isinstance(members, list):
            continue
        normalized = {str(m).strip().upper() for m in members}
        if code in normalized:
            return str(family_id).upper()
    return code


def same_family(code_a: str, code_b: str) -> bool:
    return code_family(code_a) == code_family(code_b)
