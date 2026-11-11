"""On-disk vector index for embedding RAG (JSON). Qdrant-shaped swap point later."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from app.rag.breed_morphotypes import load_default_rag_corpus
from app.rag.corpus import CorpusDoc
from app.rag.embeddings import EmbeddingBackend, default_embedding_backend


@dataclass
class IndexedDoc:
    source_id: str
    title: str
    section: str
    passage: str
    keywords: list[str]
    vector: list[float]
    # Clinic-approved knowledge flag — default false (never imply clinical KB).
    approved: bool = False
    # Relevance tags (app/rag/relevance.py); empty = general doc, never filtered out.
    regions: list[str] = field(default_factory=list)
    species: list[str] = field(default_factory=list)


def _embed_text(title: str, section: str, passage: str, keywords: list[str] | tuple[str, ...]) -> str:
    return f"{title} {section} {passage} {' '.join(keywords)}"


def _signature(backend: EmbeddingBackend) -> str:
    return str(getattr(backend, "signature", f"dim-{backend.dim}"))


class JsonVectorStore:
    """Persists documents + embedding vectors under ``path`` (optional)."""

    def __init__(self, path: Path | None = None, backend: EmbeddingBackend | None = None) -> None:
        self.path = path
        self._backend = backend or default_embedding_backend()
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
                approved=bool(d.get("approved", False)),
                regions=list(d.get("regions") or []),
                species=list(d.get("species") or []),
            )
            for d in raw.get("documents", [])
        ]
        if not self._docs:
            self.reindex_seed(persist=True)
            return

        # Embedding config changed (e.g. 64 -> 1024 dims): re-embed every doc, custom
        # ones included, otherwise cosine() sees length-mismatched vectors and returns 0.
        stored_sig = raw.get("embedding") or f"dim-{raw.get('dim')}"
        reembedded = False
        if stored_sig != _signature(self._backend) or any(
            len(d.vector) != self._backend.dim for d in self._docs
        ):
            self._prefetch([_embed_text(d.title, d.section, d.passage, d.keywords) for d in self._docs])
            for doc in self._docs:
                doc.vector = self._backend.embed(_embed_text(doc.title, doc.section, doc.passage, doc.keywords))
            reembedded = True

        # Add missing seed docs and re-index seed docs whose text changed in code
        # (e.g. translated titles), so an old index file never serves stale wording.
        # Docs added at runtime (custom-*) are not in the corpus and stay untouched.
        existing = {doc.source_id: doc for doc in self._docs}
        stale_seed_docs = []
        for doc in load_default_rag_corpus():
            current = existing.get(doc.source_id)
            if current is None or (
                current.title,
                current.section,
                current.passage,
                current.keywords,
                current.regions,
                current.species,
            ) != (
                doc.title,
                doc.section,
                doc.passage,
                list(doc.keywords),
                list(doc.regions),
                list(doc.species),
            ):
                stale_seed_docs.append(doc)
        for doc in stale_seed_docs:
            self.add_corpus_doc(doc, persist=False)
        if stale_seed_docs or reembedded:
            self.save()

    def save(self) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": "1.0.0",
            "dim": self._backend.dim,
            "embedding": _signature(self._backend),
            "method": "hash_embedding_cosine",
            "count": len(self._docs),
            "documents": [asdict(d) for d in self._docs],
            "note": "Local JSON vector store. Not Qdrant. Not clinical evidence.",
        }
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _prefetch(self, texts: list[str]) -> None:
        """Batch-embed up front when the backend supports it (one HTTP call, then cache hits)."""
        embed_many = getattr(self._backend, "embed_many", None)
        if callable(embed_many) and texts:
            embed_many(texts)

    def reindex_seed(self, *, persist: bool = True) -> int:
        self._docs = []
        corpus = load_default_rag_corpus()
        self._prefetch([_embed_text(d.title, d.section, d.passage, d.keywords) for d in corpus])
        for doc in corpus:
            self.add_corpus_doc(doc, persist=False)
        if persist:
            self.save()
        return len(self._docs)

    def add_corpus_doc(
        self, doc: CorpusDoc, *, persist: bool = True, approved: bool = False
    ) -> IndexedDoc:
        text = _embed_text(doc.title, doc.section, doc.passage, doc.keywords)
        indexed = IndexedDoc(
            source_id=doc.source_id,
            title=doc.title,
            section=doc.section,
            passage=doc.passage,
            keywords=list(doc.keywords),
            vector=self._backend.embed(text),
            approved=approved,
            regions=list(doc.regions),
            species=list(doc.species),
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
        approved: bool = False,
    ) -> IndexedDoc:
        doc = CorpusDoc(
            source_id=source_id,
            title=title,
            section=section,
            passage=passage,
            keywords=tuple(keywords or ()),
        )
        return self.add_corpus_doc(doc, persist=True, approved=approved)

    def add_documents_bulk(
        self,
        items: list[dict],
        *,
        default_approved: bool = False,
    ) -> list[IndexedDoc]:
        """Bulk-index dict rows with keys title/section/passage/keywords/source_id/approved."""
        out: list[IndexedDoc] = []
        for raw in items:
            source_id = str(raw.get("source_id") or "").strip() or None
            title = str(raw.get("title") or "").strip()
            passage = str(raw.get("passage") or "").strip()
            if not title or not passage:
                continue
            if not source_id:
                from uuid import uuid4

                source_id = f"custom-{uuid4().hex[:10]}"
            keywords = raw.get("keywords") or []
            if isinstance(keywords, str):
                keywords = [k.strip() for k in keywords.split(",") if k.strip()]
            approved = bool(raw.get("approved", default_approved))
            out.append(
                self.add_document(
                    source_id=source_id,
                    title=title,
                    section=str(raw.get("section") or "Custom"),
                    passage=passage,
                    keywords=list(keywords),
                    approved=approved,
                )
            )
        return out

    @property
    def documents(self) -> list[IndexedDoc]:
        return list(self._docs)

    def __len__(self) -> int:
        return len(self._docs)
