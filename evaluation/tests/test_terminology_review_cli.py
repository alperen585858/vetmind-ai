import json
from pathlib import Path
from benchmarks.terminology_review import main, make_report


def fixture(tmp_path):
    source = tmp_path / 'source.json'
    source.write_text(json.dumps({
        'suture_closure_rules_months': {'structures': {'Alpha': {'dogs': [], 'cats': []}}},
        'anatomical_pitfalls': [],
    }), encoding='utf-8')
    catalog = tmp_path / 'catalog.json'
    catalog.write_text(json.dumps({
        'schema_version': '1.0.0', 'catalog_id': 'unit', 'catalog_version': '1.0.0', 'terms': [],
    }), encoding='utf-8')
    return source, catalog


def test_plan_cli_stdout(tmp_path, capsys):
    source, catalog = fixture(tmp_path)
    assert main(['plan', '--source', str(source), '--catalog', str(catalog)]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report['total_candidates'] == 1
    assert report['status'] == 'pending_expert_review'
    assert 'Alpha' not in json.dumps(report)


def test_plan_no_overwrite(tmp_path):
    source, catalog = fixture(tmp_path)
    output = tmp_path / 'plan.json'
    args = ['plan','--source',str(source),'--catalog',str(catalog),'--output',str(output)]
    assert main(args) == 0
    original = output.read_bytes()
    assert main(args) == 2
    assert output.read_bytes() == original


def test_plan_fails_closed_on_stale_queue(tmp_path):
    source, catalog = fixture(tmp_path)
    from evaluation.clinical_terminology.corpus_candidates import read_corpus
    queue = read_corpus(source)
    saved = tmp_path / 'queue.json'
    saved.write_text(queue.model_dump_json())
    source.write_text(source.read_text().replace('Alpha', 'Beta'))
    assert main(['plan','--source',str(source),'--catalog',str(catalog),'--queue',str(saved)]) == 2


def test_submission_empty_is_non_approving(tmp_path, capsys):
    source, catalog = fixture(tmp_path)
    from evaluation.clinical_terminology.corpus_candidates import read_corpus
    q = read_corpus(source)
    submission = tmp_path / 'decisions.json'
    submission.write_text(json.dumps({'source_sha256':q.source_sha256, 'decisions':[]}),encoding='utf-8')
    assert main(['check','--source',str(source),'--catalog',str(catalog),'--submission',str(submission)]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result['expert_approved'] == 0
    assert result['active_catalog_modified'] is False


def test_cli_rejects_malformed_submission_without_leaking(tmp_path,capsys):
    source, catalog = fixture(tmp_path)
    submission=tmp_path/'bad.json'
    submission.write_text('{"name":"PRIVATE NAME"}',encoding='utf-8')
    assert main(['check','--source',str(source),'--catalog',str(catalog),'--submission',str(submission)]) == 2
    out=capsys.readouterr()
    assert 'PRIVATE NAME' not in (out.out + out.err)


def test_live_repo_cli_plan(capsys):
    assert main(['plan']) == 0
    obj=json.loads(capsys.readouterr().out)
    assert obj['total_candidates']==19
    assert obj['clinical_metrics'] is None
