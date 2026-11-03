"""Integration tests against the repository's actual model output schema."""
from pathlib import Path
import sys
import pytest

BACKEND = Path(__file__).resolve().parents[2] / "backend"
if not BACKEND.is_dir():
    pytest.skip("Full VetMind backend unavailable in isolated package", allow_module_level=True)
sys.path.insert(0, str(BACKEND))

from app.schemas.enums import ModelExecutionStatus, SourceKind
from app.schemas.model_outputs import BoundingBox2D, DetectionOutput, ModelTaskOutputs
from evaluation.adapters.vision import assess_model_output


def bundle(**overrides):
    fields = dict(model_id="unit-test-model", model_version="0", case_id="unit-case",
                  execution_status=ModelExecutionStatus.SUCCESS, source_kind=SourceKind.REAL)
    fields.update(overrides)
    return ModelTaskOutputs(**fields)


def test_empty_output_has_no_clinical_score():
    result = assess_model_output(bundle())
    assert result.status == "structurally_valid"
    assert result.detection_box_count == 0
    assert not hasattr(result, "sensitivity")


def test_real_detection_geometry_is_validated():
    result = assess_model_output(bundle(detection=DetectionOutput(boxes=[
        BoundingBox2D(x_min=0, y_min=0, x_max=12, y_max=10)
    ])))
    assert result.status == "structurally_valid"
    assert result.detection_box_count == 1
    assert result.boxes_with_missing_scores == 1


def test_mock_not_evaluated_even_with_boxes():
    result = assess_model_output(bundle(source_kind=SourceKind.MOCK,
                                        detection=DetectionOutput(boxes=[])))
    assert result.status == "not_evaluated"


def test_fixed_boxes_cannot_count_as_inference():
    result = assess_model_output(bundle(detection=DetectionOutput(
        boxes=[], computed_from_input=False)))
    assert result.status == "not_evaluated"


def test_non_pixel_coordinates_are_not_assumed_equivalent():
    result = assess_model_output(bundle(detection=DetectionOutput(
        coordinate_space="patient", boxes=[])))
    assert result.status == "not_evaluated"


def test_invalid_bounds_fail_even_if_pydantic_allows_the_box():
    result = assess_model_output(bundle(detection=DetectionOutput(boxes=[
        BoundingBox2D(x_min=12, y_min=0, x_max=1, y_max=10)
    ])))
    assert result.status == "invalid"


def test_future_contract_version_not_assumed_supported():
    result = assess_model_output(bundle(schema_version="9.0.0"))
    assert result.status == "unsupported"
