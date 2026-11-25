"""ChromaDB vector store (#103): same behaviour as the JSON store, stored in Chroma."""

from __future__ import annotations

import itertools
import threading
from pathlib import Path

import pytest

pytest.importorskip("chromadb")

from app.rag.chroma_store import ChromaVectorStore, chroma_where  # noqa: E402
from app.rag.chunking import split_passage  # noqa: E402
from app.rag.embedding_retriever import EmbeddingRagRetriever  # noqa: E402
from app.rag.embeddings import HashEmbeddingBackend  # noqa: E402
from app.rag.relevance import RagFilter  # noqa: E402
from app.rag.stores import build_vector_store  # noqa: E402
from app.rag.vector_store import JsonVectorStore  # noqa: E402
from app.settings import Settings  # noqa: E402
from tests.test_rag_chunking import LONG_TEXT  # noqa: E402

THORAX_DOG = RagFilter(region="THORAX", species="canine", modality="XR")


def _add_long(store, source_id: str = "custom-long") -> None:
    store.add_document(
        source_id=source_id, title="Toraks radyografisi notları", section="Klinik",
        passage=LONG_TEXT, regions=["THORAX"], species=["canine"], summary="Toraks", tag_source="manual",
    )


# --- filter --------------------------------------------------------------------------------

REGION_SETS = [(), ("BRAIN",), ("SKULL",), ("BRAIN", "SKULL"), ("CERVICAL",), ("SPINE",), ("SPINE_TL",),
               ("THORAX",), ("META",), ("THORAX", "SPINE")]
SPECIES_SETS = [(), ("canine",), ("feline",), ("canine", "feline")]
FILTERS = [RagFilter()] + [
    RagFilter(region=r, species=s, modality=m)
    for r, s, m in itertools.product(
        [None, "BRAIN", "CERVICAL", "THORAX", "THORACOLUMBAR", "OTHER"],
        [None, "canine", "feline", "other"],
        [None, "MR", "CT"],
    )
]


def test_where_clause_matches_python_filter_for_every_tag_combination():
    store = ChromaVectorStore(backend=HashEmbeddingBackend(dim=16))
    combos = list(itertools.product(REGION_SETS, SPECIES_SETS))
    for i, (regions, species) in enumerate(combos):
        store.add_document(
            source_id=f"custom-{i}", title=f"doc {i}", section="s", passage=f"pasaj {i} beyin toraks",
            regions=list(regions), species=list(species), persist=False,
        )
    store.save()
    qv = store.backend.embed("pasaj")
    for f in FILTERS:
        expected = {f"custom-{i}" for i, (r, s) in enumerate(combos) if f.allows(r, s)}
        got = {d.source_id for _, d in store.search(qv, filters=f, limit=1000)}
        assert got == expected, (f, chroma_where(f))


def test_no_filter_returns_everything():
    assert chroma_where(None) is None


# --- storage -------------------------------------------------------------------------------


def test_documents_survive_a_restart_in_order(tmp_path: Path):
    path = tmp_path / "chroma"
    store = ChromaVectorStore(path=path)
    store.load()
    seed_ids = [d.source_id for d in store.documents]
    _add_long(store)
    first = [(d.source_id, d.passage, d.regions) for d in store.documents]

    again = ChromaVectorStore(path=path)
    again.load()
    assert [(d.source_id, d.passage, d.regions) for d in again.documents] == first
    assert [d.source_id for d in again.documents][: len(seed_ids)] == seed_ids
    assert again.count() == len(first)


def test_card_update_and_replacement_reach_chroma(tmp_path: Path):
    path = tmp_path / "chroma"
    store = ChromaVectorStore(path=path)
    store.load()
    _add_long(store)
    chunks = len(split_passage(LONG_TEXT))
    assert chunks > 1
    store.set_card("custom-long", regions=["THORAX"], species=["feline"], summary="Kedi", tag_source="manual")

    again = ChromaVectorStore(path=path)
    again.load()
    assert {tuple(c.species) for c in again.source_chunks("custom-long")} == {("feline",)}
    # The card is in the where clause too: a dog case no longer sees the cat-only source.
    hits = again.search(again.backend.embed("trakeal kollaps"), filters=THORAX_DOG)
    assert not [d for _, d in hits if d.source_key == "custom-long"]

    again.add_document(source_id="custom-long", title="Kısa", section="s", passage="Tek parça kaldı.")
    third = ChromaVectorStore(path=path)
    third.load()
    assert [c.source_id for c in third.source_chunks("custom-long")] == ["custom-long"]
    assert third.count() == len(third.documents)


def test_per_source_chunk_cap_holds_with_chroma():
    store = ChromaVectorStore()
    store.reindex_seed()
    _add_long(store)
    retriever = EmbeddingRagRetriever(store=store, min_cosine=-1.0, relative_floor=0.0)
    hits = retriever.retrieve("trakeal kollaps kaz ötüşü öksürük floroskopi", top_k=8, filters=THORAX_DOG)
    long_hits = [h for h in hits if h.source_id.startswith("custom-long")]
    assert long_hits and "Trakeal kollaps" in long_hits[0].passage
    assert len(long_hits) <= EmbeddingRagRetriever.MAX_CHUNKS_PER_SOURCE


@pytest.mark.parametrize(
    "query,filters",
    [
        ("plevral efüzyon akciğer", THORAX_DOG),
        ("servikal disk herniasyonu boyun ağrısı", RagFilter(region="CERVICAL", species="canine", modality="MR")),
        ("nöbet beyin kitlesi", RagFilter(region="BRAIN", species="feline", modality="MR")),
        ("karın ağrısı", RagFilter(region="OTHER", species="canine", modality="CT")),
        ("beyin", None),
    ],
)
def test_chroma_and_json_return_the_same_hits(query, filters):
    stores = [JsonVectorStore(path=None), ChromaVectorStore()]
    results = []
    for store in stores:
        store.reindex_seed(persist=isinstance(store, ChromaVectorStore))
        _add_long(store)
        hits = EmbeddingRagRetriever(store=store).retrieve(query, top_k=5, filters=filters)
        results.append([(h.source_id, h.score) for h in hits])
    assert results[0] == results[1]


def test_old_json_index_is_copied_in_once(tmp_path: Path):
    json_path = tmp_path / "rag_index.json"
    old = JsonVectorStore(path=json_path)
    old.load()
    _add_long(old)
    expected = [(d.source_id, d.passage) for d in old.documents]

    store = ChromaVectorStore(path=tmp_path / "chroma", legacy_json=json_path)
    store.load()
    assert store.migrated_from == json_path
    assert [(d.source_id, d.passage) for d in store.documents] == expected

    again = ChromaVectorStore(path=tmp_path / "chroma", legacy_json=json_path)
    again.load()
    assert again.migrated_from is None  # read from Chroma, not the file
    assert again.count() == len(expected)


def test_embedding_change_reembeds_everything(tmp_path: Path):
    path = tmp_path / "chroma"
    store = ChromaVectorStore(path=path, backend=HashEmbeddingBackend(dim=64))
    store.load()
    _add_long(store)
    bigger = ChromaVectorStore(path=path, backend=HashEmbeddingBackend(dim=128))
    bigger.load()
    assert all(len(d.vector) == 128 for d in bigger.documents)
    assert bigger.source_chunks("custom-long")
    reread = ChromaVectorStore(path=path, backend=HashEmbeddingBackend(dim=128))
    reread.load()
    assert all(len(d.vector) == 128 for d in reread.documents)


def test_concurrent_uploads_all_land(tmp_path: Path):
    path = tmp_path / "chroma"
    store = ChromaVectorStore(path=path)
    store.load()

    def upload(i: int) -> None:
        store.add_document(source_id=f"custom-t{i}", title=f"Kaynak {i}", section="s", passage=f"Metin {i}. " * 5)

    threads = [threading.Thread(target=upload, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    again = ChromaVectorStore(path=path)
    again.load()
    assert {f"custom-t{i}" for i in range(8)} <= {d.source_id for d in again.documents}


def test_settings_pick_the_store(tmp_path: Path):
    base = dict(storage_backend="sqlite", sqlite_path=tmp_path / "x.sqlite3", quarantine_root=tmp_path / "q",
                rag_index_path=tmp_path / "rag.json", chroma_path=tmp_path / "chroma")
    backend = HashEmbeddingBackend(dim=16)
    assert isinstance(build_vector_store(Settings(**base), backend), ChromaVectorStore)
    assert isinstance(build_vector_store(Settings(**base, rag_store="json"), backend), JsonVectorStore)
    mem = build_vector_store(Settings(**base), backend, in_memory=True)
    assert isinstance(mem, JsonVectorStore) and mem.path is None
