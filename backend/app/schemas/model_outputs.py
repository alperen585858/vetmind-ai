"""Standard Vision task output contracts (classification / detection / segmentation).

These schemas are the wire/integration surface for future real models. They map into
``StructuredFindings`` for the existing clinical review pipeline. Confidence is never
invented when absent.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.enums import FindingStatus, ModelExecutionStatus, SourceKind

MODEL_OUTPUTS_SCHEMA_VERSION = "1.0.0"

TaskKind = Literal[
    "classification",
    "detection",
    "segmentation",
    "measurement",
    "structured_findings",
]


class ClassificationLabel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    score: Optional[float] = None
    finding_status: FindingStatus = FindingStatus.UNCERTAIN

    @field_validator("score")
    @classmethod
    def _score_range(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            return None
        if value < 0.0 or value > 1.0:
            raise ValueError("score must be in [0, 1] when present")
        return value


class ClassificationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task: Literal["classification"] = "classification"
    labels: list[ClassificationLabel] = Field(default_factory=list)
    top_label: Optional[str] = None


class BoundingBox2D(BaseModel):
    """Axis-aligned box in pixel coordinates (x_min, y_min, x_max, y_max)."""

    model_config = ConfigDict(extra="forbid")

    x_min: float
    y_min: float
    x_max: float
    y_max: float
    label: Optional[str] = None
    score: Optional[float] = None
    frame_index: Optional[int] = None
    sop_instance_uid: Optional[str] = None

    @field_validator("score")
    @classmethod
    def _score_range(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            return None
        if value < 0.0 or value > 1.0:
            raise ValueError("score must be in [0, 1] when present")
        return value


class DetectionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task: Literal["detection"] = "detection"
    boxes: list[BoundingBox2D] = Field(default_factory=list)
    coordinate_space: str = "pixel_2d"


class SegmentationRegion(BaseModel):
    """Mask reference — never embeds full clinical pixel masks in API responses by default."""

    model_config = ConfigDict(extra="forbid")

    region_id: str
    label: str
    # Optional compact RLE / shape metadata for future adapters.
    mask_encoding: Optional[str] = None  # none | rle | path_ref
    mask_ref: Optional[str] = None
    shape: Optional[tuple[int, ...]] = None
    score: Optional[float] = None
    sop_instance_uid: Optional[str] = None
    frame_index: Optional[int] = None

    @field_validator("score")
    @classmethod
    def _score_range(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            return None
        if value < 0.0 or value > 1.0:
            raise ValueError("score must be in [0, 1] when present")
        return value


class SegmentationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task: Literal["segmentation"] = "segmentation"
    regions: list[SegmentationRegion] = Field(default_factory=list)


class MeasurementValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    measurement_id: str
    name: str
    value: float
    unit: str
    anatomical_location: Optional[str] = None
    sop_instance_uid: Optional[str] = None
    note: str = "Measurement from model output. Requires expert verification."


class MeasurementOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task: Literal["measurement"] = "measurement"
    measurements: list[MeasurementValue] = Field(default_factory=list)


class ModelTaskOutputs(BaseModel):
    """Bundle of optional task heads from a Vision adapter."""

    model_config = ConfigDict(extra="forbid")

    schema_version: str = MODEL_OUTPUTS_SCHEMA_VERSION
    model_id: str
    model_version: str
    case_id: str
    execution_status: ModelExecutionStatus
    source_kind: SourceKind = SourceKind.MOCK
    classification: Optional[ClassificationOutput] = None
    detection: Optional[DetectionOutput] = None
    segmentation: Optional[SegmentationOutput] = None
    measurements: Optional[MeasurementOutput] = None
    warnings: list[str] = Field(default_factory=list)
    processing_metadata: dict[str, str] = Field(default_factory=dict)
    note: str = (
        "Task outputs are integration contracts. "
        "source_kind=real does not imply clinical validation. "
        "Missing task heads must not be treated as disease exclusion."
    )
