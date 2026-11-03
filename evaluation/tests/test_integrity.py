"""Only schema-level test objects; these are NOT clinical cases or benchmarks."""

import pytest

from evaluation.contracts import EvaluationManifest, EvaluationRecord
from evaluation.integrity import (
    IntegrityPolicy, IssueSeverity, validate_inputs, validate_records_stream,
)


def manifest(**overrides):
    return EvaluationManifest(evaluation_id="unit-test", model_id="unassigned",
                              model_version="unassigned", task="detection", **overrides)


def record(case_id="unit-1", **overrides):
    defaults = dict(case_id=case_id, species="feline", modality="CT",
                    anatomical_region="BRAIN", source_kind="real",
                    execution_status="success", expert_verified=False)
    defaults.update(overrides)
    return EvaluationRecord(**defaults)


def codes(report):
    return {issue.code for issue in report.issues}


def test_empty_batch_is_not_clinically_evaluated():
    report = validate_inputs(manifest(), [])
    assert report.valid and report.status == "valid"
    assert report.record_count == 0
    assert report.clinical_metrics is None
    assert "batch.empty" in codes(report)


def test_strict_empty_batch_rejected():
    result = validate_inputs(manifest(), [],
                             policy=IntegrityPolicy(require_cases_for_batch=True))
    assert not result.valid


def test_clean_structural_record():
    report = validate_inputs(manifest(), [record()])
    assert report.status == "valid"
    assert report.issues == []


def test_duplicate_case_ids_rejected():
    result = validate_inputs(manifest(), [record("same"), record("same")])
    assert not result.valid
    assert "record.duplicate_case_id" in codes(result)


def test_expert_reference_mismatch_is_error():
    r = record(expert_verified=True)
    result = validate_inputs(manifest(), [r])
    assert not result.valid
    assert "reference.manifest_mismatch" in codes(result)


def test_manifest_reference_requires_record_verified():
    m = manifest(dataset_id="dataset", dataset_version="1", reference_status="expert_verified")
    result = validate_inputs(m, [record()])
    assert result.status == "valid_with_warnings"
    assert "reference.record_unverified" in codes(result)


def test_real_and_mock_are_not_equivalent():
    result = validate_inputs(manifest(), [record(source_kind="mock")])
    assert result.status == "valid"
    assert "source.mock" in codes(result)
    assert result.clinical_metrics is None


def test_failed_execution_must_not_contain_scored_findings():
    finding = dict(finding_id="f-1", finding_code="unspecified",
                   anatomical_location="unknown")
    result = validate_inputs(manifest(), [record(execution_status="failed", findings=[finding])])
    assert result.status == "invalid"
    assert "record.failed_has_findings" in codes(result)


def test_incomplete_execution_strict_policy():
    result = validate_inputs(manifest(), [record(execution_status="partial")],
                             policy=IntegrityPolicy(require_complete_execution=True))
    assert "execution.incomplete" in codes(result)
    assert not result.valid


def test_priority_scope_not_inferred():
    result = validate_inputs(manifest(), [record(anatomical_region="THORAX")])
    assert result.status == "valid_with_warnings"
    result = validate_inputs(manifest(), [record(anatomical_region="THORAX")],
                             policy=IntegrityPolicy(require_kranium_neuro_scope=True))
    assert result.status == "invalid"


def test_manual_attribution_warning():
    m = EvaluationManifest(evaluation_id="unit", task="report", model_id="vision",
                           model_version="1")
    result = validate_inputs(m, [record(source_kind="manual")])
    assert "source.manual_model" in codes(result)


def test_missing_confidence_not_fabricated():
    finding = dict(finding_id="f", finding_code="code", anatomical_location="head")
    report = validate_inputs(manifest(), [record(findings=[finding])])
    assert report.status == "valid"
    issue = next(x for x in report.issues if x.code == "finding.confidence_unavailable")
    assert issue.severity == IssueSeverity.INFORMATION


def test_stream_limit():
    stream = (record(f"unit-{i}") for i in range(3))
    result = validate_records_stream(manifest(), stream, policy=IntegrityPolicy(max_records=2))
    assert not result.valid
    assert result.record_count == 2
    assert "batch.limit" in codes(result)


def test_regular_batch_limit():
    report = validate_inputs(manifest(), [record("a"), record("b")],
                             policy=IntegrityPolicy(max_records=1))
    assert not report.valid


@pytest.mark.parametrize("bad", [0, -1, 1.5, True])
def test_bad_batch_limit(bad):
    with pytest.raises(ValueError):
        IntegrityPolicy(max_records=bad)
