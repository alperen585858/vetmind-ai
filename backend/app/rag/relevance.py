"""Case-aware relevance rules for RAG: region/species filter + cleaner query text.

Knowledge-base docs carry optional ``regions`` / ``species`` tags (see corpus.py).
A case only sees docs whose tags fit its anatomical region and species; untagged
docs (clinic-uploaded ``custom-*``) are always eligible. ``META`` docs (reporting
safety notes) are never retrieved as clinical context.

Region tags in use: BRAIN, SKULL, CERVICAL, SPINE (any level), SPINE_TL
(thoracolumbar only), THORAX, META.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

# Doc region tags each case region may draw from. Missing key = no region filter
# (OTHER / UNKNOWN cases search every non-skull clinical doc and rely on the score floor).
_REGION_ALLOW: dict[str, frozenset[str]] = {
    "BRAIN": frozenset({"BRAIN"}),
    "CERVICAL": frozenset({"CERVICAL", "SPINE"}),
    "THORAX": frozenset({"THORAX"}),
}
# Skull bone / suture references matter for CT and radiographs, not brain MRI.
_SKULL_MODALITIES = frozenset({"CT", "XR", "OTHER"})
_EXCLUDED_TAGS = frozenset({"META"})

_SPECIES_TR = {"canine": "köpek", "feline": "kedi"}
_MODALITY_TR = {"MR": "MR", "CT": "BT tomografi", "XR": "röntgen radyografi"}
_REGION_TR = {"BRAIN": "beyin", "CERVICAL": "servikal boyun", "THORAX": "toraks akciğer"}


@dataclass(frozen=True)
class RagFilter:
    """Case context used to narrow retrieval. All fields optional (= no filtering)."""

    region: str | None = None
    species: str | None = None
    modality: str | None = None

    @property
    def _skull_allowed(self) -> bool:
        # Skull/suture/breed-morphology docs only fit head CT / radiographs. Without this
        # their long, generic passages win weak queries (abdomen, limb) by sheer overlap.
        return (self.region or "").upper() == "BRAIN" and (self.modality or "").upper() in _SKULL_MODALITIES

    def allowed_regions(self) -> frozenset[str] | None:
        allowed = _REGION_ALLOW.get((self.region or "").upper())
        if allowed is not None and self._skull_allowed:
            allowed = allowed | {"SKULL"}
        return allowed

    def allows(self, regions: Iterable[str], species: Iterable[str]) -> bool:
        doc_regions = {r.upper() for r in regions}
        if doc_regions & _EXCLUDED_TAGS:
            return False
        if self.region and "SKULL" in doc_regions and not self._skull_allowed:
            return False
        doc_species = {s.lower() for s in species}
        case_species = (self.species or "").lower()
        if doc_species and case_species in _SPECIES_TR and case_species not in doc_species:
            return False
        allowed = self.allowed_regions()
        if allowed is None or not doc_regions:
            return True
        return bool(doc_regions & allowed)


def build_retrieval_query(
    *,
    species: str | None,
    modality: str | None,
    region: str | None,
    history: str | None,
    findings: Sequence[tuple[str, str]] = (),
    document_text: str | None = None,
) -> str:
    """Turkish, content-only query: no enum codes or synthetic finding codes."""
    parts = [
        _SPECIES_TR.get((species or "").lower(), ""),
        _MODALITY_TR.get((modality or "").upper(), ""),
        _REGION_TR.get((region or "").upper(), ""),
        history or "",
    ]
    for description, location in findings:
        parts.append(description or "")
        parts.append(location or "")
    if document_text:
        parts.append(document_text[:300])
    return " ".join(p.strip() for p in parts if p and p.strip())
