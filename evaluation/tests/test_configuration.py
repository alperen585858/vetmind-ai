"""Evaluation Preflight software policy tests. These are not clinical cases."""
import pytest
from pydantic import ValidationError

from evaluation.configuration import (
    EvaluationConfiguration, compare_configurations, validate_configuration,
)


def test_defaults_require_no_clinical_inputs():
    config = EvaluationConfiguration()
    assert config.mode == "structure_only"
    assert not config.require_cases
    assert not config.check_backend_contracts
    assert not config.include_record_identifiers_in_reports


def test_default_policy_matches_existing_integrity_defaults():
    config = EvaluationConfiguration()
    policy = config.integrity_policy()
    assert policy.max_records == 100_000
    assert not policy.require_cases_for_batch
    assert not policy.require_kranium_neuro_scope


def test_policy_forwards_all_settings():
    config = EvaluationConfiguration(
        max_records=10, require_cases=True,
        require_complete_execution=True, require_kranium_neuro_scope=True,
    )
    policy = config.integrity_policy()
    assert policy.max_records == 10
    assert policy.require_cases_for_batch
    assert policy.require_complete_execution
    assert policy.require_kranium_neuro_scope


def test_identical_configurations_have_identical_digests():
    one = EvaluationConfiguration(require_cases=True)
    two = EvaluationConfiguration.model_validate(one.model_dump())
    assert one.fingerprint() == two.fingerprint()
    assert len(one.fingerprint()) == 64


def test_one_changed_setting_changes_fingerprint():
    assert EvaluationConfiguration().fingerprint() != EvaluationConfiguration(
        require_cases=True
    ).fingerprint()


def test_comparison_is_no_values_only_field_names():
    left = EvaluationConfiguration(max_records=10)
    right = EvaluationConfiguration(max_records=15)
    result = compare_configurations(left, right)
    assert not result.identical
    assert result.differing_fields == ("max_records",)
    assert result.first_fingerprint != result.second_fingerprint


def test_comparison_identical():
    result = compare_configurations(EvaluationConfiguration(), EvaluationConfiguration())
    assert result.identical and result.differing_fields == ()


@pytest.mark.parametrize("bad", [0, -1, 100_001, 1.1, True, "100"])
def test_invalid_max_records_rejected(bad):
    with pytest.raises(ValidationError):
        EvaluationConfiguration(max_records=bad)


@pytest.mark.parametrize("bad", [1, 0, "false", None, []])
def test_strict_booleans_rejected(bad):
    with pytest.raises(ValidationError):
        EvaluationConfiguration(require_cases=bad)


@pytest.mark.parametrize("field", ["require_complete_execution", "require_kranium_neuro_scope", "check_backend_contracts"])
def test_other_strict_booleans_rejected(field):
    with pytest.raises(ValidationError):
        EvaluationConfiguration(**{field: "yes"})


@pytest.mark.parametrize("extra", [{"clinical_metrics": True}, {"patient_id": "PRIVATE"}, {"endpoint": "foo"}])
def test_unknown_or_sensitive_options_rejected(extra):
    with pytest.raises(ValidationError):
        validate_configuration(extra)


def test_cannot_enable_identifier_exports():
    with pytest.raises(ValidationError):
        EvaluationConfiguration(include_record_identifiers_in_reports=True)


def test_cannot_request_clinical_scoring_mode():
    with pytest.raises(ValidationError):
        EvaluationConfiguration(mode="clinical_scoring")


def test_version_is_explicit():
    with pytest.raises(ValidationError):
        EvaluationConfiguration(schema_version="2.0.0")


def test_model_is_frozen():
    policy = EvaluationConfiguration()
    with pytest.raises(ValidationError):
        policy.max_records = 3


def test_payload_must_be_mapping():
    with pytest.raises(TypeError):
        validate_configuration(["not", "a", "mapping"])


def test_serialization_round_trip():
    original = EvaluationConfiguration(require_cases=True, max_records=12)
    restored = EvaluationConfiguration.model_validate_json(original.model_dump_json())
    assert original == restored
    assert original.fingerprint() == restored.fingerprint()
