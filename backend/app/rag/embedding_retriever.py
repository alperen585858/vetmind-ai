"""Cosine-similarity RAG over seeded / persisted vector store."""

from __future__ import annotations

from app.rag.embeddings import cosine
from app.rag.relevance import RagFilter
from app.rag.vector_store import JsonVectorStore
from app.schemas.rag import RagPassage


class EmbeddingRagRetriever:
    method = "hash_embedding_cosine"

    # Raw-cosine floor. Unfiltered calls keep the legacy 0.05; case-filtered calls
    # use ``min_cosine`` so weak matches are dropped instead of padding the top-k.
    LEGACY_MIN_COSINE = 0.05
    # Tuned with scripts/rag_eval.py on the default hash backend (synthetic set).
    CASE_MIN_COSINE = 0.10
    CASE_RELATIVE_FLOOR = 0.7

    def __init__(
        self,
        store: JsonVectorStore | None = None,
        *,
        min_cosine: float | None = None,
        relative_floor: float | None = None,
        broad_min_cosine: float | None = None,
    ) -> None:
        if store is None:
            store = JsonVectorStore(path=None)
            store.reindex_seed(persist=False)
        self._store = store
        # Floors are per embedding backend (dense vectors score unrelated text much higher).
        backend = store.backend
        if min_cosine is None:
            min_cosine = float(getattr(backend, "case_min_cosine", self.CASE_MIN_COSINE))
        if relative_floor is None:
            relative_floor = float(getattr(backend, "case_relative_floor", self.CASE_RELATIVE_FLOOR))
        self._min_cosine = min_cosine
        # OTHER/UNKNOWN region: no region filter protects the result, so demand stronger evidence.
        if broad_min_cosine is None:
            broad_min_cosine = float(getattr(backend, "case_broad_min_cosine", min_cosine))
        self._broad_min_cosine = max(min_cosine, broad_min_cosine)
        # Filtered calls also drop hits far below the best one (cos < ratio * best).
        self._relative_floor = relative_floor

    @property
    def store(self) -> JsonVectorStore:
        return self._store

    def retrieve(
        self,
        query: str,
        *,
        top_k: int = 4,
        filters: RagFilter | None = None,
    ) -> list[RagPassage]:
        q = (query or "").strip()
        if not q:
            return []
        if filters is None:
            floor = self.LEGACY_MIN_COSINE
        elif filters.region and filters.allowed_regions() is None:
            floor = self._broad_min_cosine
        else:
            floor = self._min_cosine
        qv = self._store.backend.embed(q)
        scored: list[tuple[float, object]] = []
        for doc in self._store.documents:
            if filters is not None and not filters.allows(doc.regions, doc.species):
                continue
            score = cosine(qv, doc.vector)
            if score <= floor:
                continue
            display = min(0.97, max(0.0, (score + 1) / 2))
            scored.append((display, doc))
        scored.sort(key=lambda x: x[0], reverse=True)
        if filters is not None and scored and self._relative_floor > 0:
            best_cos = scored[0][0] * 2 - 1
            scored = [(d, doc) for d, doc in scored if d * 2 - 1 >= self._relative_floor * best_cos]
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
