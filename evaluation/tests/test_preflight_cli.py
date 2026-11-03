"""Local CLI safety tests: no test patient datasets or imaging files."""
import json

import pytest

from benchmarks.preflight import _load_bounded_json, MAX_INPUT_BYTES, run, InputRejected


def test_cli_without_inputs_produces_not_evaluated(capsys):
    assert run([]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["clinical_status"] == "not_evaluated"
    assert report["clinical_metrics"] is None


def test_cli_writes_optional_output(tmp_path, capsys):
    out = tmp_path / "reports" / "preflight.json"
    assert run(["--output", str(out)]) == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["structural_status"] == "checks_passed"
    assert "written" in capsys.readouterr().out


def test_cli_accepts_strict_configuration(tmp_path, capsys):
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"require_cases": True}), encoding="utf-8")
    assert run(["--config", str(path)]) == 2
    report = json.loads(capsys.readouterr().out)
    assert report["structural_status"] == "blocked"


def test_cli_rejects_unknown_config_keys_without_echo(tmp_path, capsys):
    path = tmp_path / "config.json"
    path.write_text('{"secret":"PRIVATE-ACCESS-TOKEN"}', encoding="utf-8")
    assert run(["--config", str(path)]) == 2
    output = capsys.readouterr()
    assert "PRIVATE-ACCESS-TOKEN" not in output.err + output.out


def test_cli_rejects_invalid_manifest_without_echo(tmp_path, capsys):
    path = tmp_path / "private_manifest.json"
    path.write_text('{"model_id":"PRIVATE-PATIENT-DATA"}', encoding="utf-8")
    assert run(["--manifest", str(path)]) == 2
    result = capsys.readouterr()
    assert "PRIVATE" not in result.err + result.out


def test_cli_rejects_invalid_record_without_echo(tmp_path, capsys):
    path = tmp_path / "records.json"
    path.write_text('[{"case_id":"private@example.com","text":"SECRET"}]', encoding="utf-8")
    assert run(["--records", str(path)]) == 2
    result = capsys.readouterr()
    assert "SECRET" not in result.err + result.out
    assert "private@example.com" not in result.err + result.out


def test_cli_rejects_non_list_records(tmp_path, capsys):
    path = tmp_path / "records.json"
    path.write_text('{}', encoding="utf-8")
    assert run(["--records", str(path)]) == 2
    assert "rejected" in capsys.readouterr().err


def test_cli_rejects_duplicate_json_keys(tmp_path, capsys):
    path = tmp_path / "config.json"
    path.write_text('{"max_records":1,"max_records":2}', encoding="utf-8")
    assert run(["--config", str(path)]) == 2
    assert "rejected" in capsys.readouterr().err


@pytest.mark.parametrize("invalid", ['{"max_records":NaN}', '{"max_records":Infinity}', '{"max_records":-Infinity}'])
def test_cli_rejects_nonfinite_constants(tmp_path, capsys, invalid):
    path = tmp_path / "config.json"
    path.write_text(invalid, encoding="utf-8")
    assert run(["--config", str(path)]) == 2
    assert "rejected" in capsys.readouterr().err


def test_cli_rejects_invalid_utf8(tmp_path, capsys):
    path = tmp_path / "config.json"
    path.write_bytes(b'\xff\xfe\x00')
    assert run(["--config", str(path)]) == 2
    assert "rejected" in capsys.readouterr().err


def test_cli_accepts_utf8_bom(tmp_path, capsys):
    path = tmp_path / "config.json"
    path.write_bytes(b'\xef\xbb\xbf{}')
    assert run(["--config", str(path)]) == 0
    assert json.loads(capsys.readouterr().out)["clinical_metrics"] is None


def test_cli_rejects_giant_input(tmp_path, capsys):
    path = tmp_path / "config.json"
    with path.open("wb") as writer:
        writer.truncate(MAX_INPUT_BYTES + 1)
    assert run(["--config", str(path)]) == 2
    assert "rejected" in capsys.readouterr().err


def test_cli_rejects_deep_nesting(tmp_path):
    path = tmp_path / "config.json"
    path.write_text('[' * 40 + '0' + ']' * 40, encoding="utf-8")
    with pytest.raises(InputRejected):
        _load_bounded_json(path)


def test_cli_rejects_too_many_members(tmp_path):
    path = tmp_path / "config.json"
    path.write_text(json.dumps({str(i): i for i in range(1025)}), encoding="utf-8")
    with pytest.raises(InputRejected):
        _load_bounded_json(path)


def test_cli_checks_output_does_not_leak_input_ids(tmp_path, capsys):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"evaluation_id":"SECRET-CASE-ID", "task":"report",
                                    "model_id":"PRIVATE-MODEL", "model_version":"1"}), encoding="utf-8")
    assert run(["--manifest", str(manifest)]) == 0
    output = capsys.readouterr().out
    assert "SECRET-CASE-ID" not in output
    assert "PRIVATE-MODEL" not in output


def test_cli_writes_no_file_when_invalid(tmp_path, capsys):
    path = tmp_path / "bad.json"
    output = tmp_path / "should-not-exist.json"
    path.write_text('["invalid"]', encoding="utf-8")
    assert run(["--config", str(path), "--output", str(output)]) == 2
    assert not output.exists()


def test_cli_no_network_dependencies():
    import inspect
    import benchmarks.preflight as module
    source = inspect.getsource(module)
    assert "requests." not in source and "httpx." not in source



def test_cli_backend_check_in_standalone_process():
    """The CLI must locate backend/app without pytest's sys.path fixture."""
    import subprocess
    import sys
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    backend = root / "backend"
    if not backend.is_dir():
        pytest.skip("The complete repository backend is absent")
    completed = subprocess.run(
        [sys.executable, str(root / "benchmarks" / "preflight.py"), "--check-backend"],
        cwd=root, capture_output=True, text=True, check=False,
    )
    assert completed.returncode == 0, completed.stderr
    report = json.loads(completed.stdout)
    assert report["backend_contract_status"] == "compatible"
