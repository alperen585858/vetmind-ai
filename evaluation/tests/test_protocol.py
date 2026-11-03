import pytest
from evaluation.protocol import CountResult, count_verified_matches, summarize_counts


def test_no_tn_fabrication():
    c = count_verified_matches(matched=2, unmatched_predictions=1, unmatched_references=1)
    assert c.true_negative is None
    assert summarize_counts(c, expert_verified=True).specificity is None


def test_no_clinical_metrics_without_expert_reference():
    c = count_verified_matches(matched=8, unmatched_predictions=1, unmatched_references=2)
    s = summarize_counts(c, expert_verified=False)
    assert s.status == 'not_evaluated'
    assert s.f1 is None


def test_counts_and_ratios():
    c = count_verified_matches(matched=2, unmatched_predictions=1,
                               unmatched_references=1, verified_negative_opportunities=4)
    s = summarize_counts(c, expert_verified=True)
    assert s.sensitivity == pytest.approx(2/3)
    assert s.precision == pytest.approx(2/3)
    assert s.specificity == pytest.approx(4/5)
    assert s.f1 == pytest.approx(2/3)


def test_zero_denominator_is_none_not_zero():
    c = count_verified_matches(matched=0, unmatched_predictions=0, unmatched_references=0)
    s = summarize_counts(c, expert_verified=True)
    assert s.f1 is None
    assert s.sensitivity is None


@pytest.mark.parametrize('input_name', ['matched', 'unmatched_predictions', 'unmatched_references'])
def test_negative_invalid(input_name):
    args = dict(matched=0, unmatched_predictions=0, unmatched_references=0)
    args[input_name] = -1
    with pytest.raises(ValueError):
        count_verified_matches(**args)


def test_bad_status_inconsistent():
    with pytest.raises(ValueError):
        CountResult(0,0,0,None,'ready')
