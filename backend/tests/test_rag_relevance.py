import json
from pathlib import Path

from app.evaluation.rag_eval import RetrievalConfig, load_rag_eval_set, run_config
from app.rag.embedding_retriever import EmbeddingRagRetriever
from app.rag.embeddings import HashEmbeddingBackend
from app.rag.relevance import RagFilter, build_retrieval_query
from app.rag.vector_store import JsonVectorStore

EVAL_SET = Path(__file__).resolve().parents[1] / "eval" / "rag_relevance_set.json"


def test_filter_matches_region_and_species() -> None:
    thorax = RagFilter(region="THORAX", species="canine", modality="XR")
    assert thorax.allows(["THORAX"], [])
    assert not thorax.allows(["BRAIN"], [])
    assert thorax.allows([], [])  # untagged custom docs stay eligible
    assert not thorax.allows(["META"], [])

    cat_brain_ct = RagFilter(region="BRAIN", species="feline", modality="CT")
    assert cat_brain_ct.allows(["SKULL"], ["feline"])
    assert not cat_brain_ct.allows(["SKULL"], ["canine"])


def test_skull_docs_only_for_head_ct_or_radiograph() -> None:
    assert not RagFilter(region="BRAIN", modality="MR").allows(["SKULL"], [])
    assert RagFilter(region="BRAIN", modality="CT").allows(["SKULL"], [])
    # Unknown/other region: no region filter, but skull morphology docs are excluded.
    other = RagFilter(region="OTHER", species="canine", modality="XR")
    assert other.allows(["SPINE_TL"], [])
    assert not other.allows(["SKULL"], [])


def test_cervical_case_sees_spine_but_not_thoracolumbar_only_docs() -> None:
    cervical = RagFilter(region="CERVICAL", modality="MR")
    assert cervical.allows(["SPINE"], [])
    assert not cervical.allows(["SPINE_TL"], [])


def test_clean_query_drops_enum_and_finding_codes() -> None:
    q = build_retrieval_query(
        species="canine",
        modality="XR",
        region="THORAX",
        history="Şikâyet: öksürük.",
        findings=[("Kaudal akciğerde opasite.", "toraks")],
    )
    assert "köpek" in q and "toraks" in q and "öksürük" in q
    assert "THORAX" not in q and "canine" not in q


def test_filtered_retrieval_returns_thorax_doc_for_cough() -> None:
    hits = EmbeddingRagRetriever().retrieve(
        "köpek röntgen radyografi toraks akciğer kronik öksürük kaudal akciğer opasite",
        top_k=4,
        filters=RagFilter(region="THORAX", species="canine", modality="XR"),
    )
    ids = [h.source_id for h in hits]
    thorax_docs = {"kb-8", "kb-11", "kb-12", "kb-13", "kb-14", "kb-15", "kb-16"}
    assert ids and set(ids) <= thorax_docs
    assert "kb-11" in ids  # pulmonary patterns


def test_store_reembeds_all_docs_when_dim_changes(tmp_path: Path) -> None:
    path = tmp_path / "idx.json"
    old = JsonVectorStore(path, backend=HashEmbeddingBackend(dim=64))
    old.load()
    old.add_document(source_id="custom-x", title="Klinik notu", section="Custom", passage="Batın ultrason notu.")
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw.pop("embedding", None)  # index written before the signature field existed
    path.write_text(json.dumps(raw), encoding="utf-8")

    store = JsonVectorStore(path, backend=HashEmbeddingBackend(dim=1024, stem_prefix=5))
    store.load()
    assert all(len(d.vector) == 1024 for d in store.documents)
    assert any(d.source_id == "custom-x" for d in store.documents)
    assert next(d for d in store.documents if d.source_id == "kb-8").regions == ["THORAX"]
    assert json.loads(path.read_text(encoding="utf-8"))["embedding"] == "hash-1024-p5"


def test_production_config_beats_baseline_on_eval_set() -> None:
    cases = load_rag_eval_set(EVAL_SET)
    baseline = run_config(cases, RetrievalConfig("baseline"))
    tuned = run_config(
        cases,
        RetrievalConfig(
            "production",
            case_filter=True,
            dim=2048,
            stem_prefix=5,
            stopwords=True,
            clean_query=True,
            min_cosine=EmbeddingRagRetriever.CASE_MIN_COSINE,
            relative_floor=EmbeddingRagRetriever.CASE_RELATIVE_FLOOR,
        ),
    )
    assert tuned.precision > baseline.precision + 0.3
    assert tuned.hit_rate >= baseline.hit_rate
    assert tuned.abstain_rate == 1.0
