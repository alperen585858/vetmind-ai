"""Unlabeled dummy tokens used to exercise pairing mechanics only."""
import pytest
from evaluation.contracts import EvaluationFinding
from evaluation.clinical_terminology.catalog import TermCatalog, TermEntry
from evaluation.clinical_terminology.resolver import CatalogResolver
from evaluation.clinical_terminology.pairing import pair_findings


def vocab(reviewed=True):
    def entry(id_, kind, label, aliases=()):
        kwargs = dict(canonical_id=id_, kind=kind, preferred_label=label, aliases=aliases)
        if reviewed:
            kwargs.update(review_state="expert_reviewed", reviewed_by="test", source_references=("test-fixture",))
        return TermEntry(**kwargs)
    return CatalogResolver(TermCatalog(catalog_id="demo", catalog_version="1.0.0", terms=(
        entry("DEMO:F1", "finding", "finding_a", ("alias_a",)),
        entry("DEMO:L1", "anatomy", "anatomy_a", ("alias_location",)),
    )))


def f(id_, code="finding_a", anatomy="anatomy_a", side="LEFT"):
    return EvaluationFinding(finding_id=id_, finding_code=code, anatomical_location=anatomy, laterality=side)


def run(refs, preds, r=None):
    return pair_findings(refs, preds, r or vocab(), species="canine", domain="cranium")


def test_empty_is_not_evaluated():
    assert run([], []).status == "not_evaluated"


def test_pair_exact():
    result = run([f("r")], [f("p")])
    assert result.status == "structurally_matched"
    assert [(x.reference_id, x.prediction_id) for x in result.matches] == [("r", "p")]
    assert result.clinical_metrics is None


def test_pair_alias():
    assert len(run([f("r")], [f("p", code="alias_a", anatomy="alias_location")]).matches) == 1


def test_no_side_guess():
    result = run([f("r", side="UNKNOWN")], [f("p", side="UNKNOWN")])
    assert not result.matches and result.status == "needs_review"


def test_conflicting_side_not_paired():
    result = run([f("r", side="LEFT")], [f("p", side="RIGHT")])
    assert not result.matches
    assert result.unmatched_prediction_ids == ("p",)


def test_unreviewed_concepts_block_pairing():
    result = run([f("r")], [f("p")], vocab(reviewed=False))
    assert not result.matches
    assert result.unresolved_reference_ids == ("r",)
    assert result.unresolved_prediction_ids == ("p",)


def test_unknown_concept_not_exact_match():
    result = run([f("r", code="unknown")], [f("p", code="unknown")])
    assert not result.matches


def test_unmatched_not_false_positives():
    result = run([f("r")], [])
    assert result.unmatched_reference_ids == ("r",)
    assert result.clinical_metrics is None


def test_one_to_one_deterministic():
    result = run([f("r2"), f("r1")], [f("p2"), f("p1")])
    assert [(x.reference_id, x.prediction_id) for x in result.matches] == [("r1", "p1"), ("r2", "p2")]


def test_extra_prediction_unmatched():
    result = run([f("r")], [f("p1"), f("p2")])
    assert len(result.matches) == 1 and result.unmatched_prediction_ids == ("p2",)


def test_duplicate_reference_id_error():
    with pytest.raises(ValueError):
        run([f("dup"), f("dup")], [])


def test_duplicate_prediction_id_error():
    with pytest.raises(ValueError):
        run([], [f("dup"), f("dup")])


def test_anatomical_mismatch():
    assert not run([f("r")], [f("p", anatomy="other")]).matches


def test_patient_text_not_in_results():
    result = run([f("ref", code="sensitive unknown string")], [])
    assert "sensitive unknown string" not in repr(result)
