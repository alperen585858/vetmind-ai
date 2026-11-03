from __future__ import annotations
import pytest
from evaluation.contracts import EvaluationManifest
from evaluation.clinical_metrics.contracts import EvaluationScope, ReviewProvenance
from evaluation.clinical_metrics.manifest_gate import check_manifest_alignment


def fixtures(task="classification", **changes):
    p=ReviewProvenance(reference_status="expert_verified",dataset_id="dataset",
                       dataset_version="v1",review_record_id="review",source_kind="real",
                       exhaustive_reference=True,predictions_complete=True,adjudication_complete=True)
    scope=EvaluationScope(evaluation_id="run",model_id="model",model_version="v1",
                          target_code="target",unit_of_analysis="case",provenance=p)
    m=dict(evaluation_id="run",model_id="model",model_version="v1",task=task,
           reference_status="expert_verified",dataset_id="dataset",dataset_version="v1")
    m.update(changes)
    return EvaluationManifest(**m),scope


def test_matching_manifest_is_aligned_not_clinically_validated():
    m,s=fixtures()
    r=check_manifest_alignment(m,s)
    assert r.status=="aligned"
    assert r.issues==()
    assert r.clinical_validation=="not_evaluated"


@pytest.mark.parametrize("field,value,reason",[
    ("evaluation_id","else","evaluation_id_mismatch"),
    ("model_id","else","model_id_mismatch"),
    ("model_version","else","model_version_mismatch"),
    ("dataset_id","other","dataset_identity_mismatch"),
    ("dataset_version","v2","dataset_identity_mismatch"),
    ("reference_status","pending_expert_review","reference_review_status_mismatch"),
])
def test_metadata_mismatch_blocks(field,value,reason):
    m,s=fixtures(**{field:value})
    r=check_manifest_alignment(m,s)
    assert r.status=="blocked"
    assert reason in r.issues


def test_report_manifest_not_suitable_for_classification_metrics():
    m,s=fixtures(task="report")
    assert "unsupported_metric_task" in check_manifest_alignment(m,s).issues


def test_wrong_type_does_not_accept_arbitrary_data():
    m,s=fixtures()
    with pytest.raises(TypeError):
        check_manifest_alignment(object(),s)
