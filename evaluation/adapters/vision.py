"""Read-only assessment of VetMind model output contracts.

No conversion assumes unreported images, reference labels or normal findings.
Do not treat a valid geometry contract as a clinically validated detection.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from evaluation.metrics.geometry import Box2D
from evaluation.versioning import check_contract

if TYPE_CHECKING:
    from app.schemas.model_outputs import ModelTaskOutputs


@dataclass(frozen=True)
class VisionContractAssessment:
    status: str
    reason: str | None
    model_id: str
    model_version: str
    task_heads_present: tuple[str, ...]
    detection_box_count: int
    coordinate_space: str | None
    boxes_with_missing_scores: int


def assess_model_output(source: "ModelTaskOutputs") -> VisionContractAssessment:
    """Perform safe structural inspection, not medical-performance scoring."""
    if not check_contract("model_outputs", source.schema_version).supported:
        return VisionContractAssessment(
            "unsupported", "Model task output schema is not supported",
            source.model_id, source.model_version, (), 0, None, 0,
        )
    heads = tuple(name for name in
                  ("classification", "detection", "segmentation", "measurements")
                  if getattr(source, name) is not None)
    detection = source.detection
    box_count = len(detection.boxes) if detection else 0
    no_scores = sum(box.score is None for box in detection.boxes) if detection else 0
    space = detection.coordinate_space if detection else None
    geometry_invalid = False
    if detection is not None:
        try:
            for box in detection.boxes:
                Box2D(box.x_min, box.y_min, box.x_max, box.y_max)
        except (TypeError, ValueError, OverflowError):
            geometry_invalid = True
    if geometry_invalid:
        status, reason = "invalid", "Detection box geometry is invalid"
    elif source.source_kind.value in {"mock", "mixed", "manual"}:
        status, reason = "not_evaluated", "Source is not verified as real inference"
    elif source.execution_status.value not in {"success", "partial"}:
        status, reason = "not_evaluated", "Model execution did not succeed"
    elif detection is not None and not detection.computed_from_input:
        status, reason = "not_evaluated", "Bounding boxes were not computed from the input"
    elif detection is not None and space not in {"pixel_2d", "pixel_2d_native"}:
        status, reason = "not_evaluated", "Detection coordinate space is not supported"
    else:
        status, reason = "structurally_valid", None
    return VisionContractAssessment(
        status, reason, source.model_id, source.model_version,
        heads, box_count, space, no_scores,
    )
