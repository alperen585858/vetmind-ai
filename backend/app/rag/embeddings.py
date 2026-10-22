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


def tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text or "")]


@runtime_checkable
class EmbeddingBackend(Protocol):
    dim: int

    def embed(self, text: str) -> list[float]: ...


class HashEmbeddingBackend:
    """Feature-hashed unigram+bigram bag → L2-normalized vector."""

    def __init__(self, dim: int = 64) -> None:
        self.dim = max(8, dim)

    def embed(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        tokens = tokenize(text)
        grams = list(tokens)
        grams.extend(f"{a}_{b}" for a, b in zip(tokens, tokens[1:]))
        if not grams:
            return vec
        for g in grams:
            h = int(hashlib.sha256(g.encode("utf-8")).hexdigest(), 16)
            idx = h % self.dim
            sign = 1.0 if (h >> 8) & 1 else -1.0
            vec[idx] += sign
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))
