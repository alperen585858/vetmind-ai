"""RAG vectors in PostgreSQL with pgvector (#117).

Store tests run when VETMIND_TEST_DATABASE_URL points at a PostgreSQL with the pgvector
extension (the CI postgres job); the store-selection tests always run.
"""

from __future__ import annotations

import itertools
import os
from pathlib import Path

import pytest

from app.rag.chunking import split_passage
from app.rag.embedding_retriever import EmbeddingRagRetriever
from app.rag.embeddings import HashEmbeddingBackend
from app.rag.pgvector_store import PgVectorStore, sql_filter, vector_literal
from app.rag.relevance import RagFilter
from app.rag.stores import build_vector_store, resolve_rag_store
from app.rag.vector_store import JsonVectorStore
from app.settings import Settings
from tests.test_rag_chunking import LONG_TEXT

PG_URL = os.getenv("VETMIND_TEST_DATABASE_URL")
THORAX_DOG = RagFilter(region="THORAX", species="canine", modality="XR")

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


def _add_long(store, source_id: str = "custom-long") -> None:
    store.add_document(
        source_id=source_id, title="Toraks radyografisi notları", section="Klinik",
        passage=LONG_TEXT, regions=["THORAX"], species=["canine"], summary="Toraks", tag_source="manual",
    )


# --- store selection (no database needed) --------------------------------------------------


def _settings(tmp_path: Path, **kw) -> Settings:
    return Settings(storage_backend=kw.pop("storage_backend", "sqlite"), sqlite_path=tmp_path / "x.sqlite3",
                    quarantine_root=tmp_path / "q", rag_index_path=tmp_path / "rag.json", **kw)


def test_auto_store_is_pgvector_on_postgres_and_json_otherwise(tmp_path: Path):
    assert resolve_rag_store(_settings(tmp_path)) == "json"
    pg = _settings(tmp_path, storage_backend="postgres", database_url="postgresql://u:p@db/x")
    assert resolve_rag_store(pg) == "pgvector"
    assert resolve_rag_store(_settings(tmp_path, rag_store="chroma")) == "chroma"
    assert isinstance(build_vector_store(_settings(tmp_path), HashEmbeddingBackend(dim=16)), JsonVectorStore)


def test_pgvector_without_postgres_is_a_clear_error(tmp_path: Path):
    with pytest.raises(RuntimeError, match="needs PostgreSQL"):
        build_vector_store(_settings(tmp_path, rag_store="pgvector"), HashEmbeddingBackend(dim=16))


def test_sql_filter_and_vector_literal():
    assert sql_filter(None) == ("TRUE", [])
    where, params = sql_filter(THORAX_DOG)
    assert "META" in where and "SKULL" in where and params == ["canine", ["THORAX"]]
    assert vector_literal([1, 0.5, -2]) == "[1.0,0.5,-2.0]"


# --- the store on PostgreSQL ---------------------------------------------------------------


@pytest.fixture
def pg_url() -> str:
    if not PG_URL:
        pytest.skip("Set VETMIND_TEST_DATABASE_URL (PostgreSQL with pgvector) to run the pgvector store tests.")
    from app.storage import sql
    from tests.test_sql_stores import _reset_postgres

    _reset_postgres(PG_URL)
    sql._migrated.discard(sql.Database(PG_URL).url)  # schema was dropped: migrate again
    return PG_URL


@pytest.mark.postgres
def test_sql_filter_matches_python_filter_for_every_tag_combination(pg_url: str):
    store = PgVectorStore(pg_url, HashEmbeddingBackend(dim=16))
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
        assert got == expected, (f, sql_filter(f))


@pytest.mark.postgres
def test_documents_survive_a_restart_in_order(pg_url: str):
    store = PgVectorStore(pg_url)
    store.load()
    seed_ids = [d.source_id for d in store.documents]
    _add_long(store)
    first = [(d.source_id, d.passage, d.regions) for d in store.documents]

    again = PgVectorStore(pg_url)
    again.load()
    assert [(d.source_id, d.passage, d.regions) for d in again.documents] == first
    assert [d.source_id for d in again.documents][: len(seed_ids)] == seed_ids
    assert again.count() == len(first)
    assert again.kind == "pgvector"


@pytest.mark.postgres
def test_card_update_and_replacement_reach_the_table(pg_url: str):
    store = PgVectorStore(pg_url)
    store.load()
    _add_long(store)
    assert len(split_passage(LONG_TEXT)) > 1
    store.set_card("custom-long", regions=["THORAX"], species=["feline"], summary="Kedi", tag_source="manual")

    again = PgVectorStore(pg_url)
    again.load()
    assert {tuple(c.species) for c in again.source_chunks("custom-long")} == {("feline",)}
    # The card is in the SQL filter too: a dog case no longer sees the cat-only source.
    hits = again.search(again.backend.embed("trakeal kollaps"), filters=THORAX_DOG)
    assert not [d for _, d in hits if d.source_key == "custom-long"]

    again.add_document(source_id="custom-long", title="Kısa", section="s", passage="Tek parça kaldı.")
    third = PgVectorStore(pg_url)
    third.load()
    assert [c.source_id for c in third.source_chunks("custom-long")] == ["custom-long"]
    assert third.count() == len(third.documents)


@pytest.mark.postgres
def test_unchanged_load_writes_nothing(pg_url: str):
    store = PgVectorStore(pg_url)
    store.load()
    again = PgVectorStore(pg_url)
    again.load()
    calls = []
    original = again._conn.executemany  # noqa: SLF001
    again._conn.executemany = lambda *a, **k: calls.append(a) or original(*a, **k)  # noqa: SLF001
    again.save()
    assert calls == []  # float4 round trip does not look like a change


@pytest.mark.postgres
def test_per_source_chunk_cap_holds_with_pgvector(pg_url: str):
    store = PgVectorStore(pg_url)
    store.reindex_seed()
    _add_long(store)
    retriever = EmbeddingRagRetriever(store=store, min_cosine=-1.0, relative_floor=0.0)
    hits = retriever.retrieve("trakeal kollaps kaz ötüşü öksürük floroskopi", top_k=8, filters=THORAX_DOG)
    long_hits = [h for h in hits if h.source_id.startswith("custom-long")]
    assert long_hits and "Trakeal kollaps" in long_hits[0].passage
    assert len(long_hits) <= EmbeddingRagRetriever.MAX_CHUNKS_PER_SOURCE


@pytest.mark.postgres
def test_legacy_json_index_is_copied_in_once(pg_url: str, tmp_path: Path):
    legacy = tmp_path / "rag_index.json"
    old = JsonVectorStore(path=legacy)
    old.load()
    _add_long(old)
    store = PgVectorStore(pg_url, legacy_json=legacy)
    store.load()
    assert store.migrated_from == legacy
    assert {c.source_id for c in store.source_chunks("custom-long")} == {c.source_id for c in old.source_chunks("custom-long")}


@pytest.mark.postgres
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
def test_pgvector_and_json_return_the_same_hits(pg_url: str, query, filters):
    results = []
    for store in (JsonVectorStore(path=None), PgVectorStore(pg_url)):
        store.reindex_seed(persist=isinstance(store, PgVectorStore))
        _add_long(store)
        hits = EmbeddingRagRetriever(store=store).retrieve(query, top_k=5, filters=filters)
        results.append([(h.source_id, h.score) for h in hits])
    assert results[0] == results[1]
