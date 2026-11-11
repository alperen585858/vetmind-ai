"""Semantic embeddings from a local Ollama model (default ``bge-m3``, multilingual).

Unlike the hash backend this understands meaning: "disk ekstrüzyonu" and "IVDD"
land close together even with no shared words. Enable with
``VETMIND_RAG_EMBEDDING=ollama`` (see ``build_embedding_backend``). If Ollama is not
reachable at startup the app falls back to the hash backend instead of failing.
"""

from __future__ import annotations

import logging
import math
import os
import sys
from collections import OrderedDict

import httpx

from app.rag.embeddings import EmbeddingBackend, default_embedding_backend

log = logging.getLogger(__name__)

OLLAMA_EMBED_DEFAULT_URL = "http://localhost:11434"
OLLAMA_EMBED_DEFAULT_MODEL = "bge-m3"


class OllamaEmbeddingError(RuntimeError):
    pass


class OllamaEmbeddingBackend:
    """``/api/embed`` client with an in-process cache (corpus + repeated queries)."""

    # Case-filtered retrieval floors for this backend, tuned with scripts/rag_eval.py on bge-m3.
    # Dense embeddings score unrelated text much higher than hash vectors do (~0.45–0.55),
    # so the floors are higher; OTHER/UNKNOWN regions (no region filter) need 0.60.
    case_min_cosine = 0.50
    case_relative_floor = 0.90
    case_broad_min_cosine = 0.60

    def __init__(
        self,
        model: str = OLLAMA_EMBED_DEFAULT_MODEL,
        *,
        base_url: str = OLLAMA_EMBED_DEFAULT_URL,
        dim: int = 1024,
        timeout_s: float = 60.0,
        transport: httpx.BaseTransport | None = None,
        cache_size: int = 2048,
    ) -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.dim = dim
        self._timeout = timeout_s
        self._transport = transport
        self._cache: OrderedDict[str, list[float]] = OrderedDict()
        self._cache_size = cache_size

    @property
    def signature(self) -> str:
        return f"ollama-{self.model}"

    def embed(self, text: str) -> list[float]:
        return self.embed_many([text])[0]

    def embed_many(self, texts: list[str]) -> list[list[float]]:
        missing = [t for t in dict.fromkeys(texts) if t not in self._cache]
        if missing:
            for text, vector in zip(missing, self._request(missing)):
                self._cache[text] = vector
                if len(self._cache) > self._cache_size:
                    self._cache.popitem(last=False)
        return [self._cache[t] for t in texts]

    def _request(self, texts: list[str]) -> list[list[float]]:
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                res = client.post(f"{self.base_url}/api/embed", json={"model": self.model, "input": texts})
        except httpx.HTTPError as exc:
            raise OllamaEmbeddingError(f"Ollama embedding unavailable: {type(exc).__name__}") from exc
        if res.status_code != 200:
            raise OllamaEmbeddingError(f"Ollama embedding failed (HTTP {res.status_code}): {res.text[:200]}")
        vectors = res.json().get("embeddings") or []
        if len(vectors) != len(texts):
            raise OllamaEmbeddingError("Ollama returned a different number of embeddings than inputs.")
        out = []
        for vec in vectors:
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            out.append([v / norm for v in vec])
        self.dim = len(out[0])
        return out


def build_embedding_backend() -> EmbeddingBackend:
    """``VETMIND_RAG_EMBEDDING=hash`` (default) or ``ollama``; never fails app startup."""
    kind = os.getenv("VETMIND_RAG_EMBEDDING", "hash").strip().lower()
    if kind != "ollama":
        return default_embedding_backend()
    backend = OllamaEmbeddingBackend(
        os.getenv("VETMIND_RAG_EMBEDDING_MODEL", OLLAMA_EMBED_DEFAULT_MODEL).strip() or OLLAMA_EMBED_DEFAULT_MODEL,
        base_url=os.getenv("VETMIND_RAG_EMBEDDING_URL", OLLAMA_EMBED_DEFAULT_URL),
    )
    try:
        backend.embed("bağlantı testi")
    except OllamaEmbeddingError as exc:
        # stderr too: uvicorn's logging setup can swallow this module's logger.
        msg = f"RAG: {exc} — falling back to hash embeddings."
        log.warning(msg)
        print(f"WARNING: {msg}", file=sys.stderr)
        return default_embedding_backend()
    return backend
