"""Contract preflight tests; these do not benchmark veterinary cases."""
import json

import pytest

from evaluation.configuration import EvaluationConfiguration
from evaluation.contracts import EvaluationManifest, EvaluationRecord
from evaluation.preflight import PreflightReport, run_preflight


def manifest(**overrides):
    values = dict(evaluation_id="patient-private@example.com", task="detection",
                  model_id="unassigned", model_version="unassigned")
    values.update(overrides)
    return EvaluationManifest(**values)


def metadata_record(**overrides):
    values = dict(case_id="PRIVATE-CASE-ID", species="canine", modality="CT",
                  anatomical_region="BRAIN", source_kind="manual", execution_status="success")
    values.update(overrides)
    return EvaluationRecord(**values)


def test_default_preflight_is_not_clinical_scoring():
    result = run_preflight(manifest())
    assert result.structural_status == "checks_passed"
    assert result.integrity_status == "valid"
    assert result.clinical_status == "not_evaluated"
    assert result.clinical_metrics is None


def test_default_preflight_lists_unverified_clinical_dependencies():
    result = run_preflight(manifest())
    assert result.missing_clinical_inputs == (
        "expert_reference", "image_series", "official_report_template"
    )


def test_manifest_template_id_does_not_pretend_13_section_valid():
    m = manifest(report_template_id="pending", report_template_version="0")
    report = run_preflight(m)
    assert "official_report_template" in report.missing_clinical_inputs
    assert report.clinical_status == "not_evaluated"


def test_expert_verified_declared_does_not_count_as_confirmed():
    m = manifest(reference_status="expert_verified", dataset_id="unknown", dataset_version="v1")
    result = run_preflight(m)
    assert "expert_reference" in result.missing_clinical_inputs
    assert result.clinical_metrics is None


def test_force_required_cases_blocks_missing_records():
    result = run_preflight(manifest(), config=EvaluationConfiguration(require_cases=True))
    assert result.structural_status == "blocked"
    assert not result.structural_ok
    assert any(x.code == "batch.empty" and x.severity == "error" for x in result.issues)


def test_metadata_record_no_fake_clinical_scores():
    result = run_preflight(manifest(), [metadata_record()])
    assert result.clinical_metrics is None
    assert result.trace.record_count == 1
    assert result.trace.clinical_validation_status == "not_evaluated"


def test_manual_model_provenance_warning():
    report = run_preflight(manifest(model_id="vision-x"), [metadata_record()])
    assert report.structural_status == "warnings"
    assert any(x.code == "source.manual_model" for x in report.issues)


def test_warning_does_not_mean_blocked():
    report = run_preflight(manifest(), [metadata_record(anatomical_region="OTHER")])
    assert report.structural_status == "warnings"
    assert report.structural_ok


def test_priority_scope_policy_blocks_non_priority_region():
    report = run_preflight(manifest(), [metadata_record(anatomical_region="THORAX")],
        config=EvaluationConfiguration(require_kranium_neuro_scope=True))
    assert report.structural_status == "blocked"
    assert any(i.code == "scope.outside_priority" for i in report.issues)


def test_failed_execution_can_be_blocked():
    report = run_preflight(manifest(), [metadata_record(execution_status="failed")],
        config=EvaluationConfiguration(require_complete_execution=True))
    assert report.structural_status == "blocked"
    assert any(x.code == "execution.incomplete" for x in report.issues)


def test_aggregate_issue_count_does_not_export_case_ids():
    report = run_preflight(manifest(model_id="vision"), [
        metadata_record(case_id="patient1"), metadata_record(case_id="patient2")
    ])
    output = report.model_dump_json()
    for secret in ("patient-private@example.com", "patient1", "patient2", "PRIVATE-CASE-ID"):
        assert secret not in output
    assert any(x.code == "source.manual_model" and x.occurrences == 2 for x in report.issues)


def test_issues_are_sorted_stably():
    report = run_preflight(manifest(model_id="vision"), [
        metadata_record(case_id="a", anatomical_region="THORAX")
    ])
    assert [x.code for x in report.issues] == sorted(x.code for x in report.issues)


def test_receipt_and_audit_are_included():
    result = run_preflight(manifest())
    assert result.trace.verified_checksum()
    assert len(result.audit.entries) == 6
    assert result.audit.entries[-1].outcome.value == "passed"


def test_report_round_trip():
    report = run_preflight(manifest())
    restored = PreflightReport.model_validate_json(report.model_dump_json())
    assert restored == report


def test_backend_contracts_unchecked_by_default():
    assert run_preflight(manifest()).backend_contract_status == "unchecked"


def test_backend_contracts_checked_against_repo_if_available():
    from pathlib import Path
    import sys
    backend = Path(__file__).resolve().parents[2] / "backend"
    if not backend.is_dir():
        pytest.skip("Backend unavailable in isolated bundle")
    sys.path.insert(0, str(backend))
    report = run_preflight(manifest(), config=EvaluationConfiguration(check_backend_contracts=True))
    assert report.backend_contract_status == "compatible"
    assert report.structural_status == "checks_passed"


def test_duplicate_case_id_count_aggregates_correctly():
    result = run_preflight(manifest(), [metadata_record(), metadata_record()])
    assert result.structural_status == "blocked"
    issues = {x.code: x for x in result.issues}
    assert issues["record.duplicate_case_id"].occurrences == 2
