"""Semantic embeddings from a local Ollama model (default ``bge-m3``, multilingual).

Unlike the hash backend this understands meaning: "disk ekstrüzyonu" and "IVDD"
land close together even with no shared words. Default since #101
(``VETMIND_RAG_EMBEDDING=ollama``; ``hash`` turns it off). If Ollama is not reachable
at startup the app falls back to the hash backend instead of failing, and
``EmbeddingStatus`` records why.
"""

from __future__ import annotations

import logging
import math
import os
import sys
from collections import OrderedDict
from dataclasses import dataclass

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


@dataclass(frozen=True)
class EmbeddingStatus:
    """What was asked for and what runs; shown on the System Status page (#101)."""

    requested: str  # "ollama" | "hash"
    active: str  # "ollama" | "hash"
    model: str  # "bge-m3" or the hash signature
    url: str = ""
    warning: str = ""

    @property
    def fell_back(self) -> bool:
        return self.requested != self.active

    def as_dict(self) -> dict:
        return {
            "requested": self.requested,
            "active": self.active,
            "model": self.model,
            "fell_back": self.fell_back,
            "warning": self.warning,
        }


def build_embedding_backend_with_status() -> tuple[EmbeddingBackend, EmbeddingStatus]:
    """``VETMIND_RAG_EMBEDDING=ollama`` (default, bge-m3) or ``hash``; never fails app startup.

    If Ollama or the model is not reachable the hash backend is used and the status says why.
    """
    kind = os.getenv("VETMIND_RAG_EMBEDDING", "ollama").strip().lower()
    if kind != "ollama":
        hashed = default_embedding_backend()
        return hashed, EmbeddingStatus("hash", "hash", str(getattr(hashed, "signature", "hash")))
    model = os.getenv("VETMIND_RAG_EMBEDDING_MODEL", OLLAMA_EMBED_DEFAULT_MODEL).strip() or OLLAMA_EMBED_DEFAULT_MODEL
    url = os.getenv("VETMIND_RAG_EMBEDDING_URL", OLLAMA_EMBED_DEFAULT_URL)
    backend = OllamaEmbeddingBackend(model, base_url=url)
    try:
        backend.embed("bağlantı testi")
    except OllamaEmbeddingError as exc:
        # stderr too: uvicorn's logging setup can swallow this module's logger.
        msg = f"RAG: {exc} — falling back to hash embeddings."
        log.warning(msg)
        print(f"WARNING: {msg}", file=sys.stderr)
        hashed = default_embedding_backend()
        return hashed, EmbeddingStatus(
            "ollama", "hash", str(getattr(hashed, "signature", "hash")), url=url, warning=str(exc)
        )
    return backend, EmbeddingStatus("ollama", "ollama", model, url=url)


def build_embedding_backend() -> EmbeddingBackend:
    return build_embedding_backend_with_status()[0]
