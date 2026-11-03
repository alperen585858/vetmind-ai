import csv
import json
import pytest
from evaluation.reports.export import export_json, export_csv, export_markdown


def test_json_round_trip(tmp_path):
    p = export_json(tmp_path/'nested'/'report.json', {'a':'ş','z':2})
    assert json.loads(p.read_text(encoding='utf-8')) == {'a':'ş','z':2}


def test_csv_round_trip(tmp_path):
    p = export_csv(tmp_path/'test.csv',[{'name':'A, B', 'value':3}],['name','value'])
    with p.open(encoding='utf-8', newline='') as f:
        assert list(csv.DictReader(f)) == [{'name':'A, B', 'value':'3'}]


def test_csv_unknown_column_rejected(tmp_path):
    with pytest.raises(ValueError):
        export_csv(tmp_path/'x.csv',[{'other':4}],['name'])


def test_markdown(tmp_path):
    p = export_markdown(tmp_path/'result.md', title='VetMind', sections={'Status':'not_evaluated'})
    assert 'not_evaluated' in p.read_text(encoding='utf-8')


def test_json_nan_rejected(tmp_path):
    with pytest.raises(ValueError):
        export_json(tmp_path/'x.json',{'value':float('nan')})
