"""Evaluation protocol guards against metrics computed from missing negatives."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class CountResult:
    true_positive: int
    false_positive: int
    false_negative: int
    true_negative: int | None
    specificity_status: Literal['ready', 'not_evaluated']

    def __post_init__(self) -> None:
        for field_name in ('true_positive', 'false_positive', 'false_negative'):
            value = getattr(self, field_name)
            if type(value) is not int or value < 0:
                raise ValueError(f'{field_name} must be a nonnegative integer')
        if self.true_negative is not None and (type(self.true_negative) is not int or self.true_negative < 0):
            raise ValueError('true_negative must be a nonnegative integer')
        if (self.true_negative is None) != (self.specificity_status == 'not_evaluated'):
            raise ValueError('specificity status must reflect availability of true negatives')


def count_verified_matches(*, matched: int, unmatched_predictions: int,
                           unmatched_references: int,
                           verified_negative_opportunities: int | None = None) -> CountResult:
    """Compute counts only for a VERIFIED, exhaustive labeling scope.

    Cannot derive true negatives from the absence of detected findings.
    Callers must gate input using expert verification and protocol eligibility.
    """
    for name, value in [('matched', matched),
                        ('unmatched_predictions', unmatched_predictions),
                        ('unmatched_references', unmatched_references)]:
        if type(value) is not int or value < 0:
            raise ValueError(f'{name} must be a nonnegative integer')
    if verified_negative_opportunities is not None and (
        type(verified_negative_opportunities) is not int or verified_negative_opportunities < 0
    ):
        raise ValueError('verified_negative_opportunities must be a nonnegative integer')
    return CountResult(matched, unmatched_predictions, unmatched_references,
                       verified_negative_opportunities,
                       'ready' if verified_negative_opportunities is not None else 'not_evaluated')


@dataclass(frozen=True)
class MetricSummary:
    status: str
    sensitivity: float | None
    specificity: float | None
    precision: float | None
    f1: float | None
    reason: str | None = None


def summarize_counts(counts: CountResult, *, expert_verified: bool) -> MetricSummary:
    if not expert_verified:
        return MetricSummary('not_evaluated', None, None, None, None,
                             'An expert-verified exhaustive reference scope is required')
    tp, fp, fn, tn = counts.true_positive, counts.false_positive, counts.false_negative, counts.true_negative
    sensitivity = tp / (tp + fn) if tp + fn else None
    precision = tp / (tp + fp) if tp + fp else None
    specificity = tn / (tn + fp) if tn is not None and tn + fp else None
    f1 = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None
    return MetricSummary('ready', sensitivity, specificity, precision, f1,
                         None if tn is not None else 'Specificity unavailable without verified negatives')
