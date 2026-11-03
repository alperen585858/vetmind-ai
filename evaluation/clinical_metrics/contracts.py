"""Strict, versioned evaluation contracts without patient-identifying payloads.

The attestation references below are *claims supplied by the caller*. They do
not prove that a veterinarian reviewed the underlying images. Source access and
expert sign-off must be verified by the surrounding clinical workflow.
"""
from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

Identifier = str
ReviewStatus = Literal["unavailable", "pending_expert_review", "expert_verified"]
SourceKind = Literal["mock", "real", "mixed", "manual"]
UnitKind = Literal["case", "image", "region"]


class StrictContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


# Prevent raw free-text patient identifiers and human-readable notes in metadata.
# This is syntactic safety only, not guaranteed anonymisation.
OPAQUE_ID = r"^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,95}$"


class ReviewProvenance(StrictContract):
    """Reference review traceability, without personal details of the reviewer."""

    reference_status: ReviewStatus = "unavailable"
    dataset_id: str | None = Field(default=None, pattern=OPAQUE_ID)
    dataset_version: str | None = Field(default=None, pattern=OPAQUE_ID)
    review_record_id: str | None = Field(default=None, pattern=OPAQUE_ID)
    source_kind: SourceKind = "mock"
    exhaustive_reference: StrictBool = False
    predictions_complete: StrictBool = False
    adjudication_complete: StrictBool = False

    @model_validator(mode="after")
    def validate_linkages(self) -> "ReviewProvenance":
        if (self.dataset_id is None) != (self.dataset_version is None):
            raise ValueError("dataset identifier and version must occur together")
        if self.reference_status == "expert_verified" and (
            not self.dataset_id or not self.review_record_id
        ):
            raise ValueError("expert verification requires dataset and review references")
        return self


class EvaluationScope(StrictContract):
    """Immutable, single-label evaluation universe.

    A true negative only exists when the evaluation universe explicitly
    defines the negative opportunities for this *same* target and unit.
    """

    schema_version: Literal["1.0.0"] = "1.0.0"
    evaluation_id: str = Field(pattern=OPAQUE_ID)
    model_id: str = Field(pattern=OPAQUE_ID)
    model_version: str = Field(pattern=OPAQUE_ID)
    target_code: str = Field(pattern=OPAQUE_ID)
    unit_of_analysis: UnitKind
    provenance: ReviewProvenance = Field(default_factory=ReviewProvenance)

    @property
    def blockers(self) -> tuple[str, ...]:
        p = self.provenance
        issues: list[str] = []
        if p.reference_status != "expert_verified":
            issues.append("expert_reference_unavailable")
        if p.source_kind != "real":
            issues.append("real_model_output_unavailable")
        if not p.exhaustive_reference:
            issues.append("reference_scope_incomplete")
        if not p.predictions_complete:
            issues.append("prediction_scope_incomplete")
        if not p.adjudication_complete:
            issues.append("reference_disagreements_unresolved")
        return tuple(issues)


class BinaryObservation(StrictContract):
    """One evaluated *opportunity*, not one positively detected finding.

    The truth value must be known and confirmed for both positive and negative
    opportunities. A missing model result cannot be reinterpreted as negative.
    unit_id is opaque and MUST NOT be written to aggregate output.
    """

    unit_id: str = Field(pattern=OPAQUE_ID)
    reference_positive: StrictBool | None
    predicted_positive: StrictBool | None
    expert_reviewed: StrictBool = False
    prediction_available: StrictBool = True

    @model_validator(mode="after")
    def validate_prediction(self) -> "BinaryObservation":
        if not self.prediction_available and self.predicted_positive is not None:
            raise ValueError("unavailable prediction cannot contain a binary decision")
        return self


class CountInput(StrictContract):
    """Counts from an externally audited, exhaustive evaluation universe."""

    true_positive: int = Field(ge=0, le=10_000_000, strict=True)
    false_positive: int = Field(ge=0, le=10_000_000, strict=True)
    false_negative: int = Field(ge=0, le=10_000_000, strict=True)
    true_negative: int | None = Field(default=None, ge=0, le=10_000_000, strict=True)
    count_attestation_ref: str = Field(pattern=OPAQUE_ID)


class ClassificationInput(StrictContract):
    scope: EvaluationScope
    observations: list[BinaryObservation] = Field(min_length=0, max_length=250_000)


class CountEvaluationInput(StrictContract):
    scope: EvaluationScope
    counts: CountInput


class LocalizationBox(StrictContract):
    x_min: float = Field(ge=0, allow_inf_nan=False)
    y_min: float = Field(ge=0, allow_inf_nan=False)
    x_max: float = Field(ge=0, allow_inf_nan=False)
    y_max: float = Field(ge=0, allow_inf_nan=False)
    image_width: int = Field(gt=0, le=100_000, strict=True)
    image_height: int = Field(gt=0, le=100_000, strict=True)
    frame_token: str = Field(pattern=OPAQUE_ID)
    coordinate_space: Literal["pixel_2d"] = "pixel_2d"

    @model_validator(mode="after")
    def valid_geometry(self) -> "LocalizationBox":
        if self.x_min >= self.x_max or self.y_min >= self.y_max:
            raise ValueError("bounding box must have positive area")
        if self.x_max > self.image_width or self.y_max > self.image_height:
            raise ValueError("bounding box extends beyond image")
        return self


class LocalizationPair(StrictContract):
    """Expert-confirmed correspondence on the exact same image frame."""

    pair_id: str = Field(pattern=OPAQUE_ID)
    reference: LocalizationBox
    prediction: LocalizationBox
    expert_confirmed_pairing: StrictBool = False


class LocalizationInput(StrictContract):
    scope: EvaluationScope
    pairs: list[LocalizationPair] = Field(max_length=250_000)
    iou_threshold: float = Field(default=0.5, gt=0, le=1, allow_inf_nan=False)
