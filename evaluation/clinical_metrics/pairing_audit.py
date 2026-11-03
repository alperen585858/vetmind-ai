"""Inspect terminology pairing results without promoting them to clinical scores.

A structural match indicates that two annotated concepts share a reviewed
vocabulary entry. It does not establish image truth or a complete negative
opportunity universe. This adapter is intentionally read-only.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal

from evaluation.clinical_terminology.pairing import PairingResult


@dataclass(frozen=True, slots=True)
class PairingReadiness:
    status: Literal["not_evaluated", "requires_reference_review"]
    matched_count: int
    unmatched_reference_count: int
    unmatched_prediction_count: int
    unresolved_reference_count: int
    unresolved_prediction_count: int
    clinical_metrics: None = None


def inspect_pairing(result: PairingResult) -> PairingReadiness:
    if not isinstance(result, PairingResult):
        raise TypeError("PairingResult required")
    ready_for_review = bool(result.matches or result.unmatched_reference_ids or result.unmatched_prediction_ids)
    return PairingReadiness(
        status="requires_reference_review" if ready_for_review else "not_evaluated",
        matched_count=len(result.matches),
        unmatched_reference_count=len(result.unmatched_reference_ids),
        unmatched_prediction_count=len(result.unmatched_prediction_ids),
        unresolved_reference_count=len(result.unresolved_reference_ids),
        unresolved_prediction_count=len(result.unresolved_prediction_ids),
    )
