"""Evidence-gated binary evaluation using VetMind's existing metric implementation.

The evaluation unit is specified by the caller. Never infer a negative from a
missing detection, or turn a missing denominator into zero performance.
"""
from __future__ import annotations

from collections.abc import Sequence

from .contracts import BinaryObservation, CountInput, EvaluationScope
from .results import ClassificationReport, Counts, Rate


METRIC_NAMES = (
    "sensitivity", "specificity", "precision", "negative_predictive_value",
    "f1", "f2", "matthews_correlation_coefficient", "balanced_accuracy",
)


def _unavailable(scope: EvaluationScope, blockers: Sequence[str]) -> ClassificationReport:
    rates = {
        name: Rate(name=name, status="not_evaluated", reason="required_evidence_unavailable")
        for name in METRIC_NAMES
    }
    return ClassificationReport(
        assessment_status="not_evaluated", blockers=tuple(dict.fromkeys(blockers)),
        evaluation_id=scope.evaluation_id, model_id=scope.model_id,
        model_version=scope.model_version,
        dataset_id=scope.provenance.dataset_id,
        dataset_version=scope.provenance.dataset_version,
        target_code=scope.target_code, unit_of_analysis=scope.unit_of_analysis,
        observations_evaluated=0, counts=None, rates=rates,
    )


def _defined(name: str, *, numerator: int | None, denominator: int | None,
             value: float | None, confidence: tuple[float, float] | None = None,
             undefined_reason: str | None = None) -> Rate:
    if value is None:
        reason = undefined_reason or ("missing_verified_negatives" if denominator is None else "zero_denominator")
        return Rate(name=name, status="undefined", reason=reason,
                    numerator=numerator, denominator=denominator)
    return Rate(
        name=name, status="ready", value=value, numerator=numerator,
        denominator=denominator,
        confidence_lower=confidence[0] if confidence is not None else None,
        confidence_upper=confidence[1] if confidence is not None else None,
    )


def _summarize(scope: EvaluationScope, counts: Counts, number_of_units: int) -> ClassificationReport:
    # Existing backend library owns the mathematical definitions and Wilson CI.
    # Its zero-denominator convention is 0.0; this wrapper deliberately masks
    # undefined rates instead of exposing that value as clinical performance.
    from backend.app.evaluation.metrics import ClinicalClassificationMetrics, ConfusionMatrixStats

    tp, fp, fn, tn = counts.tp, counts.fp, counts.fn, counts.tn
    backend_stats = ConfusionMatrixStats(
        true_positive=tp, false_positive=fp, false_negative=fn,
        true_negative=tn if tn is not None else 0,
    )
    calculator = ClinicalClassificationMetrics()
    output = calculator.evaluate_class_metrics(backend_stats)

    positive_support = tp + fn
    negative_support = (tn + fp) if tn is not None else None
    predicted_positive = tp + fp
    predicted_negative = (tn + fn) if tn is not None else None
    f_denom = 2 * tp + fp + fn
    f2_denom = 5 * tp + 4 * fn + fp
    mcc_available = (
        tn is not None and
        (tp + fp) > 0 and (tp + fn) > 0 and (tn + fp) > 0 and (tn + fn) > 0
    )

    sens = output.sensitivity if positive_support else None
    spec = output.specificity if negative_support else None
    prec = output.ppv if predicted_positive else None
    npv = output.npv if predicted_negative else None
    f1 = output.f1_score if f_denom else None
    f2 = output.f2_score if f2_denom else None
    mcc = output.mcc if mcc_available else None
    balanced = (sens + spec) / 2 if sens is not None and spec is not None else None

    rates: dict[str, Rate] = {
        "sensitivity": _defined(
            "sensitivity", numerator=tp, denominator=positive_support, value=sens,
            confidence=(output.sensitivity_ci_lower, output.sensitivity_ci_upper)
            if sens is not None else None,
        ),
        "specificity": _defined(
            "specificity", numerator=tn, denominator=negative_support, value=spec,
        ),
        "precision": _defined(
            "precision", numerator=tp, denominator=predicted_positive, value=prec,
            confidence=(output.precision_ci_lower, output.precision_ci_upper)
            if prec is not None else None,
        ),
        "negative_predictive_value": _defined(
            "negative_predictive_value", numerator=tn, denominator=predicted_negative, value=npv,
        ),
        "f1": _defined("f1", numerator=2 * tp, denominator=f_denom, value=f1),
        "f2": _defined("f2", numerator=5 * tp, denominator=f2_denom, value=f2),
        "matthews_correlation_coefficient": _defined(
            "matthews_correlation_coefficient", numerator=None, denominator=None, value=mcc,
            undefined_reason="missing_verified_negatives" if tn is None else "zero_denominator",
        ),
        "balanced_accuracy": _defined(
            "balanced_accuracy", numerator=None, denominator=None, value=balanced,
            undefined_reason="missing_verified_negatives" if tn is None else "zero_denominator",
        ),
    }
    return ClassificationReport(
        assessment_status="ready", evaluation_id=scope.evaluation_id,
        model_id=scope.model_id, model_version=scope.model_version,
        dataset_id=scope.provenance.dataset_id,
        dataset_version=scope.provenance.dataset_version,
        target_code=scope.target_code, unit_of_analysis=scope.unit_of_analysis,
        observations_evaluated=number_of_units, counts=counts, rates=rates,
    )


def assess_binary_observations(
    scope: EvaluationScope, observations: Sequence[BinaryObservation],
) -> ClassificationReport:
    """Evaluate fully enumerated positive/negative opportunities.

    A complete opportunity list is mandatory. Unreviewed labels, unavailable
    predictions, and duplicate opportunities block the *whole* evaluation.
    Do not silently drop records or reinterpret missing predictions as negative.
    """
    if not isinstance(scope, EvaluationScope):
        raise TypeError("EvaluationScope required")
    if any(not isinstance(x, BinaryObservation) for x in observations):
        raise TypeError("BinaryObservation items required")
    blockers = list(scope.blockers)
    if not observations:
        blockers.append("no_evaluation_opportunities")
    identifiers = [x.unit_id for x in observations]
    if len(identifiers) != len(set(identifiers)):
        blockers.append("duplicate_evaluation_opportunity")
    if any(not x.expert_reviewed or x.reference_positive is None for x in observations):
        blockers.append("reference_labels_incomplete")
    if any(not x.prediction_available or x.predicted_positive is None for x in observations):
        blockers.append("model_predictions_incomplete")
    if blockers:
        return _unavailable(scope, blockers)

    tp = sum(x.reference_positive is True and x.predicted_positive is True for x in observations)
    fp = sum(x.reference_positive is False and x.predicted_positive is True for x in observations)
    fn = sum(x.reference_positive is True and x.predicted_positive is False for x in observations)
    tn = sum(x.reference_positive is False and x.predicted_positive is False for x in observations)
    return _summarize(scope, Counts(tp=tp, fp=fp, fn=fn, tn=tn), len(observations))


def assess_count_summary(scope: EvaluationScope, counts: CountInput) -> ClassificationReport:
    """Accept externally audited integer counts, not inferred from detections.

    The attestation reference is metadata only. The model cannot establish the
    existence or accuracy of a clinical review; this requires human oversight.
    """
    if not isinstance(scope, EvaluationScope) or not isinstance(counts, CountInput):
        raise TypeError("EvaluationScope and CountInput required")
    blockers = list(scope.blockers)
    n = counts.true_positive + counts.false_positive + counts.false_negative
    if counts.true_negative is not None:
        n += counts.true_negative
    if n == 0:
        blockers.append("no_evaluation_opportunities")
    if blockers:
        return _unavailable(scope, blockers)
    return _summarize(scope, Counts(
        tp=counts.true_positive, fp=counts.false_positive,
        fn=counts.false_negative, tn=counts.true_negative,
    ), n)
