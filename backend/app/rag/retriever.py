"""Lexical RAG retriever — swappable for embeddings later."""

from __future__ import annotations

import re
from typing import Protocol, runtime_checkable

from app.rag.breed_morphotypes import load_default_rag_corpus
from app.rag.corpus import CorpusDoc
from app.schemas.rag import RagPassage

_TOKEN = re.compile(r"[a-zA-ZğüşıöçĞÜŞİÖÇ0-9-]{2,}", re.UNICODE)


def _tokenize(text: str) -> set[str]:
    return {t.lower() for t in _TOKEN.findall(text)}


@runtime_checkable
class RagRetriever(Protocol):
    def retrieve(self, query: str, *, top_k: int = 4) -> list[RagPassage]: ...


class LexicalRagRetriever:
    """Token-overlap retrieval over the seeded corpus (no embeddings)."""

    def __init__(self, corpus: tuple[CorpusDoc, ...] | None = None) -> None:
        self._corpus = corpus if corpus is not None else load_default_rag_corpus()

    def retrieve(self, query: str, *, top_k: int = 4) -> list[RagPassage]:
        q = (query or "").strip()
        if not q:
            return []
        q_tokens = _tokenize(q)
        if not q_tokens:
            return []

        scored: list[tuple[float, CorpusDoc]] = []
        for doc in self._corpus:
            hay_tokens = _tokenize(f"{doc.title} {doc.section} {doc.passage} {' '.join(doc.keywords)}")
            overlap = q_tokens & hay_tokens
            if not overlap:
                # Soft keyword hit on curated keywords
                kw = {k.lower() for k in doc.keywords}
                overlap = q_tokens & kw
            if not overlap:
                continue
            # Jaccard-ish score with keyword bonus
            score = len(overlap) / max(1, len(q_tokens | hay_tokens))
            score = min(0.97, 0.45 + 0.12 * len(overlap) + score)
            scored.append((score, doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        hits: list[RagPassage] = []
        for score, doc in scored[: max(1, top_k)]:
            hits.append(
                RagPassage(
                    source_id=doc.source_id,
                    title=doc.title,
                    section=doc.section,
                    passage=doc.passage,
                    score=round(score, 3),
                    keywords=list(doc.keywords),
                )
            )
        return hits
