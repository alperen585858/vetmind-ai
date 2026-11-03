"""Clinical Terminology final: deliberately fictional software labels, no clinical examples."""
import json
from pathlib import Path

from evaluation.clinical_terminology.catalog import TermCatalog, TermEntry
from evaluation.clinical_terminology.corpus_candidates import extract_candidates
from evaluation.clinical_terminology.review_plan import build_review_plan


def source_document():
    return {
        "suture_closure_rules_months": {"structures": {
            "Sample A": {"dogs": [1], "cats": []},
            "Sample B & C": {"dogs": [1], "cats": None},
            "Sample D": {"dogs": [], "cats": None},
        }},
        "anatomical_pitfalls": [
            {"structure": "Sample A"}, {"structure": "Sample unknown"},
        ],
    }


def queue():
    return extract_candidates(json.dumps(source_document()).encode())


def catalog(*entries):
    return TermCatalog(catalog_id="demo", catalog_version="1.0.0", terms=entries)


def entry(label):
    return TermEntry(canonical_id="DEMO:A", preferred_label=label, kind="anatomy")


def test_triage_counts():
    report = build_review_plan(queue(), catalog())
    assert report.total_candidates == 5
    assert report.counts == {
        "requires_segmentation": 1, "duplicate_in_queue": 2,
        "overlaps_active_catalog": 0, "pending_catalog_candidate": 1,
        "requires_manual_review": 1,
    }
    assert report.clinical_metrics is None


def test_active_catalog_overlap_is_detected():
    report = build_review_plan(queue(), catalog(entry("Sample D")))
    assert report.counts["overlaps_active_catalog"] == 1
    assert report.counts["pending_catalog_candidate"] == 0


def test_no_term_labels_in_review_plan():
    report = build_review_plan(queue(), catalog())
    assert "Sample A" not in str(report)
    assert "Sample unknown" not in str(report)
    assert all(item.candidate_id.startswith("SRC_") for item in report.items)


def test_determinism_and_immutability():
    q = queue()
    first = build_review_plan(q, catalog())
    assert first == build_review_plan(q, catalog())
    assert first.source_sha256 == q.source_sha256
    assert first.clinical_validation == "not_evaluated"


def test_real_repository_corpus():
    root = Path(__file__).resolve().parents[2]
    from evaluation.clinical_terminology.corpus_candidates import read_corpus
    q = read_corpus(root / "backend/app/rag/corpus/breed_morphotypes.json")
    term_catalog = TermCatalog.model_validate_json((root / "knowledge_base/terminology/cranial_catalog.json").read_bytes())
    report = build_review_plan(q, term_catalog)
    assert report.total_candidates == 19
    assert sum(report.counts.values()) == 19
    assert term_catalog.reviewed_count == 0
