"""Versioned, image-independent evaluation input contracts."""
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

class EvaluationManifest(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    evaluation_id: str = Field(min_length=1)
    task: Literal["classification", "detection", "report"]
    model_id: str = Field(min_length=1)
    model_version: str = Field(min_length=1)
    dataset_id: str | None = None
    dataset_version: str | None = None
    reference_status: Literal["unavailable", "pending_expert_review", "expert_verified"] = "unavailable"
    report_template_id: str | None = None
    report_template_version: str | None = None
    @model_validator(mode="after")
    def verify(self) -> "EvaluationManifest":
        if bool(self.dataset_id) != bool(self.dataset_version):
            raise ValueError("dataset_id and dataset_version must be provided together")
        if bool(self.report_template_id) != bool(self.report_template_version):
            raise ValueError("report_template_id and report_template_version must be provided together")
        if self.reference_status == "expert_verified" and not self.dataset_id:
            raise ValueError("expert_verified requires a dataset identifier and version")
        return self

class EvaluationFinding(StrictModel):
    finding_id: str = Field(min_length=1)
    finding_code: str = Field(min_length=1)
    anatomical_location: str = Field(min_length=1)
    laterality: Literal["LEFT", "RIGHT", "MIDLINE", "UNKNOWN"] = "UNKNOWN"
    confidence: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    reviewed: bool = False

class EvaluationRecord(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    case_id: str = Field(min_length=1)
    species: Literal["canine", "feline", "other"]
    modality: Literal["MR", "CT", "XR", "OTHER"]
    anatomical_region: Literal["BRAIN", "CERVICAL", "THORAX", "OTHER", "UNKNOWN"]
    source_kind: Literal["mock", "real", "mixed", "manual"]
    execution_status: Literal["success", "partial", "failed", "unsupported"]
    findings: list[EvaluationFinding] = Field(default_factory=list)
    expert_verified: bool = False
    @model_validator(mode="after")
    def unique_findings(self) -> "EvaluationRecord":
        ids=[f.finding_id for f in self.findings]
        if len(ids)!=len(set(ids)):
            raise ValueError("duplicate finding_id")
        if self.expert_verified and (self.source_kind == "mock" or not all(f.reviewed for f in self.findings)):
            raise ValueError("expert_verified requires non-mock source and reviewed findings")
        return self

class EvaluationStatus(StrictModel):
    name: str
    status: Literal["ready", "not_evaluated"]
    reason: str | None = None

class InfrastructureAssessment(StrictModel):
    manifest: EvaluationManifest
    assessment_status: Literal["not_evaluated"] = "not_evaluated"
    checks: list[EvaluationStatus]
    clinical_metrics: None = None
