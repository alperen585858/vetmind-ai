"""Cosine-similarity RAG over seeded / persisted vector store."""

from __future__ import annotations

from app.rag.embeddings import cosine
from app.rag.vector_store import JsonVectorStore
from app.schemas.rag import RagPassage


class EmbeddingRagRetriever:
    method = "hash_embedding_cosine"

    def __init__(self, store: JsonVectorStore | None = None) -> None:
        if store is None:
            store = JsonVectorStore(path=None)
            store.reindex_seed(persist=False)
        self._store = store

    @property
    def store(self) -> JsonVectorStore:
        return self._store

    def retrieve(self, query: str, *, top_k: int = 4) -> list[RagPassage]:
        q = (query or "").strip()
        if not q:
            return []
        qv = self._store.backend.embed(q)
        scored: list[tuple[float, object]] = []
        for doc in self._store.documents:
            score = cosine(qv, doc.vector)
            if score <= 0.05:
                continue
            display = min(0.97, max(0.0, (score + 1) / 2))
            scored.append((display, doc))
        scored.sort(key=lambda x: x[0], reverse=True)
        hits: list[RagPassage] = []
        for score, doc in scored[: max(1, top_k)]:
            hits.append(
                RagPassage(
                    source_id=doc.source_id,  # type: ignore[attr-defined]
                    title=doc.title,  # type: ignore[attr-defined]
                    section=doc.section,  # type: ignore[attr-defined]
                    passage=doc.passage,  # type: ignore[attr-defined]
                    score=round(score, 3),
                    keywords=list(doc.keywords),  # type: ignore[attr-defined]
                )
            )
        return hits

    def reindex(self) -> int:
        return self._store.reindex_seed(persist=self._store.path is not None)
