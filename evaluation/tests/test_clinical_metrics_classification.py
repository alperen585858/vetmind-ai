"""Arithmetic fixtures only; no mock clinical cases or clinical datasets."""
from __future__ import annotations
import pytest
from pydantic import ValidationError

from evaluation.clinical_metrics.classification import (
    METRIC_NAMES, assess_binary_observations, assess_count_summary,
)
from evaluation.clinical_metrics.contracts import (
    BinaryObservation, CountInput, EvaluationScope, ReviewProvenance,
)


def scope(**overrides):
    props = dict(reference_status="expert_verified", dataset_id="dataset", dataset_version="v1",
                 review_record_id="review1", source_kind="real", exhaustive_reference=True,
                 predictions_complete=True, adjudication_complete=True)
    props.update(overrides)
    return EvaluationScope(
        evaluation_id="run1", model_id="vision", model_version="v1",
        target_code="target1", unit_of_analysis="case",
        provenance=ReviewProvenance(**props),
    )


def counts(tp=1, fp=1, fn=1, tn=1):
    return CountInput(true_positive=tp, false_positive=fp,
                      false_negative=fn, true_negative=tn, count_attestation_ref="attest1")


def observation(i, reference=True, prediction=True, reviewed=True, available=True):
    return BinaryObservation(unit_id=f"unit{i}", reference_positive=reference,
                             predicted_positive=prediction, expert_reviewed=reviewed,
                             prediction_available=available)


@pytest.mark.parametrize("field", ["reference_status", "source_kind", "exhaustive_reference",
                                   "predictions_complete", "adjudication_complete"])
def test_gating_requires_all_evidence(field):
    changes = {
        "reference_status": "pending_expert_review", "source_kind": "mock",
        "exhaustive_reference": False, "predictions_complete": False,
        "adjudication_complete": False,
    }
    result = assess_binary_observations(scope(**{field: changes[field]}), [observation(1)])
    assert result.assessment_status == "not_evaluated"
    assert result.counts is None
    assert all(rate.value is None for rate in result.rates.values())
    assert result.clinical_validation == "not_evaluated"


def test_default_evidence_fails_closed():
    minimal = EvaluationScope(evaluation_id="eval", model_id="model", model_version="v1",
                              target_code="target", unit_of_analysis="case")
    result = assess_count_summary(minimal, counts())
    assert result.assessment_status == "not_evaluated"
    assert result.counts is None


@pytest.mark.parametrize("truth,prediction,expected", [
    (True, True, (1, 0, 0, 0)),
    (False, True, (0, 1, 0, 0)),
    (True, False, (0, 0, 1, 0)),
    (False, False, (0, 0, 0, 1)),
])
def test_binary_outcome_accounting(truth, prediction, expected):
    result = assess_binary_observations(scope(), [observation(1,truth,prediction)])
    assert result.counts is not None
    assert (result.counts.tp, result.counts.fp, result.counts.fn, result.counts.tn) == expected
    assert result.observations_evaluated == 1


def test_binary_observations_match_aggregate_counts():
    observed = [observation(1,True,True), observation(2,True,False),
                observation(3,False,True), observation(4,False,False)]
    direct = assess_binary_observations(scope(), observed)
    summary = assess_count_summary(scope(), counts(1,1,1,1))
    assert direct.counts == summary.counts
    assert direct.rates == summary.rates
    assert direct.observations_evaluated == 4


@pytest.mark.parametrize("reference,prediction,reviewed,available,blocker", [
    (None,True,True,True,"reference_labels_incomplete"),
    (True,None,True,True,"model_predictions_incomplete"),
    (True,None,True,False,"model_predictions_incomplete"),
    (True,True,False,True,"reference_labels_incomplete"),
])
def test_missing_observation_blocks_entire_run(reference,prediction,reviewed,available,blocker):
    observations = [observation(1), observation(2,reference,prediction,reviewed,available)]
    result = assess_binary_observations(scope(), observations)
    assert result.assessment_status == "not_evaluated"
    assert blocker in result.blockers
    assert result.counts is None


def test_duplicate_units_block_scores():
    result = assess_binary_observations(scope(), [observation(1), observation(1)])
    assert result.assessment_status == "not_evaluated"
    assert "duplicate_evaluation_opportunity" in result.blockers


def test_empty_universe_block_scores():
    result = assess_binary_observations(scope(), [])
    assert result.assessment_status == "not_evaluated"
    assert "no_evaluation_opportunities" in result.blockers


def test_empty_aggregate_blocks_scores():
    result = assess_count_summary(scope(), counts(0,0,0,0))
    assert result.assessment_status == "not_evaluated"


def test_partial_negative_universe_keeps_specificity_undefined():
    result = assess_count_summary(scope(), counts(4,1,1,None))
    assert result.assessment_status == "ready"
    assert result.counts.tn is None
    for key in ("specificity", "negative_predictive_value", "balanced_accuracy",
                "matthews_correlation_coefficient"):
        assert result.rates[key].status == "undefined"
        assert result.rates[key].value is None
    assert result.rates["sensitivity"].status == "ready"


def test_single_class_positive_results_have_no_negative_metrics():
    result = assess_count_summary(scope(), counts(5,0,0,0))
    assert result.rates["sensitivity"].value == 1
    assert result.rates["specificity"].status == "undefined"
    assert result.rates["negative_predictive_value"].status == "undefined"
    assert result.rates["matthews_correlation_coefficient"].status == "undefined"


def test_single_class_negative_results_have_no_positive_metrics():
    result = assess_count_summary(scope(), counts(0,0,0,5))
    assert result.rates["specificity"].value == 1
    assert result.rates["sensitivity"].status == "undefined"
    assert result.rates["precision"].status == "undefined"
    assert result.rates["f1"].status == "undefined"


def test_all_false_predictions_yield_zero_precision_if_predicted_positive_exists():
    result = assess_count_summary(scope(), counts(0,3,1,5))
    assert result.rates["precision"].value == 0
    assert result.rates["sensitivity"].value == 0
    assert result.rates["f1"].value == 0


def test_mcc_negative_when_systematically_wrong():
    result = assess_count_summary(scope(), counts(0,4,4,0))
    assert result.rates["matthews_correlation_coefficient"].value == -1


def test_complete_confusion_metrics_and_confidence_intervals():
    result = assess_count_summary(scope(), counts(8,2,2,8))
    assert result.assessment_status == "ready"
    assert result.rates["sensitivity"].value == pytest.approx(0.8)
    assert result.rates["specificity"].value == pytest.approx(0.8)
    assert result.rates["precision"].value == pytest.approx(0.8)
    assert result.rates["f1"].value == pytest.approx(0.8)
    assert result.rates["f2"].value == pytest.approx(0.8)
    assert result.rates["balanced_accuracy"].value == pytest.approx(0.8)
    sens = result.rates["sensitivity"]
    prec = result.rates["precision"]
    assert 0 <= sens.confidence_lower < sens.value < sens.confidence_upper <= 1
    assert 0 <= prec.confidence_lower < prec.value < prec.confidence_upper <= 1


@pytest.mark.parametrize("name", METRIC_NAMES)
def test_expected_metric_names_present(name):
    result = assess_count_summary(scope(), counts())
    assert result.rates[name].name == name


@pytest.mark.parametrize("field,bad_value", [
    ("true_positive",-1), ("false_positive",-2), ("false_negative",-3),
    ("true_negative",-1), ("true_positive",True), ("false_positive",1.5),
    ("true_positive","2"), ("false_negative",10000001),
])
def test_counts_reject_invalid_values(field,bad_value):
    args=dict(true_positive=1,false_positive=1,false_negative=1,true_negative=1,
              count_attestation_ref="audit")
    args[field]=bad_value
    with pytest.raises(ValidationError):
        CountInput(**args)


@pytest.mark.parametrize("field,bad_value", [
    ("reference_positive","true"), ("predicted_positive",1),
    ("expert_reviewed","yes"), ("prediction_available",0),
])
def test_observation_rejects_ambiguous_flags(field,bad_value):
    values=dict(unit_id="opaque1",reference_positive=True,predicted_positive=True,expert_reviewed=True)
    values[field]=bad_value
    with pytest.raises(ValidationError):
        BinaryObservation(**values)


def test_review_reference_required():
    with pytest.raises(ValidationError):
        ReviewProvenance(reference_status="expert_verified", source_kind="real")


def test_schema_version_rejected_if_unrecognized():
    with pytest.raises(ValidationError):
        EvaluationScope(evaluation_id="e", model_id="m", model_version="1",target_code="t",
                        unit_of_analysis="case",schema_version="2.0.0")


def test_privacy_unit_ids_not_exported():
    report = assess_binary_observations(scope(), [observation(1)])
    dump = report.model_dump_json()
    assert "unit1" not in dump
    assert "review1" not in dump


def test_input_type_validation():
    with pytest.raises(TypeError):
        assess_binary_observations(scope(), [object()])
    with pytest.raises(TypeError):
        assess_count_summary(scope(), object())


def test_input_models_reject_unknown_fields():
    with pytest.raises(ValidationError):
        BinaryObservation(unit_id="id",reference_positive=True,predicted_positive=True,
                          expert_reviewed=True,patient_name="NotAllowed")
