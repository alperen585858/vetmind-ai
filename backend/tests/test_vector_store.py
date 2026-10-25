import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.rag.vector_store import JsonVectorStore
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def test_vector_store_persist_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / "rag.json"
    store = JsonVectorStore(path)
    n = store.reindex_seed()
    assert n >= 5
    assert path.is_file()
    store2 = JsonVectorStore(path)
    store2.load()
    assert len(store2) == n


def test_load_refreshes_changed_seed_docs_and_keeps_custom(tmp_path: Path) -> None:
    path = tmp_path / "rag.json"
    store = JsonVectorStore(path)
    store.reindex_seed()
    store.add_document(source_id="custom-abc", title="Eklenen", section="Kitap · İzinli", passage="özel pasaj")
    seed_id = store.documents[0].source_id
    raw = json.loads(path.read_text(encoding="utf-8"))
    for doc in raw["documents"]:
        if doc["source_id"] == seed_id:
            doc["title"] = "Old English title"
    path.write_text(json.dumps(raw), encoding="utf-8")

    reloaded = JsonVectorStore(path)
    reloaded.load()
    by_id = {d.source_id: d for d in reloaded.documents}
    assert by_id[seed_id].title != "Old English title"
    assert by_id["custom-abc"].passage == "özel pasaj"
    assert len(reloaded) == len(store)


def test_rag_reindex_and_add_document(tmp_path: Path) -> None:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        jwt_secret="s",
        async_analyze_delay_ms=0,
        rag_backend="embedding",
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    assert container.vector_store is not None
    client = TestClient(create_app(container))
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@demo.local", "password": "demo1234"},
    )
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    re = client.post("/api/v1/rag/reindex", headers=headers)
    assert re.status_code == 200
    assert re.json()["count"] >= 5
    added = client.post(
        "/api/v1/rag/documents",
        headers=headers,
        json={
            "title": "Custom Note",
            "section": "Demo",
            "passage": "Unique zebra myelopathy phrase for retrieval.",
            "keywords": ["zebra", "myelopathy"],
        },
    )
    assert added.status_code == 201, added.text
    hits = client.get("/api/v1/rag/search", params={"q": "zebra myelopathy"}, headers=headers)
    assert hits.status_code == 200
    assert any("zebra" in h["passage"].lower() for h in hits.json()["hits"])
    # Bilgi Tabanı lists added sources only (seed corpus excluded).
    listed = client.get("/api/v1/rag/documents", headers=headers)
    assert listed.status_code == 200
    assert [d["title"] for d in listed.json()] == ["Custom Note"]
