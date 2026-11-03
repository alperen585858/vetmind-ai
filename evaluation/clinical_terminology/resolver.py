"""Conservative, contextual terminology lookup with explicit review state."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from evaluation.clinical_terminology.catalog import Domain, Species, TermCatalog, TermKind
from evaluation.terminology import normalize_token

ResolveStatus = Literal[
    "resolved", "pending_review", "ambiguous", "out_of_scope", "unknown"
]
ResolveKind = Literal["preferred", "alias", "none"]


@dataclass(frozen=True, slots=True)
class TermResolution:
    status: ResolveStatus
    canonical_id: str | None
    match_kind: ResolveKind
    catalog_version: str
    # Never echo raw input in assessment objects, logs or CLI outputs.
    candidate_count: int = 0

    @property
    def usable_for_clinical_equivalence(self) -> bool:
        return self.status == "resolved" and self.canonical_id is not None


class CatalogResolver:
    def __init__(self, catalog: TermCatalog) -> None:
        self._catalog = catalog
        index: dict[tuple[TermKind, str], list[tuple[int, bool]]] = {}
        for pos, entry in enumerate(catalog.terms):
            for surface_index, label in enumerate(entry.surfaces()):
                index.setdefault((entry.kind, normalize_token(label)), []).append(
                    (pos, surface_index == 0)
                )
        self._index = {key: tuple(matches) for key, matches in index.items()}

    @property
    def catalog(self) -> TermCatalog:
        return self._catalog

    def resolve(
        self,
        label: str,
        *,
        kind: TermKind,
        species: Species | None,
        domain: Domain | None,
    ) -> TermResolution:
        if not isinstance(label, str):
            raise TypeError("label must be text")
        key = normalize_token(label)
        if not key:
            return self._result("unknown")
        candidates = self._index.get((kind, key), ())
        if not candidates:
            return self._result("unknown")
        eligible = [
            (self._catalog.terms[pos], preferred)
            for pos, preferred in candidates
            if self._catalog.terms[pos].scope.accepts(species, domain)
        ]
        if not eligible:
            return self._result("out_of_scope", count=len(candidates))
        if len(eligible) != 1:
            return self._result("ambiguous", count=len(eligible))
        entry, preferred = eligible[0]
        if entry.review_state != "expert_reviewed":
            return self._result("pending_review", count=1)
        return TermResolution(
            status="resolved", canonical_id=entry.canonical_id,
            match_kind="preferred" if preferred else "alias",
            catalog_version=self._catalog.catalog_version,
            candidate_count=1,
        )

    def _result(self, status: ResolveStatus, count: int = 0) -> TermResolution:
        return TermResolution(
            status=status, canonical_id=None, match_kind="none",
            catalog_version=self._catalog.catalog_version, candidate_count=count,
        )

    def equivalent(
        self, left: str, right: str, *, kind: TermKind,
        species: Species | None, domain: Domain | None,
    ) -> bool:
        first = self.resolve(left, kind=kind, species=species, domain=domain)
        second = self.resolve(right, kind=kind, species=species, domain=domain)
        return (
            first.usable_for_clinical_equivalence
            and second.usable_for_clinical_equivalence
            and first.canonical_id == second.canonical_id
        )
