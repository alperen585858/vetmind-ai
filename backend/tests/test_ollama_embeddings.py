import json
from pathlib import Path

import httpx
import pytest

from app.rag.embedding_retriever import EmbeddingRagRetriever
from app.rag.embeddings import HashEmbeddingBackend
from app.rag.ollama_embeddings import OllamaEmbeddingBackend, OllamaEmbeddingError, build_embedding_backend
from app.rag.relevance import RagFilter
from app.rag.vector_store import JsonVectorStore


def _fake_ollama(calls: list) -> httpx.MockTransport:
    """Deterministic 4-dim 'embeddings': thorax words -> axis 0, spine words -> axis 1."""

    def vec(text: str) -> list[float]:
        t = text.lower()
        return [
            2.0 if ("toraks" in t or "akciğer" in t or "thorax" in t) else 0.1,
            2.0 if ("disk" in t or "servikal" in t or "spinal" in t) else 0.1,
            0.1,
            0.1,
        ]

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append(body)
        assert request.url.path == "/api/embed" and body["model"] == "bge-m3"
        return httpx.Response(200, json={"embeddings": [vec(t) for t in body["input"]]})

    return httpx.MockTransport(handler)


def test_backend_normalizes_batches_and_caches() -> None:
    calls: list = []
    backend = OllamaEmbeddingBackend(transport=_fake_ollama(calls))
    a, b = backend.embed_many(["toraks akciğer", "servikal disk"])
    assert abs(sum(x * x for x in a) - 1.0) < 1e-9 and backend.dim == 4
    assert a != b
    backend.embed("toraks akciğer")  # cached
    assert len(calls) == 1 and backend.signature == "ollama-bge-m3"


def test_store_batches_corpus_and_retriever_uses_backend_floors() -> None:
    calls: list = []
    store = JsonVectorStore(path=None, backend=OllamaEmbeddingBackend(transport=_fake_ollama(calls)))
    store.reindex_seed(persist=False)
    assert len(calls) == 1 and len(calls[0]["input"]) == len(store)  # one batch for the whole corpus
    retriever = EmbeddingRagRetriever(store=store)
    assert retriever._min_cosine == OllamaEmbeddingBackend.case_min_cosine
    hits = retriever.retrieve("toraks akciğer öksürük", filters=RagFilter(region="THORAX", modality="XR"))
    assert hits and all(h.source_id.startswith("kb-") for h in hits)


def test_index_switches_from_hash_to_ollama(tmp_path: Path) -> None:
    path = tmp_path / "idx.json"
    JsonVectorStore(path, backend=HashEmbeddingBackend(dim=64)).load()
    store = JsonVectorStore(path, backend=OllamaEmbeddingBackend(transport=_fake_ollama([])))
    store.load()
    assert all(len(d.vector) == 4 for d in store.documents)
    assert json.loads(path.read_text(encoding="utf-8"))["embedding"] == "ollama-bge-m3"


def test_errors_are_typed() -> None:
    down = httpx.MockTransport(lambda r: httpx.Response(404, text="model not found"))
    with pytest.raises(OllamaEmbeddingError, match="HTTP 404"):
        OllamaEmbeddingBackend(transport=down).embed("x")


def test_factory_defaults_to_hash_and_falls_back_when_ollama_is_down(monkeypatch) -> None:
    monkeypatch.delenv("VETMIND_RAG_EMBEDDING", raising=False)
    assert isinstance(build_embedding_backend(), HashEmbeddingBackend)
    monkeypatch.setenv("VETMIND_RAG_EMBEDDING", "ollama")
    monkeypatch.setenv("VETMIND_RAG_EMBEDDING_URL", "http://127.0.0.1:9")  # nothing listens here
    assert isinstance(build_embedding_backend(), HashEmbeddingBackend)
