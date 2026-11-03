import math
import pytest
from evaluation.contracts import EvaluationManifest, EvaluationRecord
from evaluation.fingerprints import configuration_digest, policy_manifest_digest, schema_digest


def test_config_digest_is_order_independent():
    assert configuration_digest({"b": 2, "a": [1, "x"]}) == configuration_digest(
        {"a": [1, "x"], "b": 2})


def test_value_change_changes_digest():
    assert configuration_digest({"threshold": 0.5}) != configuration_digest({"threshold": 0.6})


def test_digest_is_hex_sha256():
    digest = configuration_digest({"name": "default"})
    assert len(digest) == 64
    assert int(digest, 16) >= 0


@pytest.mark.parametrize("invalid", [{"bad": math.nan}, {"bad": math.inf},
                                     {1: "bad"}, {"bad": set([1])}])
def test_unsafe_config_rejected(invalid):
    with pytest.raises((TypeError, ValueError)):
        configuration_digest(invalid)


def test_schema_fingerprint_is_stable():
    assert schema_digest(EvaluationRecord) == schema_digest(EvaluationRecord)
    assert schema_digest(EvaluationManifest) != schema_digest(EvaluationRecord)


def test_non_pydantic_contract_rejected():
    with pytest.raises(TypeError):
        schema_digest(object)


def test_policy_digest_omits_dataset_identifiers():
    m1 = EvaluationManifest(evaluation_id="first", model_id="a", model_version="1",
                            task="report", dataset_id="foo", dataset_version="1")
    m2 = EvaluationManifest(evaluation_id="second", model_id="b", model_version="2",
                            task="report", dataset_id="bar", dataset_version="1")
    assert policy_manifest_digest(m1) == policy_manifest_digest(m2)


def test_policy_digest_changes_on_review_state():
    a = EvaluationManifest(evaluation_id="a", model_id="x", model_version="1", task="report")
    b = EvaluationManifest(evaluation_id="a", model_id="x", model_version="1", task="detection")
    assert policy_manifest_digest(a) != policy_manifest_digest(b)
