"""Read-only type drift check at the actual VetMind model handoff boundary.

Existing `compatibility.py` checks contract versions and public field names.
This deliberately checks a different invariant: the *shape* of nested inputs
which Vision, normalization and reporting must pass to each other. It only
inspects Python/Pydantic model definitions; no DICOM, patients, or test cases.

A pass means the declared Python field types match the types this standalone
adapter was developed against. It is not API or clinical validation.
"""
from __future__ import annotations

import importlib
import types
from dataclasses import dataclass
from enum import Enum
from typing import Literal, Union, get_args, get_origin

from pydantic import BaseModel, ConfigDict, Field

from evaluation.versioning import check_contract


@dataclass(frozen=True)
class ShapeRule:
    """One required public field, including its nesting and nullability."""

    model: str
    field: str
    kind: Literal["string", "boolean", "integer", "number", "enum", "model", "list"]
    target: str | None = None
    nullable: bool = False


# These are the actual *interfaces* needed by evaluation, not every internal
# member of VetMind's larger Pydantic classes. No clinical taxonomy is assumed.
_RULES: dict[str, tuple[ShapeRule, ...]] = {
    "model_outputs": (
        ShapeRule("ModelTaskOutputs", "case_id", "string"),
        ShapeRule("ModelTaskOutputs", "model_id", "string"),
        ShapeRule("ModelTaskOutputs", "schema_version", "string"),
        ShapeRule("ModelTaskOutputs", "execution_status", "enum"),
        ShapeRule("ModelTaskOutputs", "source_kind", "enum"),
        ShapeRule("ModelTaskOutputs", "detection", "model", "DetectionOutput", True),
        ShapeRule("DetectionOutput", "boxes", "list", "BoundingBox2D"),
        ShapeRule("DetectionOutput", "computed_from_input", "boolean"),
        ShapeRule("DetectionOutput", "coordinate_space", "string"),
        ShapeRule("BoundingBox2D", "x_min", "number"),
        ShapeRule("BoundingBox2D", "y_min", "number"),
        ShapeRule("BoundingBox2D", "x_max", "number"),
        ShapeRule("BoundingBox2D", "y_max", "number"),
        ShapeRule("BoundingBox2D", "score", "number", nullable=True),
        ShapeRule("BoundingBox2D", "sop_instance_uid", "string", nullable=True),
    ),
    "structured_findings": (
        ShapeRule("StructuredFindings", "case_id", "string"),
        ShapeRule("StructuredFindings", "schema_version", "string"),
        ShapeRule("StructuredFindings", "source_model_id", "string"),
        ShapeRule("StructuredFindings", "execution_status", "enum"),
        ShapeRule("StructuredFindings", "source_kind", "enum"),
        ShapeRule("StructuredFindings", "findings", "list", "Finding"),
        ShapeRule("StructuredFindings", "no_findings_returned", "boolean"),
        ShapeRule("StructuredFindings", "absences_not_confirmed", "boolean"),
        ShapeRule("Finding", "finding_id", "string"),
        ShapeRule("Finding", "finding_code", "string"),
        ShapeRule("Finding", "laterality", "string"),
        ShapeRule("Finding", "model_confidence", "number", nullable=True),
        ShapeRule("Finding", "evidence_references", "list", "EvidenceReference"),
        ShapeRule("EvidenceReference", "bbox", "model", "BoundingBoxEvidence", True),
        ShapeRule("BoundingBoxEvidence", "x_min", "number"),
        ShapeRule("BoundingBoxEvidence", "y_min", "number"),
        ShapeRule("BoundingBoxEvidence", "x_max", "number"),
        ShapeRule("BoundingBoxEvidence", "y_max", "number"),
        ShapeRule("BoundingBoxEvidence", "coordinate_space", "string"),
    ),
    "draft_report": (
        ShapeRule("DraftReport", "case_id", "string"),
        ShapeRule("DraftReport", "schema_version", "string"),
        ShapeRule("DraftReport", "report_id", "string"),
        ShapeRule("DraftReport", "status", "enum"),
        ShapeRule("DraftReport", "expert_review_status", "enum"),
        ShapeRule("DraftReport", "immutable", "boolean"),
        ShapeRule("DraftReport", "generation", "model", "GenerationMetadata"),
        ShapeRule("DraftReport", "technique", "model", "ReportSection"),
        ShapeRule("DraftReport", "findings", "model", "ReportSection"),
        ShapeRule("DraftReport", "impression", "model", "ReportSection"),
        ShapeRule("DraftReport", "recommendations", "model", "ReportSection"),
        ShapeRule("ReportSection", "text", "string"),
        ShapeRule("ReportSection", "cited_finding_ids", "list", "str"),
        ShapeRule("GenerationMetadata", "clinically_validated", "boolean"),
        ShapeRule("GenerationMetadata", "synthetic", "boolean"),
    ),
}

_IMPORTS: dict[str, tuple[str, str, str]] = {
    "model_outputs": ("app.schemas.model_outputs", "ModelTaskOutputs", "MODEL_OUTPUTS_SCHEMA_VERSION"),
    "structured_findings": ("app.schemas.findings", "StructuredFindings", "FINDINGS_SCHEMA_VERSION"),
    "draft_report": ("app.schemas.report", "DraftReport", "REPORT_SCHEMA_VERSION"),
}


class ShapeIssue(BaseModel):
    """Only allowlisted structural identifiers. Never serialize source values."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    contract: Literal["model_outputs", "structured_findings", "draft_report"]
    model: str
    field: str
    code: Literal["backend_unavailable", "model_missing", "field_missing", "type_changed", "version_unsupported"]


class ShapeReport(BaseModel):
    """Structural contract status, intentionally not a clinical metric."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    status: Literal["compatible", "incompatible", "unavailable"]
    rules_checked: int = Field(ge=0)
    issues: tuple[ShapeIssue, ...] = ()
    clinical_status: Literal["not_evaluated"] = "not_evaluated"
    clinical_metrics: None = None


def _split_optional(annotation: object) -> tuple[object, bool]:
    """Strip *only* the None branch of Optional[T] and PEP604 T | None."""
    origin = get_origin(annotation)
    if origin in (Union, types.UnionType):
        args = get_args(annotation)
        non_null = tuple(item for item in args if item is not type(None))
        if len(non_null) == 1 and len(non_null) + 1 == len(args):
            return non_null[0], True
    return annotation, False


def _kind_matches(annotation: object, rule: ShapeRule) -> bool:
    inner, nullable = _split_optional(annotation)
    if nullable != rule.nullable:
        return False
    origin = get_origin(inner)
    if rule.kind == "list":
        if origin is not list:
            return False
        type_args = get_args(inner)
        if len(type_args) != 1:
            return False
        return getattr(type_args[0], "__name__", None) == rule.target
    if rule.kind == "model":
        return (
            isinstance(inner, type)
            and issubclass(inner, BaseModel)
            and inner.__name__ == rule.target
        )
    if rule.kind == "enum":
        return isinstance(inner, type) and issubclass(inner, Enum)
    if rule.kind == "string":
        # Literal[str] is also a string on the wire, but not a plain str.
        # It is intentionally permitted if *all* Literal values are strings.
        return inner is str or (origin is Literal and bool(get_args(inner))
                                and all(type(item) is str for item in get_args(inner)))
    if rule.kind == "boolean":
        return inner is bool
    if rule.kind == "integer":
        return inner is int
    if rule.kind == "number":
        return inner in (float, int)
    return False


def inspect_contract_model(
    contract: Literal["model_outputs", "structured_findings", "draft_report"],
    module: object,
) -> ShapeReport:
    """Test a module's declared model shapes; enables safe drift regression tests."""
    issues: list[ShapeIssue] = []
    checks = 0
    for rule in _RULES[contract]:
        checks += 1
        model = getattr(module, rule.model, None)
        if not isinstance(model, type) or not issubclass(model, BaseModel):
            issues.append(ShapeIssue(contract=contract, model=rule.model,
                                     field=rule.field, code="model_missing"))
            continue
        field = model.model_fields.get(rule.field)
        if field is None:
            issues.append(ShapeIssue(contract=contract, model=rule.model,
                                     field=rule.field, code="field_missing"))
        elif not _kind_matches(field.annotation, rule):
            issues.append(ShapeIssue(contract=contract, model=rule.model,
                                     field=rule.field, code="type_changed"))
    return ShapeReport(status="incompatible" if issues else "compatible",
                       rules_checked=checks, issues=tuple(issues))


def check_pipeline_contract_shapes() -> ShapeReport:
    """Inspect the three *current* VetMind schemas, without clinical objects."""
    issues: list[ShapeIssue] = []
    checks = 0
    unavailable = False
    for contract, (module_path, root_model, version_name) in _IMPORTS.items():
        try:
            module = importlib.import_module(module_path)
        except ImportError:
            unavailable = True
            issues.append(ShapeIssue(contract=contract, model=root_model,
                                     field="", code="backend_unavailable"))
            continue
        version = getattr(module, version_name, None)
        try:
            supported = isinstance(version, str) and check_contract(contract, version).supported
        except (TypeError, ValueError):
            supported = False
        checks += 1
        if not supported:
            issues.append(ShapeIssue(contract=contract, model=root_model,
                                     field="schema_version", code="version_unsupported"))
        report = inspect_contract_model(contract, module)
        issues.extend(report.issues)
        checks += report.rules_checked
    status: Literal["compatible", "incompatible", "unavailable"] = (
        "unavailable" if unavailable else "incompatible" if issues else "compatible"
    )
    return ShapeReport(status=status, rules_checked=checks, issues=tuple(issues))
