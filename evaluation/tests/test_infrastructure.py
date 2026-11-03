import pytest
from pydantic import ValidationError
from evaluation.contracts import EvaluationManifest, EvaluationRecord
from evaluation.metrics.geometry import Box2D, intersection_over_union
from evaluation.metrics.clinical import metric_readiness
from evaluation.reports.readiness import assess


def manifest(**overrides):
    return EvaluationManifest(evaluation_id="infra", task="detection", model_id="adapter", model_version="1", **overrides)

def test_manifest_without_data():
    result=assess(manifest())
    assert result.assessment_status == "not_evaluated"
    assert result.clinical_metrics is None
    assert all(c.status == "not_evaluated" for c in result.checks)

def test_no_fake_expert_dataset():
    with pytest.raises(ValidationError):
        manifest(reference_status="expert_verified")

def test_dataset_version_pair():
    with pytest.raises(ValidationError):
        manifest(dataset_id="set")

def test_no_unsupported_fields():
    with pytest.raises(ValidationError):
        manifest(unknown=1)

def test_no_duplicate_finding_ids():
    common=dict(case_id="c",species="feline",modality="CT",anatomical_region="BRAIN",source_kind="real",execution_status="success")
    with pytest.raises(ValidationError):
        EvaluationRecord(**common, findings=[dict(finding_id="x",finding_code="c",anatomical_location="skull")]*2)

def test_geometry():
    a=Box2D(0,0,4,4)
    assert intersection_over_union(a,a)==1
    assert intersection_over_union(a,Box2D(5,5,7,7))==0
    assert intersection_over_union(a,Box2D(2,2,6,6))==pytest.approx(4/28)

def test_invalid_geometry():
    with pytest.raises(ValueError):
        Box2D(4,0,1,1)
    with pytest.raises(ValueError):
        Box2D(float("nan"),0,1,1)

def test_no_labeled_data():
    assert metric_readiness(expert_verified=False,case_count=100).status=="not_evaluated"
    assert metric_readiness(expert_verified=True,case_count=0).status=="not_evaluated"
