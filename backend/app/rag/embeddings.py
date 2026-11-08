"""Deterministic bag-of-hashed-ngrams embeddings (no torch / no external embed API).

Good enough to demonstrate cosine RAG vs lexical overlap. Replace with a real
sentence-transformer or cloud embedding provider later via EmbeddingBackend Protocol.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol, runtime_checkable

_TOKEN = re.compile(r"[a-zA-ZğüşıöçĞÜŞİÖÇ0-9-]{2,}", re.UNICODE)


# Function words that only add hash noise (every Turkish passage has "ve", "ile", ...).
STOPWORDS = frozenset(
    {
        "ve", "veya", "ile", "bir", "bu", "da", "de", "için", "olarak", "olabilir", "gibi",
        "daha", "en", "çok", "ya", "ise", "ancak", "sonra", "önce", "birlikte", "kabul",
        "edilir", "görülür", "the", "and", "or", "of",
    }
)


def tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text or "")]


@runtime_checkable
class EmbeddingBackend(Protocol):
    dim: int

    def embed(self, text: str) -> list[float]: ...


class HashEmbeddingBackend:
    """Feature-hashed unigram+bigram bag → L2-normalized vector."""

    def __init__(self, dim: int = 64, *, stem_prefix: int = 0, stopwords: bool = False) -> None:
        self.dim = max(8, dim)
        # >0 adds a truncated-token feature ("nöbetler" -> "~nöbet") so Turkish
        # suffixes don't split otherwise identical words. 0 keeps the legacy features.
        self.stem_prefix = max(0, stem_prefix)
        self.stopwords = stopwords

    @property
    def signature(self) -> str:
        return f"hash-{self.dim}-p{self.stem_prefix}" + ("-sw" if self.stopwords else "")

    def embed(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        tokens = tokenize(text)
        if self.stopwords:
            tokens = [t for t in tokens if t not in STOPWORDS]
        grams = list(tokens)
        grams.extend(f"{a}_{b}" for a, b in zip(tokens, tokens[1:]))
        if self.stem_prefix:
            grams.extend(f"~{t[: self.stem_prefix]}" for t in tokens if len(t) > self.stem_prefix)
        if not grams:
            return vec
        for g in grams:
            h = int(hashlib.sha256(g.encode("utf-8")).hexdigest(), 16)
            idx = h % self.dim
            sign = 1.0 if (h >> 8) & 1 else -1.0
            vec[idx] += sign
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


def default_embedding_backend() -> HashEmbeddingBackend:
    """Production hash embedding (chosen on eval/rag_relevance_set.json, see scripts/rag_eval.py)."""
    return HashEmbeddingBackend(dim=2048, stem_prefix=5, stopwords=True)


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))
