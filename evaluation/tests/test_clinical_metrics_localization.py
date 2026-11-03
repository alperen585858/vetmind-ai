"""Only mathematical geometry fixtures, not clinical image samples."""
from __future__ import annotations
import pytest
from pydantic import ValidationError
from evaluation.clinical_metrics.contracts import (
    EvaluationScope, ReviewProvenance, LocalizationBox, LocalizationPair,
)
from evaluation.clinical_metrics.localization import assess_localization


def scope(**changes):
    props=dict(reference_status="expert_verified",dataset_id="dataset",dataset_version="v1",
               review_record_id="review",source_kind="real",exhaustive_reference=True,
               predictions_complete=True,adjudication_complete=True)
    props.update(changes)
    return EvaluationScope(evaluation_id="localize",model_id="vision",model_version="v1",
                           target_code="target",unit_of_analysis="region",
                           provenance=ReviewProvenance(**props))


def box(x1=0,y1=0,x2=10,y2=10,token="frame1",w=100,h=100):
    return LocalizationBox(x_min=x1,y_min=y1,x_max=x2,y_max=y2,
                           image_width=w,image_height=h,frame_token=token)


def pair(i=1,ref=None,pred=None,confirmed=True):
    return LocalizationPair(pair_id=f"pair{i}", reference=ref or box(),
                            prediction=pred or box(),expert_confirmed_pairing=confirmed)


def test_perfect_match():
    r=assess_localization(scope(),[pair()])
    assert r.assessment_status=="ready"
    assert r.mean_iou==1
    assert r.median_iou==1
    assert r.threshold_met==1
    assert r.clinical_validation=="not_evaluated"


def test_disjoint_boxes():
    r=assess_localization(scope(),[pair(pred=box(30,30,40,40))])
    assert r.mean_iou==0
    assert r.threshold_met==0


def test_partial_overlap():
    r=assess_localization(scope(),[pair(pred=box(5,0,15,10))])
    assert r.mean_iou==pytest.approx(50/150)
    assert r.threshold_met==0


def test_multiple_pairs_and_threshold():
    r=assess_localization(scope(),[pair(1),pair(2,pred=box(20,20,30,30))],iou_threshold=.7)
    assert r.mean_iou==.5
    assert r.median_iou==.5
    assert r.threshold_met==1
    assert r.pair_count==2


@pytest.mark.parametrize("change,reason", [
    ({"reference_status":"pending_expert_review"},"expert_reference_unavailable"),
    ({"source_kind":"mock"},"real_model_output_unavailable"),
    ({"predictions_complete":False},"prediction_scope_incomplete"),
    ({"exhaustive_reference":False},"reference_scope_incomplete"),
    ({"adjudication_complete":False},"reference_disagreements_unresolved"),
])
def test_missing_evidence_blocks_localization(change,reason):
    r=assess_localization(scope(**change),[pair()])
    assert r.assessment_status=="not_evaluated"
    assert r.mean_iou is None
    assert reason in r.blockers


def test_empty_pairs_not_success():
    r=assess_localization(scope(),[])
    assert r.assessment_status=="not_evaluated"
    assert "no_verified_localization_pairs" in r.blockers


def test_unconfirmed_pair_not_success():
    r=assess_localization(scope(),[pair(confirmed=False)])
    assert "pairing_not_expert_confirmed" in r.blockers


def test_mismatched_frame_not_success():
    r=assess_localization(scope(),[pair(pred=box(token="other"))])
    assert "coordinate_frame_mismatch" in r.blockers


@pytest.mark.parametrize("bad_pred", [
    box(w=101), box(h=101), box(token="other"),
])
def test_inconsistent_image_frames_block_score(bad_pred):
    r=assess_localization(scope(),[pair(pred=bad_pred)])
    assert r.assessment_status=="not_evaluated"
    assert r.threshold_met is None


def test_duplicate_pair_blocks():
    r=assess_localization(scope(),[pair(1),pair(1)])
    assert "duplicate_localization_pair" in r.blockers


def test_wrong_analysis_unit_blocks():
    case_scope=scope().model_copy(update={"unit_of_analysis":"case"})
    r=assess_localization(case_scope,[pair()])
    assert "localization_requires_region_units" in r.blockers


@pytest.mark.parametrize("threshold", [-1, 0, 1.1,float("inf"),float("nan")])
def test_invalid_threshold(threshold):
    with pytest.raises(ValueError):
        assess_localization(scope(),[pair()],iou_threshold=threshold)


@pytest.mark.parametrize("bad", [
    dict(x_min=-1),dict(x_min=10),dict(x_max=11,image_width=10),
    dict(y_min=10),dict(y_max=11,image_height=10),
    dict(x_min=float("nan")),dict(y_min=float("inf")),
    dict(image_width=0), dict(image_height=0),dict(frame_token="not allowed spaces"),
])
def test_invalid_box_geometry(bad):
    args=dict(x_min=0,y_min=0,x_max=10,y_max=10,image_width=10,image_height=10,frame_token="frame")
    args.update(bad)
    with pytest.raises(ValidationError):
        LocalizationBox(**args)


def test_no_raw_frame_identifiers_in_result():
    r=assess_localization(scope(),[pair(ref=box(token="private_frame"),pred=box(token="private_frame"))])
    assert "private_frame" not in r.model_dump_json()
    assert "pair1" not in r.model_dump_json()


def test_wrong_input_types_raise():
    with pytest.raises(TypeError):
        assess_localization(scope(),[object()])
