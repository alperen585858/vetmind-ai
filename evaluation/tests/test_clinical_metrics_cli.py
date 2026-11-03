"""Exercise CLI behavior without producing or bundling clinical datasets."""
from __future__ import annotations
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT=Path(__file__).resolve().parents[2]
SCRIPT=ROOT/"benchmarks"/"evaluate_clinical_metrics.py"


def invoke(*args):
    return subprocess.run([sys.executable,str(SCRIPT),*map(str,args)],cwd=ROOT,
                          text=True,capture_output=True,timeout=15)


def test_default_no_data_readiness():
    r=invoke()
    assert r.returncode==0, r.stderr
    j=json.loads(r.stdout)
    assert j["assessment_status"]=="not_evaluated"
    assert j["clinical_metrics"] is None


def test_readiness_file_output(tmp_path):
    target=tmp_path/"readiness.json"
    r=invoke("--kind","readiness","--output",target)
    assert r.returncode==0
    assert target.exists()
    assert json.loads(target.read_text())["clinical_validation"]=="not_evaluated"


@pytest.mark.parametrize("kind",["observations","counts","localization"])
def test_requires_input(kind):
    r=invoke("--kind",kind)
    assert r.returncode==2
    assert "input_required" not in r.stderr  # No raw configuration details exposed


def test_prevents_input_for_readiness(tmp_path):
    path=tmp_path/"test.json"
    path.write_text("{}")
    assert invoke("--kind","readiness","--input",path).returncode==2


def test_rejects_nonobject_json(tmp_path):
    path=tmp_path/"test.json"
    path.write_text("[]")
    assert invoke("--kind","counts","--input",path).returncode==2


def test_rejects_oversized_input(tmp_path):
    path=tmp_path/"test.json"
    path.write_bytes(b" " * (8*1024*1024+1))
    assert invoke("--kind","counts","--input",path).returncode==2


def test_sensitive_validation_error_not_echoed(tmp_path):
    path=tmp_path/"test.json"
    path.write_text(json.dumps({"patient_name":"SUPERSECRET-PATIENT","count":3}))
    r=invoke("--kind","counts","--input",path)
    assert r.returncode==2
    assert "SUPERSECRET-PATIENT" not in r.stderr
    assert "SUPERSECRET-PATIENT" not in r.stdout


def test_invalid_json_does_not_leak_content(tmp_path):
    path=tmp_path/"test.json"
    path.write_text("{\"private\": SUPERSECRET-PATIENT")
    r=invoke("--kind","observations","--input",path)
    assert r.returncode==2
    assert "SUPERSECRET-PATIENT" not in (r.stderr+r.stdout)


def test_cli_writes_not_evaluated_for_unreviewed_counts(tmp_path):
    path=tmp_path/"input.json"
    out=tmp_path/"output.json"
    raw={
      "scope":{"evaluation_id":"run", "model_id":"model", "model_version":"v1",
               "target_code":"target", "unit_of_analysis":"case"},
      "counts":{"true_positive":4,"false_positive":3,"false_negative":2,"true_negative":2,
                "count_attestation_ref":"attestation"},
    }
    path.write_text(json.dumps(raw))
    r=invoke("--kind","counts","--input",path,"--output",out)
    assert r.returncode==0, r.stderr
    result=json.loads(out.read_text())
    assert result["counts"] is None
    assert result["assessment_status"]=="not_evaluated"
    assert result["clinical_validation"]=="not_evaluated"


def test_cli_writes_no_unit_ids_in_report(tmp_path):
    path=tmp_path/"input.json"
    raw={
      "scope":{"evaluation_id":"run", "model_id":"model", "model_version":"v1",
               "target_code":"target", "unit_of_analysis":"case",
               "provenance":{"reference_status":"expert_verified","dataset_id":"ds",
                "dataset_version":"v1","review_record_id":"review","source_kind":"real",
                "exhaustive_reference":True,"predictions_complete":True,"adjudication_complete":True}},
      "observations":[{"unit_id":"sensitiveopaque1","reference_positive":True,
                       "predicted_positive":False,"expert_reviewed":True}],
    }
    path.write_text(json.dumps(raw))
    r=invoke("--kind","observations","--input",path)
    assert r.returncode==0,r.stderr
    assert "sensitiveopaque1" not in r.stdout
    assert json.loads(r.stdout)["clinical_validation"]=="not_evaluated"
