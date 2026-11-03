import json
import pytest
from pydantic import ValidationError
from evaluation.clinical_terminology.corpus_candidates import extract_candidates
from evaluation.clinical_terminology.review_decisions import (
    ReviewSubmission, ReviewDecision, validate_review_submission,
)


def queue():
    doc = {"suture_closure_rules_months": {"structures": {
        "Alpha": {"dogs": [], "cats": []}, "Beta": {"dogs": [], "cats": None},
    }}, "anatomical_pitfalls": []}
    return extract_candidates(json.dumps(doc).encode())


def submission(q, decisions=()):
    return ReviewSubmission(source_sha256=q.source_sha256, decisions=decisions)


def decision(candidate_id, action="defer", reason="needs_primary_source"):
    return ReviewDecision(candidate_id=candidate_id, action=action, reason=reason)


def test_empty_decisions_do_not_approve():
    q = queue()
    result = validate_review_submission(q, submission(q))
    assert result.outstanding == 2
    assert result.expert_approved == 0
    assert not result.active_catalog_modified


def test_decision_count_is_read_only():
    q = queue()
    ds = [decision(q.candidates[0].candidate_id, "propose_for_expert_review", "review_requested"),
          decision(q.candidates[1].candidate_id, "exclude", "not_relevant")]
    result = validate_review_submission(q, submission(q, ds))
    assert result.proposed_for_expert_review == 1
    assert result.excluded == 1
    assert result.outstanding == 0
    assert result.clinical_metrics is None


def test_reject_stale_digest():
    q = queue()
    with pytest.raises(ValueError, match="stale_source_digest"):
        validate_review_submission(q, ReviewSubmission(source_sha256="0" * 64, decisions=()))


def test_reject_unknown_candidate():
    q = queue()
    with pytest.raises(ValueError, match="unknown_candidate_id"):
        validate_review_submission(q, submission(q, [decision("SRC_" + "f" * 20)]))


def test_reject_duplicate_decision():
    q = queue()
    d = decision(q.candidates[0].candidate_id)
    with pytest.raises(ValidationError):
        submission(q, [d, d])


def test_reject_free_text_and_fake_approval():
    q = queue()
    with pytest.raises(ValidationError):
        ReviewDecision(candidate_id=q.candidates[0].candidate_id, action="expert_approved", reason="review_requested")
    with pytest.raises(ValidationError):
        ReviewDecision(candidate_id=q.candidates[0].candidate_id, action="defer", reason="review_requested", patient_name="PRIVATE")


@pytest.mark.parametrize("code", ["not_relevant", "needs_primary_source", "possible_duplicate", "scope_uncertain", "review_requested", "composite_or_qualified_label"])
def test_review_reasons_are_controlled(code):
    q = queue()
    assert decision(q.candidates[0].candidate_id, reason=code).reason == code
