"""Result contracts distinguish missing evidence from mathematically undefined rates."""
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

State = Literal["ready", "not_evaluated", "undefined"]


class StrictResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Rate(StrictResult):
    name: str
    status: State
    value: float | None = Field(default=None, ge=-1.0, le=1.0, allow_inf_nan=False)
    numerator: int | None = Field(default=None, ge=0)
    denominator: int | None = Field(default=None, ge=0)
    reason: str | None = None
    confidence_lower: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    confidence_upper: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_state(self) -> "Rate":
        if self.status == "ready" and self.value is None:
            raise ValueError("ready rate requires value")
        if self.status != "ready" and self.value is not None:
            raise ValueError("unevaluated rate cannot have value")
        if (self.confidence_lower is None) != (self.confidence_upper is None):
            raise ValueError("confidence interval requires both bounds")
        if self.confidence_lower is not None and (
            self.status != "ready" or not self.confidence_lower <= self.value <= self.confidence_upper
        ):
            raise ValueError("invalid confidence interval")
        return self


class Counts(StrictResult):
    tp: int = Field(ge=0)
    fp: int = Field(ge=0)
    fn: int = Field(ge=0)
    tn: int | None = Field(default=None, ge=0)


class ClassificationReport(StrictResult):
    schema_version: Literal["1.0.0"] = "1.0.0"
    assessment_status: Literal["ready", "not_evaluated"]
    blockers: tuple[str, ...] = ()
    evaluation_id: str
    model_id: str
    model_version: str
    dataset_id: str | None = None
    dataset_version: str | None = None
    target_code: str
    unit_of_analysis: str
    observations_evaluated: int = Field(ge=0)
    counts: Counts | None = None
    rates: dict[str, Rate] = Field(default_factory=dict)
    clinical_validation: Literal["not_evaluated"] = "not_evaluated"


class LocalizationReport(StrictResult):
    schema_version: Literal["1.0.0"] = "1.0.0"
    assessment_status: Literal["ready", "not_evaluated"]
    blockers: tuple[str, ...] = ()
    evaluation_id: str
    model_id: str
    model_version: str
    dataset_id: str | None = None
    target_code: str
    pair_count: int = Field(ge=0)
    iou_threshold: float = Field(gt=0, le=1)
    mean_iou: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    median_iou: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    threshold_met: int | None = Field(default=None, ge=0)
    clinical_validation: Literal["not_evaluated"] = "not_evaluated"
