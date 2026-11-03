"""No clinical aliases are shipped: tests use dummy concepts only."""
import pytest
from evaluation.clinical_terminology.catalog import TermCatalog, TermEntry, TermScope
from evaluation.clinical_terminology.resolver import CatalogResolver


def item(name="finding_one", id_="DEMO:1", *, kind="finding", scope=None, reviewed=True, aliases=()):
    data = dict(canonical_id=id_, preferred_label=name, kind=kind, aliases=aliases,
                scope=scope or TermScope())
    if reviewed:
        data.update(review_state="expert_reviewed", reviewed_by="test", source_references=("test-fixture",))
    return TermEntry(**data)


def resolver(*items):
    return CatalogResolver(TermCatalog(catalog_id="dummy", catalog_version="1.2.3", terms=items))


def check(resolver_, text, kind="finding", species="canine", domain="cranium"):
    return resolver_.resolve(text, kind=kind, species=species, domain=domain)


def test_exact_name():
    result = check(resolver(item()), "finding_one")
    assert result.status == "resolved" and result.canonical_id == "DEMO:1"
    assert result.match_kind == "preferred"


def test_alias():
    result = check(resolver(item(aliases=("different label",))), "DIFFERENT   LABEL")
    assert result.status == "resolved" and result.match_kind == "alias"


def test_unknown_stays_unknown():
    result = check(resolver(item()), "unknown")
    assert result.status == "unknown" and result.canonical_id is None


def test_pending_never_equivalent():
    r = resolver(item(reviewed=False, aliases=("alias",)))
    assert check(r, "alias").status == "pending_review"
    assert not r.equivalent("finding_one", "alias", kind="finding", species="canine", domain="cranium")


def test_wrong_kind_rejected():
    assert check(resolver(item(kind="anatomy")), "finding_one").status == "unknown"


def test_species_out_of_scope():
    r = resolver(item(scope=TermScope(species="feline")))
    assert check(r, "finding_one", species="canine").status == "out_of_scope"
    assert check(r, "finding_one", species="feline").status == "resolved"


def test_domain_out_of_scope():
    r = resolver(item(scope=TermScope(domain="cervical")))
    assert check(r, "finding_one", domain="cranium").status == "out_of_scope"


def test_unspecified_species_requires_disambiguation():
    r = resolver(item(id_="DEMO:1", scope=TermScope(species="feline")),
                 item(id_="DEMO:2", scope=TermScope(species="canine")))
    assert check(r, "finding_one", species=None).status == "ambiguous"


def test_unspecified_domain_requires_disambiguation():
    r = resolver(item(id_="DEMO:1", scope=TermScope(domain="brain")),
                 item(id_="DEMO:2", scope=TermScope(domain="cranium")))
    assert check(r, "finding_one", domain=None).status == "ambiguous"


def test_pending_collision_is_ambiguous():
    r = resolver(item(id_="DEMO:1", reviewed=False), item(id_="DEMO:2", reviewed=False))
    assert check(r, "finding_one").status == "ambiguous"


def test_equivalence_only_reviewed_known_alias():
    r = resolver(item(aliases=("equivalent",)))
    assert r.equivalent("finding_one", "equivalent", kind="finding", species="canine", domain="cranium")
    assert not r.equivalent("missing", "missing", kind="finding", species="canine", domain="cranium")


def test_only_safe_metadata_in_output():
    r = resolver(item())
    result = check(r, "patient name and secret")
    assert "patient name" not in repr(result)
    assert result.catalog_version == "1.2.3"


def test_blank_unrecognized():
    assert check(resolver(item()), " ").status == "unknown"


def test_bad_type():
    with pytest.raises(TypeError):
        check(resolver(item()), None)


def test_general_scope_accepts_feline_cranial():
    assert check(resolver(item()), "finding_one", species="feline").status == "resolved"
