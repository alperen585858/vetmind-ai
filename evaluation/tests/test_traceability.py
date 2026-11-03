"""Reproducibility receipt checks. No clinical images or reference data."""
import pytest
from pydantic import ValidationError

from evaluation.configuration import EvaluationConfiguration
from evaluation.contracts import EvaluationManifest, EvaluationRecord
from evaluation.traceability import TraceReceipt, compare_receipts, create_receipt


def _manifest(**overrides):
    data = dict(evaluation_id="private-owner@example.com", model_id="model-A",
                model_version="x", task="detection")
    data.update(overrides)
    return EvaluationManifest(**data)


def _record(**overrides):
    data = dict(case_id="PRIVATE-CASE-1234", species="feline", modality="CT",
                anatomical_region="BRAIN", source_kind="real",
                execution_status="success")
    data.update(overrides)
    return EvaluationRecord(**data)


def test_empty_receipt_is_non_clinical():
    receipt = create_receipt(EvaluationConfiguration(), _manifest())
    assert receipt.record_count == 0
    assert receipt.clinical_validation_status == "not_evaluated"
    assert receipt.verified_checksum()
    assert not receipt.dataset_identifier_present


def test_receipt_excludes_identifying_strings():
    manifest = _manifest(dataset_id="PRIVATE-DATASET-ID", dataset_version="1.0")
    receipt = create_receipt(EvaluationConfiguration(), manifest, [_record()])
    output = receipt.model_dump_json()
    for identifier in ("PRIVATE-CASE-1234", "private-owner@example.com", "PRIVATE-DATASET-ID", "model-A"):
        assert identifier not in output
    assert receipt.record_count == 1
    assert receipt.record_sources == ("real",)


def test_source_categories_are_unique_and_sorted():
    records = [_record(case_id="caseA", source_kind="mock"),
               _record(case_id="caseB", source_kind="manual"),
               _record(case_id="caseC", source_kind="mock")]
    receipt = create_receipt(EvaluationConfiguration(), _manifest(), records)
    assert receipt.record_sources == ("manual", "mock")


def test_manifest_verification_status_is_only_declared():
    manifest = _manifest(dataset_id="asset", dataset_version="v1", reference_status="expert_verified")
    receipt = create_receipt(EvaluationConfiguration(), manifest)
    assert receipt.reference_declared == "expert_verified"
    assert receipt.clinical_validation_status == "not_evaluated"


def test_report_template_only_presence_not_claimed_conformance():
    manifest = _manifest(report_template_id="unknown", report_template_version="draft")
    receipt = create_receipt(EvaluationConfiguration(), manifest)
    assert receipt.report_template_identifier_present
    assert receipt.clinical_validation_status == "not_evaluated"


def test_receipt_round_trip():
    receipt = create_receipt(EvaluationConfiguration(), _manifest())
    restored = TraceReceipt.model_validate_json(receipt.model_dump_json())
    assert restored == receipt and restored.verified_checksum()


def test_receipt_tampering_is_detected():
    receipt = create_receipt(EvaluationConfiguration(), _manifest())
    payload = receipt.model_dump()
    payload["record_count"] = 100
    with pytest.raises(ValidationError):
        TraceReceipt.model_validate(payload)


def test_receipt_invalid_checksum_format():
    receipt = create_receipt(EvaluationConfiguration(), _manifest())
    payload = receipt.model_dump()
    payload["receipt_sha256"] = "not-a-hash"
    with pytest.raises(ValidationError):
        TraceReceipt.model_validate(payload)


def test_receipt_batch_limit():
    with pytest.raises(ValueError):
        create_receipt(EvaluationConfiguration(max_records=1), _manifest(),
                       [_record(case_id="a"), _record(case_id="b")])


def test_same_metadata_same_receipt():
    config = EvaluationConfiguration()
    assert create_receipt(config, _manifest()) == create_receipt(config, _manifest())


def test_compare_receipts_tracks_config_differences():
    left = create_receipt(EvaluationConfiguration(), _manifest())
    right = create_receipt(EvaluationConfiguration(require_cases=True), _manifest())
    comparison = compare_receipts(left, right)
    assert not comparison.same_configuration
    assert comparison.same_contracts
    assert comparison.same_manifest_policy
    assert not comparison.clinical_results_comparable


def test_compare_receipts_tracks_policy_differences():
    left = create_receipt(EvaluationConfiguration(), _manifest())
    right = create_receipt(EvaluationConfiguration(), _manifest(task="report"))
    assert not compare_receipts(left, right).same_manifest_policy


def test_compare_receipts_tracks_record_counts():
    left = create_receipt(EvaluationConfiguration(), _manifest())
    right = create_receipt(EvaluationConfiguration(), _manifest(), [_record()])
    comparison = compare_receipts(left, right)
    assert not comparison.same_record_count
    assert not comparison.same_source_kinds


def test_receipt_has_no_case_level_fields():
    names = TraceReceipt.model_fields.keys()
    assert "case_id" not in names
    assert "dicom_uid" not in names
    assert "report_text" not in names
    assert "file_path" not in names
