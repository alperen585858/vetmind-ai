"""CLI tests use structural fixture files, not invented clinical datasets."""
import json
from benchmarks.validate_contracts import run
from evaluation.contracts import EvaluationManifest


def test_json_schema_export(capsys):
    assert run(["--schema", "manifest"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["title"] == "EvaluationManifest"
    assert "schema_version" in result["properties"]


def test_cli_empty_batch_without_manifest_is_error(tmp_path, capsys):
    assert run(["--manifest", str(tmp_path / "does-not-exist.json")]) == 2
    assert "Invalid or unreadable input" in capsys.readouterr().err


def test_cli_manifest_only_is_valid_not_clinical(tmp_path, capsys):
    path = tmp_path / "manifest.json"
    path.write_text(EvaluationManifest(evaluation_id="unit", task="report",
                                       model_id="none", model_version="0").model_dump_json(),
                    encoding="utf-8")
    assert run(["--manifest", str(path)]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "valid"
    assert result["clinical_metrics"] is None


def test_cli_require_cases_exits_nonzero(tmp_path, capsys):
    path = tmp_path / "manifest.json"
    path.write_text(EvaluationManifest(evaluation_id="unit", task="report",
                                       model_id="none", model_version="0").model_dump_json(),
                    encoding="utf-8")
    assert run(["--manifest", str(path), "--require-cases"]) == 1
    assert json.loads(capsys.readouterr().out)["status"] == "invalid"


def test_cli_output_file(tmp_path, capsys):
    path = tmp_path / "manifest.json"
    output = tmp_path / "out" / "report.json"
    path.write_text(EvaluationManifest(evaluation_id="unit", task="report",
                                       model_id="none", model_version="0").model_dump_json(),
                    encoding="utf-8")
    assert run(["--manifest", str(path), "--output", str(output)]) == 0
    assert json.loads(output.read_text(encoding="utf-8"))["record_count"] == 0
    assert "written" in capsys.readouterr().out


def test_cli_rejects_bad_record_without_dumping_data(tmp_path, capsys):
    manifest = tmp_path / "manifest.json"
    records = tmp_path / "records.json"
    manifest.write_text(EvaluationManifest(evaluation_id="unit", task="report",
                                            model_id="none", model_version="0").model_dump_json(),
                        encoding="utf-8")
    records.write_text(json.dumps([{"case_id": "private@example.com", "unexpected": "SECRET"}]),
                       encoding="utf-8")
    assert run(["--manifest", str(manifest), "--records", str(records)]) == 2
    stderr = capsys.readouterr().err
    assert "SECRET" not in stderr and "private@example.com" not in stderr
    assert "validation error" in stderr
