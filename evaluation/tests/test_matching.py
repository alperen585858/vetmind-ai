import pytest
from evaluation.contracts import EvaluationFinding
from evaluation.terminology import Terminology, normalize_token
from evaluation.matching import match_findings


def finding(identifier='f', code='fracture', location='skull', side='LEFT', confidence=None):
    return EvaluationFinding(finding_id=identifier, finding_code=code,
                             anatomical_location=location, laterality=side,
                             confidence=confidence)


def test_unicode_normalization():
    assert normalize_token('  KAFATASI   Kırığı ') == 'kafatasi kırıgı'


def test_conservative_unknown():
    vocab = Terminology('1.0', {'fracture': ['kırık']})
    assert vocab.resolve('kırık').canonical == 'fracture'
    assert vocab.resolve('tumour').canonical is None
    assert not vocab.equivalent('tumour', 'cancer')


def test_alias_collision():
    with pytest.raises(ValueError):
        Terminology('1', {'a':['x'], 'b':['x']})


def test_matches_aliases():
    vocab = Terminology('1.0', {'fracture': ['kırık']})
    result = match_findings([finding()], [finding('p', 'kırık')], code_vocabulary=vocab)
    assert len(result.matches) == 1


def test_laterality_mismatch():
    result = match_findings([finding()], [finding('p', side='RIGHT')])
    assert result.unmatched_references == ('f',)
    assert result.unmatched_predictions == ('p',)


def test_unknown_laterality_not_wildcard():
    assert not match_findings([finding()], [finding('p', side='UNKNOWN')]).matches


def test_one_to_one():
    result = match_findings([finding()], [finding('p1'), finding('p2')])
    assert len(result.matches) == 1
    assert len(result.unmatched_predictions) == 1


def test_threshold_excludes_but_missing_confidence_not_assumed_low():
    result = match_findings([finding()], [finding('p', confidence=.1)], minimum_confidence=.5)
    assert result.excluded_predictions == ('p',)
    assert result.unmatched_predictions == ()


def test_duplicate_rejected():
    with pytest.raises(ValueError):
        match_findings([finding(), finding()], [])


def test_invalid_threshold():
    with pytest.raises(ValueError):
        match_findings([], [], minimum_confidence=1.1)
