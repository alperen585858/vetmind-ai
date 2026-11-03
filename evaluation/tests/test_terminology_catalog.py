"""Clinical Terminology catalogs: contracts and review gates, using NON-clinical dummy tokens."""
import pytest
from pydantic import ValidationError
from evaluation.clinical_terminology.catalog import TermCatalog, TermEntry, TermScope


def term(**kwargs):
    data = dict(canonical_id="DEMO:1", kind="finding", preferred_label="term_alpha")
    data.update(kwargs)
    return TermEntry(**data)


def catalog(*entries):
    return TermCatalog(catalog_id="demo", catalog_version="1.0.0", terms=entries)


def test_empty_catalog():
    obj = catalog()
    assert obj.reviewed_count == 0
    assert obj.terms == ()


def test_pending_default():
    assert term().review_state == "pending"


def test_reviewed_requires_both_reviewer_and_source():
    with pytest.raises(ValidationError):
        term(review_state="expert_reviewed")
    with pytest.raises(ValidationError):
        term(review_state="expert_reviewed", reviewed_by="vet")
    with pytest.raises(ValidationError):
        term(review_state="expert_reviewed", source_references=("ref",))


def test_reviewed_with_provenance():
    assert term(review_state="expert_reviewed", reviewed_by="reviewer", source_references=("paper:id",)).review_state == "expert_reviewed"


def test_pending_must_not_claim_reviewer():
    with pytest.raises(ValidationError):
        term(reviewed_by="unknown")


@pytest.mark.parametrize("id_", ["", "  ", "9bad", "has a space", "DROP/THIS"])
def test_bad_identifier(id_):
    with pytest.raises(ValidationError):
        term(canonical_id=id_)


@pytest.mark.parametrize("version", ["1", "x.2.3", "01.a.3", "", "1.2.3.4"])
def test_invalid_semver(version):
    with pytest.raises(ValidationError):
        TermCatalog(catalog_id="demo", catalog_version=version)


def test_duplicate_ids_invalid():
    with pytest.raises(ValidationError):
        catalog(term(), term(preferred_label="other"))


def test_synonym_collision_same_entry_invalid():
    with pytest.raises(ValidationError):
        term(aliases=("TERM_ALPHA",))


def test_unicode_normalized_duplicate_invalid():
    with pytest.raises(ValidationError):
        term(aliases=("Term   Alpha", "term_alpha"))


def test_empty_alias_after_normalization():
    with pytest.raises(ValidationError):
        term(aliases=("!!!",))


def test_blank_reference():
    with pytest.raises(ValidationError):
        term(source_references=(" ",))


def test_reviewed_alias_collision_overlapping_scope():
    a = term(review_state="expert_reviewed", reviewed_by="reviewer", source_references=("ref",), aliases=("same_alias",))
    b = term(canonical_id="DEMO:2", preferred_label="term_beta", review_state="expert_reviewed", reviewed_by="reviewer", source_references=("ref2",), aliases=("SAME_ALIAS",))
    with pytest.raises(ValidationError):
        catalog(a, b)


def test_pending_collision_allowed_for_manual_resolution():
    a, b = term(), term(canonical_id="DEMO:2", preferred_label="term_alpha")
    assert len(catalog(a, b).terms) == 2


def test_disjoint_species_scopes_can_share_label():
    a = term(review_state="expert_reviewed", reviewed_by="a", source_references=("ref",), scope=TermScope(species="canine"))
    b = term(canonical_id="DEMO:2", review_state="expert_reviewed", reviewed_by="b", source_references=("ref",), scope=TermScope(species="feline"))
    assert len(catalog(a, b).terms) == 2


def test_disjoint_domain_scopes_can_share_label():
    a = term(review_state="expert_reviewed", reviewed_by="a", source_references=("ref",), scope=TermScope(domain="cranium"))
    b = term(canonical_id="DEMO:2", review_state="expert_reviewed", reviewed_by="b", source_references=("ref",), scope=TermScope(domain="cervical"))
    assert len(catalog(a, b).terms) == 2


def test_general_scope_overlaps():
    assert TermScope().overlaps(TermScope(species="feline", domain="brain"))
    assert not TermScope(species="canine").overlaps(TermScope(species="feline"))
    assert not TermScope(domain="brain").overlaps(TermScope(domain="cervical"))


def test_model_immutable():
    item = term()
    with pytest.raises(ValidationError):
        item.preferred_label = "replacement"


def test_extra_fields_forbidden():
    with pytest.raises(ValidationError):
        term(confidence=0.99)


def test_catalog_roundtrip():
    first = catalog(term(aliases=("other name",)))
    assert TermCatalog.model_validate_json(first.model_dump_json()) == first
