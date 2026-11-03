"""Structural-only tests; no DICOM pixels or clinical evaluation cases."""
from __future__ import annotations

import json
import subprocess
import sys
import types
from pathlib import Path
from typing import Literal, Optional

import pytest
from pydantic import BaseModel, create_model

from evaluation.adapters.shape_guard import (
    ShapeRule, _IMPORTS, _RULES, _kind_matches,
    check_pipeline_contract_shapes, inspect_contract_model,
)

BACKEND = Path(__file__).resolve().parents[2] / "backend"
if BACKEND.is_dir() and str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def test_builtin_contract_map_has_exact_relevant_stages():
    assert set(_RULES) == {"model_outputs", "structured_findings", "draft_report"}
    assert set(_IMPORTS) == set(_RULES)
    assert len({(r.model, r.field) for rs in _RULES.values() for r in rs}) == sum(
        map(len, _RULES.values())
    )


@pytest.mark.parametrize("annotation,rule,valid", [
    (str, ShapeRule("M", "x", "string"), True),
    (int, ShapeRule("M", "x", "string"), False),
    (Literal["LEFT", "RIGHT"], ShapeRule("M", "x", "string"), True),
    (Literal[1, 2], ShapeRule("M", "x", "string"), False),
    (Optional[str], ShapeRule("M", "x", "string", nullable=True), True),
    (Optional[str], ShapeRule("M", "x", "string"), False),
    (str, ShapeRule("M", "x", "string", nullable=True), False),
    (str | None, ShapeRule("M", "x", "string", nullable=True), True),
    (bool, ShapeRule("M", "x", "boolean"), True),
    (int, ShapeRule("M", "x", "boolean"), False),
    (float, ShapeRule("M", "x", "number"), True),
    (int, ShapeRule("M", "x", "number"), True),
    (str, ShapeRule("M", "x", "number"), False),
    (list[str], ShapeRule("M", "x", "list", "str"), True),
    (list, ShapeRule("M", "x", "list", "str"), False),
    (list[int], ShapeRule("M", "x", "list", "str"), False),
    (tuple[str, ...], ShapeRule("M", "x", "list", "str"), False),
    (Optional[list[str]], ShapeRule("M", "x", "list", "str", True), True),
    (list[str], ShapeRule("M", "x", "list", "str", True), False),
    (dict[str, str], ShapeRule("M", "x", "list", "str"), False),
])
def test_type_guards(annotation, rule, valid):
    assert _kind_matches(annotation, rule) is valid


class Child(BaseModel):
    name: str


@pytest.mark.parametrize("annotation,rule,valid", [
    (Child, ShapeRule("M", "x", "model", "Child"), True),
    (Child | None, ShapeRule("M", "x", "model", "Child", True), True),
    (Child, ShapeRule("M", "x", "model", "Other"), False),
    (list[Child], ShapeRule("M", "x", "list", "Child"), True),
    (list[str], ShapeRule("M", "x", "list", "Child"), False),
    (Child, ShapeRule("M", "x", "model", "Child", True), False),
])
def test_nested_guards(annotation, rule, valid):
    assert _kind_matches(annotation, rule) is valid


def _require_backend():
    if not BACKEND.is_dir():
        pytest.skip("VetMind backend not supplied with isolated test package")
    from app.schemas import findings, model_outputs, report
    return findings, model_outputs, report


def test_existing_backend_contracts_are_compatible():
    _require_backend()
    result = check_pipeline_contract_shapes()
    assert result.status == "compatible", result.issues
    assert result.clinical_status == "not_evaluated"
    assert result.clinical_metrics is None
    assert result.rules_checked == sum(len(rs) for rs in _RULES.values()) + 3
    assert result.issues == ()


@pytest.mark.parametrize("contract,module_index", [
    ("structured_findings", 0),
    ("model_outputs", 1),
    ("draft_report", 2),
])
def test_each_current_backend_subgraph(contract, module_index):
    backend_modules = _require_backend()
    actual = inspect_contract_model(contract, backend_modules[module_index])
    assert actual.status == "compatible", actual.issues
    assert actual.rules_checked == len(_RULES[contract])


def test_changed_field_type_detected():
    findings, _, _ = _require_backend()
    Broken = create_model("StructuredFindings", __base__=findings.StructuredFindings,
                          case_id=(int, ...))
    module = types.SimpleNamespace(**{
        name: getattr(findings, name) for name in ("Finding", "EvidenceReference", "BoundingBoxEvidence")
    }, StructuredFindings=Broken)
    result = inspect_contract_model("structured_findings", module)
    assert result.status == "incompatible"
    assert any(i.code == "type_changed" and i.field == "case_id" for i in result.issues)
    assert "patient" not in str(result.model_dump()).lower()


def test_changed_optional_field_detected():
    _, outputs, _ = _require_backend()
    Changed = create_model("ModelTaskOutputs", __base__=outputs.ModelTaskOutputs,
                           detection=(outputs.DetectionOutput, ...))
    module = types.SimpleNamespace(ModelTaskOutputs=Changed,
                                   DetectionOutput=outputs.DetectionOutput,
                                   BoundingBox2D=outputs.BoundingBox2D)
    result = inspect_contract_model("model_outputs", module)
    assert ("detection", "type_changed") in {(i.field, i.code) for i in result.issues}


def test_missing_public_model_detected():
    fake = types.SimpleNamespace()
    result = inspect_contract_model("model_outputs", fake)
    assert result.status == "incompatible"
    assert any(issue.code == "model_missing" for issue in result.issues)


def test_missing_field_detected():
    _, _, report = _require_backend()
    Changed = create_model("ReportSection", text=(str, ...))
    fake = types.SimpleNamespace(DraftReport=report.DraftReport,
                                 GenerationMetadata=report.GenerationMetadata,
                                 ReportSection=Changed)
    result = inspect_contract_model("draft_report", fake)
    assert any(i.code == "field_missing" and i.field == "cited_finding_ids"
               for i in result.issues)


def test_json_output_excludes_patient_data():
    _require_backend()
    payload = check_pipeline_contract_shapes().model_dump(mode="json")
    assert set(payload) == {"status", "rules_checked", "issues", "clinical_status", "clinical_metrics"}
    assert "case_id" not in json.dumps(payload)  # field name not needed for successful check


def test_cli_reports_current_backend_without_data():
    _require_backend()
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [sys.executable, str(root / "benchmarks" / "check_contract_shapes.py")],
        cwd=str(root), capture_output=True, text=True, timeout=15, check=False,
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["status"] == "compatible"
    assert report["clinical_metrics"] is None


def test_cli_output_file(tmp_path):
    _require_backend()
    root = Path(__file__).resolve().parents[2]
    output = tmp_path / "run" / "shape_report.json"
    result = subprocess.run(
        [sys.executable, str(root / "benchmarks" / "check_contract_shapes.py"),
         "--output", str(output)],
        cwd=str(root), capture_output=True, text=True, timeout=15, check=False,
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["status"] == "compatible"
    assert "Schema check: compatible" in result.stdout
