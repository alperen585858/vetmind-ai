"""Software/parser fixtures only; NO invented clinical cases or reference labels."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from evaluation.clinical_terminology.catalog import TermCatalog
from evaluation.clinical_terminology.corpus_candidates import (
    MAX_SOURCE_BYTES, CorpusCandidate, CorpusReviewQueue, extract_candidates,
    pending_catalog, read_corpus,
)
from evaluation.clinical_terminology.resolver import CatalogResolver


def fixture_doc() -> dict:
    return {
        "metadata": {"description": "Ignore this free text / patient details"},
        "suture_closure_rules_months": {"structures": {
            "Alpha structure": {"dogs": [1, 2], "cats": None},
            "Beta structure (variant / example)": {"dogs": [], "cats": [2, 3]},
            "Gamma structure & another": {"dogs": [2, 5], "cats": [2, 5]},
        }},
        "anatomical_pitfalls": [
            {"id": "pitfall_1", "structure": "Epsilon structure", "description": "Ignore private patient data"},
            {"id": "pitfall_2", "structure": "Delta structure", "resolution": "Unverified advice"},
        ],
    }


def encoded(doc: dict | list) -> bytes:
    return json.dumps(doc, ensure_ascii=False, sort_keys=True).encode("utf-8")


def queue():
    return extract_candidates(encoded(fixture_doc()))


def test_source_candidate_count():
    assert len(queue().candidates) == 5
    assert queue().counts["suture_schedule"] == 3
    assert queue().counts["anatomical_pitfall"] == 2


def test_source_never_exposes_raw_description():
    dump = queue().model_dump_json()
    assert "patient details" not in dump
    assert "private patient" not in dump
    assert "Unverified advice" not in dump


def test_source_candidates_are_always_pending():
    for entry in queue().candidates:
        assert entry.review_state == "pending"
        assert entry.eligible_for_clinical_matching is False


def test_stable_ids_and_source_digest():
    assert queue() == queue()
    assert queue().source_sha256 != extract_candidates(encoded({**fixture_doc(), "extra": "changed"})).source_sha256


def test_json_pointers_escape_slashes_and_tildes():
    doc = fixture_doc()
    doc["suture_closure_rules_months"]["structures"]["Alpha / ~ structure"] = {"dogs": [], "cats": None}
    items = extract_candidates(encoded(doc)).candidates
    found = next(x for x in items if x.preferred_label_as_written == "Alpha / ~ structure")
    assert "~1" in found.source_pointer
    assert "~0" in found.source_pointer


def test_qualified_and_composite_not_promoted_to_catalog():
    draft = pending_catalog(queue())
    assert [item.preferred_label for item in draft.terms] == ["Alpha structure"]
    assert draft.terms[0].aliases == ()
    assert draft.terms[0].review_state == "pending"
    assert draft.terms[0].scope.species == "canine"


def test_draft_source_references_are_pointers():
    ref, = pending_catalog(queue()).terms[0].source_references
    assert "#/suture_closure_rules_months/structures/" in ref
    assert "Alpha structure" in ref


def test_pending_is_not_resolvable_as_clinically_verified():
    draft = pending_catalog(queue())
    result = CatalogResolver(draft).resolve("Alpha structure", kind="anatomy", species="canine", domain="cranium")
    assert result.status == "pending_review"
    assert result.usable_for_clinical_equivalence is False


def test_real_repo_static_corpus_integrity():
    project_root = Path(__file__).resolve().parents[2]
    actual = project_root / "backend/app/rag/corpus/breed_morphotypes.json"
    result = read_corpus(actual)
    assert result.counts["suture_schedule"] == 12
    assert result.counts["anatomical_pitfall"] == 7
    assert result.clinical_validation == "not_evaluated"
    assert len(pending_catalog(result).terms) > 0
    assert pending_catalog(result).reviewed_count == 0


def test_real_repo_has_no_auto_aliases_or_reviewers():
    source = Path(__file__).resolve().parents[2] / "backend/app/rag/corpus/breed_morphotypes.json"
    entries = pending_catalog(read_corpus(source)).terms
    assert all(not entry.aliases and entry.reviewed_by is None for entry in entries)


def test_schema_roundtrip():
    q = queue()
    assert CorpusReviewQueue.model_validate_json(q.model_dump_json()) == q
    catalog = pending_catalog(q)
    assert TermCatalog.model_validate_json(catalog.model_dump_json()) == catalog


# Explicit ids: pytest puts the test id in an env var, and the oversized payload as an id
# exceeds Windows' 32767-character env var limit.
@pytest.mark.parametrize(
    "invalid",
    [b"", b"not json", b"[]", b"{}", b" " * (MAX_SOURCE_BYTES + 1)],
    ids=["empty", "not-json", "list", "empty-object", "oversized"],
)
def test_invalid_document_rejected(invalid):
    with pytest.raises(ValueError):
        extract_candidates(invalid)


@pytest.mark.parametrize("deleted", ["suture_closure_rules_months", "anatomical_pitfalls"])
def test_missing_required_section_rejected(deleted):
    doc = fixture_doc()
    del doc[deleted]
    with pytest.raises(ValueError):
        extract_candidates(encoded(doc))


def test_malformed_suture_record_rejected():
    doc = fixture_doc()
    doc["suture_closure_rules_months"]["structures"]["Alpha structure"] = "unstructured"
    with pytest.raises(ValueError):
        extract_candidates(encoded(doc))


def test_missing_species_field_rejected():
    doc = fixture_doc()
    del doc["suture_closure_rules_months"]["structures"]["Alpha structure"]["dogs"]
    with pytest.raises(ValueError):
        extract_candidates(encoded(doc))


def test_invalid_species_field_rejected():
    doc = fixture_doc()
    doc["suture_closure_rules_months"]["structures"]["Alpha structure"]["dogs"] = "canine"
    with pytest.raises(ValueError):
        extract_candidates(encoded(doc))


def test_invalid_pitfall_rejected():
    doc = fixture_doc()
    doc["anatomical_pitfalls"] = ["plain string"]
    with pytest.raises(ValueError):
        extract_candidates(encoded(doc))


def test_invalid_label_rejected():
    doc = fixture_doc()
    doc["anatomical_pitfalls"][0]["structure"] = "!!!"
    with pytest.raises(ValidationError):
        extract_candidates(encoded(doc))


def test_missing_file_rejected(tmp_path):
    with pytest.raises(ValueError):
        read_corpus(tmp_path / "missing.json")


def test_symlink_source_rejected(tmp_path):
    original = tmp_path / "original.json"
    original.write_bytes(encoded(fixture_doc()))
    alias = tmp_path / "alias.json"
    try:
        alias.symlink_to(original)
    except OSError:
        pytest.skip("symlinks unavailable on this host")
    with pytest.raises(ValueError):
        read_corpus(alias)


def test_source_size_rejected(tmp_path):
    path = tmp_path / "huge.json"
    path.write_bytes(b" " * (MAX_SOURCE_BYTES + 1))
    with pytest.raises(ValueError):
        read_corpus(path)


def test_duplicate_source_surfaces_are_flagged_but_not_combined():
    doc = fixture_doc()
    doc["anatomical_pitfalls"][0]["structure"] = "Alpha structure"
    q = extract_candidates(encoded(doc))
    alpha = [c for c in q.candidates if c.preferred_label_as_written == "Alpha structure"]
    assert len(alpha) == 2
    assert all("duplicate_surface" in c.flags for c in alpha)
    assert all(c.review_state == "pending" for c in alpha)


def test_candidate_contract_rejects_unreviewed_activation():
    item = queue().candidates[0]
    with pytest.raises(ValidationError):
        CorpusCandidate.model_validate({**item.model_dump(), "eligible_for_clinical_matching": True})


def test_cannot_claim_expert_reviewed_queue():
    q = queue()
    with pytest.raises(ValidationError):
        CorpusReviewQueue.model_validate({**q.model_dump(), "review_state": "expert_reviewed"})
