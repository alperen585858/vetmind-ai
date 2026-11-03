"""Deterministic matching of expert-verified reference findings to predictions.

A mismatch is not automatically a false positive: count assignments depend on
explicit evaluation eligibility and an expert-defined negative universe.
"""
from __future__ import annotations
from dataclasses import dataclass
from collections.abc import Sequence
from evaluation.contracts import EvaluationFinding
from evaluation.terminology import Terminology, EMPTY_VOCABULARY, normalize_token


@dataclass(frozen=True)
class FindingPair:
    reference_id: str
    prediction_id: str
    code_match: bool
    location_match: bool
    laterality_match: bool


@dataclass(frozen=True)
class MatchingResult:
    matches: tuple[FindingPair, ...]
    unmatched_references: tuple[str, ...]
    unmatched_predictions: tuple[str, ...]
    excluded_predictions: tuple[str, ...]


def _code_match(left: str, right: str, vocabulary: Terminology) -> bool:
    l, r = vocabulary.resolve(left), vocabulary.resolve(right)
    if l.canonical is not None or r.canonical is not None:
        return l.canonical is not None and l.canonical == r.canonical
    return normalize_token(left) == normalize_token(right)


def _location_match(left: str, right: str, vocabulary: Terminology) -> bool:
    return _code_match(left, right, vocabulary)


def _side_match(reference: str, prediction: str) -> bool:
    # Unknown does not function as a wildcard and must not silently match known sides.
    return reference == prediction


def match_findings(
    references: Sequence[EvaluationFinding],
    predictions: Sequence[EvaluationFinding],
    *,
    code_vocabulary: Terminology = EMPTY_VOCABULARY,
    anatomy_vocabulary: Terminology = EMPTY_VOCABULARY,
    minimum_confidence: float | None = None,
) -> MatchingResult:
    """Match one-to-one deterministically; reject ambiguous duplicate IDs.

    A reference and prediction must agree on code, anatomy and laterality.
    Predictions below a configured threshold are excluded, not assigned TN.
    """
    if minimum_confidence is not None and not 0 <= minimum_confidence <= 1:
        raise ValueError('minimum_confidence must be within [0,1]')
    for name, seq in [('reference', references), ('prediction', predictions)]:
        identifiers = [item.finding_id for item in seq]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError(f'duplicate {name} finding_id')
    eligible, excluded = [], []
    for finding in predictions:
        if (minimum_confidence is not None and finding.confidence is not None
                and finding.confidence < minimum_confidence):
            excluded.append(finding.finding_id)
        else:
            eligible.append(finding)
    matched_pred: set[str] = set()
    matched_ref: set[str] = set()
    pairs: list[FindingPair] = []
    for reference in sorted(references, key=lambda x: x.finding_id):
        for prediction in sorted(eligible, key=lambda x: x.finding_id):
            if prediction.finding_id in matched_pred:
                continue
            same_code = _code_match(reference.finding_code, prediction.finding_code, code_vocabulary)
            same_location = _location_match(reference.anatomical_location, prediction.anatomical_location, anatomy_vocabulary)
            same_side = _side_match(reference.laterality, prediction.laterality)
            if same_code and same_location and same_side:
                pairs.append(FindingPair(reference.finding_id, prediction.finding_id,
                                         same_code, same_location, same_side))
                matched_ref.add(reference.finding_id)
                matched_pred.add(prediction.finding_id)
                break
    return MatchingResult(
        tuple(pairs),
        tuple(sorted(x.finding_id for x in references if x.finding_id not in matched_ref)),
        tuple(sorted(x.finding_id for x in eligible if x.finding_id not in matched_pred)),
        tuple(sorted(excluded)),
    )
