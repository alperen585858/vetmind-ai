import json
import subprocess
import sys
from pathlib import Path
from benchmarks.check_terminology import inspect_catalog, main

BASE = Path(__file__).resolve().parents[2]


def test_empty_catalog_fixture():
    p = BASE / 'knowledge_base' / 'terminology' / 'cranial_catalog.json'
    result = inspect_catalog(p)
    assert result['status'] == 'empty_catalog'
    assert result['clinical_metrics'] is None


def test_invalid_path_reports_no_content(tmp_path, capsys):
    path = tmp_path / 'secret_file.json'
    path.write_text('{"patient_name":"Private Name"}', encoding='utf8')
    assert main(['--catalog', str(path)]) == 2
    output = capsys.readouterr().err
    assert 'Private Name' not in output
    assert 'invalid_catalog' in output


def test_missing_file(tmp_path, capsys):
    assert main(['--catalog', str(tmp_path / 'absent.json')]) == 2
    assert 'not_found' in capsys.readouterr().err


def test_schema_output(capsys):
    assert main(['--schema']) == 0
    obj = json.loads(capsys.readouterr().out)
    assert obj['title'] == 'TermCatalog'


def test_cli_standalone():
    script = BASE / 'benchmarks' / 'check_terminology.py'
    p = BASE / 'knowledge_base' / 'terminology' / 'cranial_catalog.json'
    cp = subprocess.run([sys.executable, str(script), '--catalog', str(p)], cwd=str(BASE), capture_output=True, text=True)
    assert cp.returncode == 0
    assert json.loads(cp.stdout)['status'] == 'empty_catalog'


def test_big_catalog_rejected(tmp_path, capsys):
    p = tmp_path / 'large.json'
    p.write_bytes(b' ' * 2_000_001)
    assert main(['--catalog', str(p)]) == 2
    assert 'invalid_catalog' in capsys.readouterr().err
