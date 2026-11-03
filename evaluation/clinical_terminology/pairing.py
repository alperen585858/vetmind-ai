"""Reference/prediction structural pairing; never assigns clinical TP/FP/TN/FN.

Use only with a human-reviewed terminology catalog. A matching term string
alone does not validate a diagnosis or a medical imaging model.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

from evaluation.clinical_terminology.catalog import Domain, Species
from evaluation.clinical_terminology.laterality import Side, sides_compatible
from evaluation.clinical_terminology.resolver import CatalogResolver
from evaluation.contracts import EvaluationFinding

AssessmentStatus = Literal["not_evaluated", "needs_review", "structurally_matched"]


@dataclass(frozen=True, slots=True)
class FindingLink:
    reference_id: str
    prediction_id: str
    finding_concept_id: str
    anatomy_concept_id: str


@dataclass(frozen=True, slots=True)
class PairingResult:
    status: AssessmentStatus
    matches: tuple[FindingLink, ...]
    unmatched_reference_ids: tuple[str, ...]
    unmatched_prediction_ids: tuple[str, ...]
    unresolved_reference_ids: tuple[str, ...]
    unresolved_prediction_ids: tuple[str, ...]
    clinical_metrics: None = None


def _validated_identifiers(findings: Sequence[EvaluationFinding], name: str) -> None:
    ids = [item.finding_id for item in findings]
    if len(ids) != len(set(ids)):
        raise ValueError(f"duplicate {name} finding_id")
    if any(not isinstance(item, EvaluationFinding) for item in findings):
        raise TypeError(f"{name} must contain EvaluationFinding models")


def _signature(
    finding: EvaluationFinding, resolver: CatalogResolver,
    species: Species, domain: Domain,
) -> tuple[str, str, Side] | None:
    finding_type = resolver.resolve(
        finding.finding_code, kind="finding", species=species, domain=domain
    )
    anatomy = resolver.resolve(
        finding.anatomical_location, kind="anatomy", species=species, domain=domain
    )
    if not finding_type.usable_for_clinical_equivalence or not anatomy.usable_for_clinical_equivalence:
        return None
    side: Side = finding.laterality
    if side == "UNKNOWN":
        return None
    assert finding_type.canonical_id is not None and anatomy.canonical_id is not None
    return finding_type.canonical_id, anatomy.canonical_id, side


def pair_findings(
    references: Sequence[EvaluationFinding],
    predictions: Sequence[EvaluationFinding],
    resolver: CatalogResolver,
    *, species: Species, domain: Domain,
) -> PairingResult:
    """Pair stable concept/structure/side triples one-to-one, without scoring.

    The procedure is deliberately strict. Unresolved concepts stay unresolved,
    and unmatched identifiers do NOT constitute false positives or negatives.
    """
    _validated_identifiers(references, "reference")
    _validated_identifiers(predictions, "prediction")
    reference_signatures = {
        f.finding_id: _signature(f, resolver, species, domain) for f in references
    }
    prediction_signatures = {
        f.finding_id: _signature(f, resolver, species, domain) for f in predictions
    }
    used_predictions: set[str] = set()
    matched_references: set[str] = set()
    linked: list[FindingLink] = []
    for ref_id in sorted(reference_signatures):
        signature = reference_signatures[ref_id]
        if signature is None:
            continue
        code, anatomy, side = signature
        for pred_id in sorted(prediction_signatures):
            if pred_id in used_predictions:
                continue
            candidate = prediction_signatures[pred_id]
            if candidate is None:
                continue
            p_code, p_anatomy, p_side = candidate
            if code == p_code and anatomy == p_anatomy and sides_compatible(side, p_side):
                linked.append(FindingLink(ref_id, pred_id, code, anatomy))
                matched_references.add(ref_id)
                used_predictions.add(pred_id)
                break
    unresolved_ref = tuple(sorted(k for k, s in reference_signatures.items() if s is None))
    unresolved_pred = tuple(sorted(k for k, s in prediction_signatures.items() if s is None))
    if not reference_signatures and not prediction_signatures:
        status: AssessmentStatus = "not_evaluated"
    elif len(linked) == len(reference_signatures) == len(prediction_signatures):
        status = "structurally_matched"
    else:
        status = "needs_review"
    return PairingResult(
        status=status, matches=tuple(linked),
        unmatched_reference_ids=tuple(sorted(set(reference_signatures) - matched_references)),
        unmatched_prediction_ids=tuple(sorted(set(prediction_signatures) - used_predictions)),
        unresolved_reference_ids=unresolved_ref, unresolved_prediction_ids=unresolved_pred,
    )
