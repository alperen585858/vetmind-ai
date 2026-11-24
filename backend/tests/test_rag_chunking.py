"""Chunking of long knowledge-base sources (#100)."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.rag.chunking import MAX_CHARS, chunk_id, split_passage
from app.rag.embedding_retriever import EmbeddingRagRetriever
from app.rag.relevance import RagFilter
from app.rag.vector_store import JsonVectorStore
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings, load_settings

TOPICS = {
    "efuzyon": (
        "Plevral efüzyonda interlobar fissür çizgileri belirginleşir ve akciğer lobları göğüs duvarından "
        "uzaklaşır. Kostofrenik açılar yuvarlaklaşır ve kalp silueti silinebilir. Ciddi solunum güçlüğünde "
        "radyografiden önce torakosentez ile stabilizasyon düşünülür. Sıvı boşaltıldıktan sonra çekilen "
        "grafi altta yatan kitleyi gösterebilir."
    ),
    "trakea": (
        "Trakeal kollaps küçük ırk köpeklerde sık görülür ve kaz ötüşü benzeri öksürükle seyreder. "
        "Dinamik bir durum olduğu için inspiratuvar ve ekspiratuvar grafiler birlikte değerlendirilir. "
        "Servikal trakea inspirasyonda, intratorasik trakea ekspirasyonda daralır. Floroskopi tanıya "
        "en çok yardımcı olan yöntemdir."
    ),
    "metastaz": (
        "Toraks metastaz taramasında üç pozisyonlu grafi önerilir: sağ lateral, sol lateral ve "
        "ventrodorsal. Yapısal nodüller genellikle periferik yerleşimlidir ve birkaç milimetreden küçük "
        "lezyonlar radyografide görülmeyebilir. Şüpheli durumlarda bilgisayarlı tomografi daha duyarlıdır."
    ),
    "kalp": (
        "Kardiyak siluetin değerlendirilmesinde vertebral kalp skoru kullanılır. Sol atriyum büyümesi "
        "lateral grafide kaudodorsal sınırın düzleşmesiyle fark edilir. Pulmoner venöz konjesyon ve "
        "perihiler interstisyel patern sol taraflı kalp yetmezliğini düşündürür."
    ),
}
LONG_TEXT = "\n\n".join(TOPICS.values())


def test_short_text_is_one_chunk_and_keeps_its_id():
    chunks = split_passage("Kısa bir pasaj.")
    assert [c.text for c in chunks] == ["Kısa bir pasaj."] and chunks[0].context == ""
    assert chunk_id("custom-a", 0, 1) == "custom-a"
    assert chunk_id("custom-a", 1, 3) == "custom-a#2"


def test_long_text_is_split_on_sentences_without_losing_text():
    chunks = split_passage(LONG_TEXT)
    assert len(chunks) >= 2
    assert all(len(c.text) <= MAX_CHARS for c in chunks)
    assert " ".join(c.text for c in chunks) == " ".join(LONG_TEXT.split())
    for prev, cur in zip(chunks, chunks[1:]):
        assert cur.context and prev.text.endswith(cur.context)  # previous last sentence as context
        assert cur.text[0].isupper()  # starts at a sentence boundary


def test_single_huge_sentence_is_cut_on_words():
    text = " ".join(["kelime"] * 400)  # ~2800 chars, no sentence end
    chunks = split_passage(text)
    assert len(chunks) >= 3 and all(len(c.text) <= MAX_CHARS for c in chunks)
    assert " ".join(c.text for c in chunks) == text


def _store_with_long_source() -> JsonVectorStore:
    store = JsonVectorStore(path=None)
    store.reindex_seed(persist=False)
    store.add_document(
        source_id="custom-long", title="Toraks radyografi notları", section="Kitap · İzinli",
        passage=LONG_TEXT, regions=["THORAX"], species=[], summary="özet", tag_source="rules",
    )
    return store


def test_chunks_share_the_card_and_card_updates_reach_all():
    store = _store_with_long_source()
    chunks = store.source_chunks("custom-long")
    assert len(chunks) >= 2
    assert [c.source_id for c in chunks] == [f"custom-long#{i + 1}" for i in range(len(chunks))]
    assert all(c.regions == ["THORAX"] and c.chunk_count == len(chunks) for c in chunks)
    store.set_card("custom-long", regions=["THORAX", "BRAIN"], species=["feline"], summary="s", tag_source="manual")
    assert all(c.regions == ["THORAX", "BRAIN"] and c.species == ["feline"] for c in store.source_chunks("custom-long"))


def test_readding_a_source_replaces_all_its_chunks():
    store = _store_with_long_source()
    before = len(store)
    store.add_document(source_id="custom-long", title="T", section="S", passage="Artık kısa.")
    assert len(store) == before - len(split_passage(LONG_TEXT)) + 1
    assert [c.source_id for c in store.source_chunks("custom-long")] == ["custom-long"]


def test_search_finds_the_right_chunk_and_caps_chunks_per_source():
    store = _store_with_long_source()
    retriever = EmbeddingRagRetriever(store=store, min_cosine=-1.0, relative_floor=0.0)
    hits = retriever.retrieve(
        "trakeal kollaps kaz ötüşü öksürük floroskopi", top_k=8,
        filters=RagFilter(region="THORAX", species="canine", modality="XR"),
    )
    long_hits = [h for h in hits if h.source_id.startswith("custom-long")]
    assert long_hits and "Trakeal kollaps" in long_hits[0].passage
    assert len(long_hits) <= EmbeddingRagRetriever.MAX_CHUNKS_PER_SOURCE
    assert "parça" in long_hits[0].section


def test_old_index_without_chunk_fields_still_loads(tmp_path: Path):
    path = tmp_path / "rag.json"
    store = JsonVectorStore(path=path)
    store.load()
    store.add_document(source_id="custom-old", title="T", section="S", passage="Kısa.")
    raw = json.loads(path.read_text(encoding="utf-8"))
    for d in raw["documents"]:
        for key in ("parent_id", "chunk_index", "chunk_count", "context"):
            d.pop(key, None)
    path.write_text(json.dumps(raw), encoding="utf-8")
    again = JsonVectorStore(path=path)
    again.load()
    old = again.get("custom-old")
    assert old is not None and old.chunk_count == 1 and old.source_key == "custom-old"


def _client(tmp_path: Path) -> TestClient:
    base = load_settings()
    settings = Settings(**{
        **base.__dict__,
        "storage_backend": "memory",
        "sqlite_path": tmp_path / "unused.sqlite3",
        "quarantine_root": tmp_path / "q",
        "rag_index_path": tmp_path / "rag.json",
        "analyze_gate_path": tmp_path / "gate.count",
        "audit_log_path": None,
        "feedback_log_path": None,
        "demo_seed": False,
        "auth_enabled": False,
        "deployment_mode": "demo",
        "allow_insecure_demo": True,
        "malware_scan_required": False,
        "encryption_at_rest": "none",
        "vision_endpoint": None,
        "llm_provider": "mock",
        "rag_backend": "embedding",
        "rag_card_llm": False,
    })
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def test_api_lists_a_long_source_as_one_row(tmp_path: Path):
    client = _client(tmp_path)
    res = client.post("/api/v1/rag/documents", json={"title": "Toraks notları", "section": "Kitap", "passage": LONG_TEXT})
    assert res.status_code == 201, res.text
    body = res.json()
    sid = body["source_id"]
    assert "#" not in sid and body["chunks"] >= 2 and body["regions"] == ["THORAX"]

    rows = [d for d in client.get("/api/v1/rag/documents").json() if d["source_id"] == sid]
    assert len(rows) == 1 and rows[0]["chunks"] == body["chunks"]
    assert "Trakeal kollaps" in rows[0]["passage"] and "vertebral kalp skoru" in rows[0]["passage"]

    res = client.put(f"/api/v1/rag/documents/{sid}/card", json={"regions": ["THORAX"], "species": ["canine"]})
    assert res.status_code == 200 and res.json()["chunks"] == body["chunks"]
    assert client.post("/api/v1/rag/documents/retag").json()["skipped_manual"] == 1


def test_api_accepts_sources_longer_than_the_old_limit(tmp_path: Path):
    client = _client(tmp_path)
    passage = " ".join([TOPICS["efuzyon"]] * 30)  # ~10k chars, above the old 8000 limit
    res = client.post("/api/v1/rag/documents", json={"title": "Uzun", "section": "Kitap", "passage": passage})
    assert res.status_code == 201, res.text
    assert res.json()["chunks"] > 10
