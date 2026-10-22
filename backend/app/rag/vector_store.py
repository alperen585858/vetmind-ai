"""On-disk vector index for embedding RAG (JSON). Qdrant-shaped swap point later."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from app.rag.corpus import SEED_CORPUS, CorpusDoc
from app.rag.embeddings import EmbeddingBackend, HashEmbeddingBackend


@dataclass
class IndexedDoc:
    source_id: str
    title: str
    section: str
    passage: str
    keywords: list[str]
    vector: list[float]


class JsonVectorStore:
    """Persists documents + embedding vectors under ``path`` (optional)."""

    def __init__(self, path: Path | None = None, backend: EmbeddingBackend | None = None) -> None:
        self.path = path
        self._backend = backend or HashEmbeddingBackend(dim=64)
        self._docs: list[IndexedDoc] = []

    @property
    def backend(self) -> EmbeddingBackend:
        return self._backend

    def load(self) -> None:
        if self.path is None or not self.path.is_file():
            self.reindex_seed(persist=self.path is not None)
            return
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        self._docs = [
            IndexedDoc(
                source_id=d["source_id"],
                title=d["title"],
                section=d["section"],
                passage=d["passage"],
                keywords=list(d.get("keywords") or []),
                vector=list(d["vector"]),
            )
            for d in raw.get("documents", [])
        ]
        if not self._docs:
            self.reindex_seed(persist=True)

    def save(self) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": "1.0.0",
            "dim": self._backend.dim,
            "method": "hash_embedding_cosine",
            "count": len(self._docs),
            "documents": [asdict(d) for d in self._docs],
            "note": "Local JSON vector store. Not Qdrant. Not clinical evidence.",
        }
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def reindex_seed(self, *, persist: bool = True) -> int:
        self._docs = []
        for doc in SEED_CORPUS:
            self.add_corpus_doc(doc, persist=False)
        if persist:
            self.save()
        return len(self._docs)

    def add_corpus_doc(self, doc: CorpusDoc, *, persist: bool = True) -> IndexedDoc:
        text = f"{doc.title} {doc.section} {doc.passage} {' '.join(doc.keywords)}"
        indexed = IndexedDoc(
            source_id=doc.source_id,
            title=doc.title,
            section=doc.section,
            passage=doc.passage,
            keywords=list(doc.keywords),
            vector=self._backend.embed(text),
        )
        self._docs = [d for d in self._docs if d.source_id != indexed.source_id]
        self._docs.append(indexed)
        if persist:
            self.save()
        return indexed

    def add_document(
        self,
        *,
        source_id: str,
        title: str,
        section: str,
        passage: str,
        keywords: list[str] | None = None,
    ) -> IndexedDoc:
        doc = CorpusDoc(
            source_id=source_id,
            title=title,
            section=section,
            passage=passage,
            keywords=tuple(keywords or ()),
        )
        return self.add_corpus_doc(doc, persist=True)

    @property
    def documents(self) -> list[IndexedDoc]:
        return list(self._docs)

    def __len__(self) -> int:
        return len(self._docs)
