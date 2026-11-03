"""Evidence-preserving, nonclinical triage of VetMind terminology candidates.

This module never approves clinical terms and never changes production corpora.
It only assigns *workflow* statuses to string candidates from a static source.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Literal

from evaluation.clinical_terminology.catalog import TermCatalog, TermEntry
from evaluation.clinical_terminology.corpus_candidates import CorpusCandidate, CorpusReviewQueue
from evaluation.terminology import normalize_token

Triage = Literal[
    "requires_segmentation", "duplicate_in_queue", "overlaps_active_catalog",
    "pending_catalog_candidate", "requires_manual_review",
]


@dataclass(frozen=True, slots=True)
class ReviewPlanItem:
    candidate_id: str
    triage: Triage
    origin: str
    # Deliberately exclude labels, descriptions, patient metadata and model output.


@dataclass(frozen=True, slots=True)
class ReviewPlan:
    catalog_id: str
    catalog_version: str
    source_sha256: str
    total_candidates: int
    items: tuple[ReviewPlanItem, ...]
    counts: dict[str, int]
    clinical_validation: Literal["not_evaluated"] = "not_evaluated"
    clinical_metrics: None = None


def _active_surface_index(catalog: TermCatalog) -> dict[str, list[TermEntry]]:
    """Build a conservative index across both kinds and scopes.

    An apparent duplicate is flagged even when scopes differ. The review team
    resolves whether two terms are truly equivalent; software does not guess.
    """
    indexed: dict[str, list[TermEntry]] = {}
    for entry in catalog.terms:
        for surface in entry.surfaces():
            indexed.setdefault(normalize_token(surface), []).append(entry)
    return indexed


def _triage(
    item: CorpusCandidate, *, counts: Counter[str],
    active_surfaces: dict[str, list[TermEntry]],
) -> Triage:
    flags = set(item.flags)
    normalized = normalize_token(item.preferred_label_as_written)
    if "qualified_label" in flags or "composite_label" in flags:
        return "requires_segmentation"
    if "duplicate_surface" in flags or counts[normalized] > 1:
        return "duplicate_in_queue"
    if normalized in active_surfaces:
        return "overlaps_active_catalog"
    if item.origin == "suture_schedule" and item.species_mentioned:
        return "pending_catalog_candidate"
    return "requires_manual_review"


def build_review_plan(queue: CorpusReviewQueue, active_catalog: TermCatalog) -> ReviewPlan:
    """Prepare a stable, review-only plan without activating candidate terms."""
    if not isinstance(queue, CorpusReviewQueue) or not isinstance(active_catalog, TermCatalog):
        raise TypeError("expected validated review queue and term catalog")
    surfaces = Counter(normalize_token(c.preferred_label_as_written) for c in queue.candidates)
    active_index = _active_surface_index(active_catalog)
    items = tuple(
        ReviewPlanItem(
            candidate_id=item.candidate_id,
            triage=_triage(item, counts=surfaces, active_surfaces=active_index),
            origin=item.origin,
        )
        for item in sorted(queue.candidates, key=lambda c: c.candidate_id)
    )
    summary = Counter(item.triage for item in items)
    return ReviewPlan(
        catalog_id=active_catalog.catalog_id,
        catalog_version=active_catalog.catalog_version,
        source_sha256=queue.source_sha256,
        total_candidates=len(items),
        items=items,
        counts={key: summary.get(key, 0) for key in (
            "requires_segmentation", "duplicate_in_queue", "overlaps_active_catalog",
            "pending_catalog_candidate", "requires_manual_review",
        )},
    )
