"""Vector index for embedding RAG.

``VectorStore`` holds the documents and all indexing rules (seed corpus, chunking, source
cards, re-embedding when the embedding changes). Subclasses only decide where the documents
live: ``JsonVectorStore`` (in memory, or a JSON file) and ``ChromaVectorStore``
(app/rag/chroma_store.py, the default on disk). Our code computes every embedding; the store
only keeps and searches the vectors.
"""

from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass, field
from functools import wraps
from pathlib import Path
from typing import Callable, TypeVar

from app.rag.breed_morphotypes import load_default_rag_corpus
from app.rag.chunking import chunk_id, split_passage
from app.rag.corpus import CorpusDoc
from app.rag.embeddings import EmbeddingBackend, cosine, default_embedding_backend
from app.rag.relevance import RagFilter
from app.rag.source_cards import SourceCardTagger


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
    # Source card (app/rag/source_cards.py): short description and where the tags came from
    # ("seed" | "manual" | "rules" | "llm" | "none").
    summary: str = ""
    tag_source: str = ""
    # Chunking (#100): chunks of one uploaded source share ``parent_id`` and its card.
    # Single-chunk sources (and every seed doc) have parent_id "" and chunk_count 1.
    parent_id: str = ""
    chunk_index: int = 0
    chunk_count: int = 1
    # Previous chunk's last sentence: embedded with the chunk, not part of the passage.
    context: str = ""

    @property
    def source_key(self) -> str:
        """Id of the whole source this doc belongs to."""
        return self.parent_id or self.source_id


def _embed_text(
    title: str, section: str, passage: str, keywords: list[str] | tuple[str, ...], context: str = ""
) -> str:
    body = f"{context} {passage}" if context else passage
    return f"{title} {section} {body} {' '.join(keywords)}"


def _doc_embed_text(d: IndexedDoc) -> str:
    return _embed_text(d.title, d.section, d.passage, d.keywords, d.context)


_F = TypeVar("_F", bound=Callable)


def _locked(fn: _F) -> _F:
    """Serialize changes so two uploads at once cannot drop each other's chunks."""

    @wraps(fn)
    def wrapper(self, *args, **kwargs):  # noqa: ANN001, ANN202
        with self._lock:
            return fn(self, *args, **kwargs)

    return wrapper  # type: ignore[return-value]


def _signature(backend: EmbeddingBackend) -> str:
    return str(getattr(backend, "signature", f"dim-{backend.dim}"))


class VectorStore:
    """Documents + vectors with the indexing rules; storage is up to the subclass.

    Subclasses implement ``_read`` (stored docs and embedding signature) and ``save``, and may
    override ``search`` to filter and rank inside the database.
    """

    def __init__(self, path: Path | None = None, backend: EmbeddingBackend | None = None) -> None:
        self.path = path
        self._backend = backend or default_embedding_backend()
        self._docs: list[IndexedDoc] = []
        self._lock = threading.RLock()

    @property
    def backend(self) -> EmbeddingBackend:
        return self._backend

    @property
    def persistent(self) -> bool:
        return self.path is not None

    def _read(self) -> tuple[list[IndexedDoc], str] | None:
        """Stored documents and the embedding signature they were made with (None = nothing stored)."""
        raise NotImplementedError

    def save(self) -> None:
        raise NotImplementedError

    def load(self) -> None:
        with self._lock:
            stored = self._read()
            if not stored or not stored[0]:
                self.reindex_seed(persist=self.persistent)
                return
            self._docs, stored_sig = stored
            self._refresh_after_load(stored_sig)

    def _refresh_after_load(self, stored_sig: str) -> None:
        # Embedding config changed (e.g. 64 -> 1024 dims): re-embed every doc, custom
        # ones included, otherwise cosine() sees length-mismatched vectors and returns 0.
        reembedded = False
        if stored_sig != _signature(self._backend) or any(
            len(d.vector) != self._backend.dim for d in self._docs
        ):
            self._prefetch([_doc_embed_text(d) for d in self._docs])
            for doc in self._docs:
                doc.vector = self._backend.embed(_doc_embed_text(doc))
            reembedded = True

        # Add missing seed docs and re-index seed docs whose text changed in code
        # (e.g. translated titles), so an old index never serves stale wording.
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

    def search(
        self, query_vector: list[float], *, filters: RagFilter | None = None, limit: int = 100
    ) -> list[tuple[float, IndexedDoc]]:
        """(cosine, doc) pairs that pass ``filters``, best first, at most ``limit``."""
        with self._lock:
            docs = list(self._docs)
        scored = [
            (cosine(query_vector, d.vector), d)
            for d in docs
            if filters is None or filters.allows(d.regions, d.species)
        ]
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[:limit]

    def _prefetch(self, texts: list[str]) -> None:
        """Batch-embed up front when the backend supports it (one HTTP call, then cache hits)."""
        embed_many = getattr(self._backend, "embed_many", None)
        if callable(embed_many) and texts:
            embed_many(texts)

    @_locked
    def reindex_seed(self, *, persist: bool = True) -> int:
        self._docs = []
        corpus = load_default_rag_corpus()
        self._prefetch([_embed_text(d.title, d.section, d.passage, d.keywords) for d in corpus])
        for doc in corpus:
            self.add_corpus_doc(doc, persist=False)
        if persist:
            self.save()
        return len(self._docs)

    @_locked
    def add_corpus_doc(
        self,
        doc: CorpusDoc,
        *,
        persist: bool = True,
        approved: bool = False,
        summary: str = "",
        tag_source: str = "seed",
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
            summary=summary,
            tag_source=tag_source,
        )
        self._docs = [d for d in self._docs if d.source_id != indexed.source_id]
        self._docs.append(indexed)
        if persist:
            self.save()
        return indexed

    @_locked
    def add_document(
        self,
        *,
        source_id: str,
        title: str,
        section: str,
        passage: str,
        keywords: list[str] | None = None,
        approved: bool = False,
        regions: list[str] | tuple[str, ...] = (),
        species: list[str] | tuple[str, ...] = (),
        summary: str = "",
        tag_source: str = "none",
        persist: bool = True,
    ) -> IndexedDoc:
        """Index an uploaded source, split into chunks when long (#100). Returns the first
        chunk; every chunk carries the same card. Re-adding a source id replaces all its chunks."""
        chunks = split_passage(passage) or []
        if not chunks:
            raise ValueError("Empty passage")
        kws = list(keywords or ())
        self._docs = [d for d in self._docs if d.source_key != source_id]
        count = len(chunks)
        texts = [_embed_text(title, section, c.text, kws, c.context) for c in chunks]
        self._prefetch(texts)
        added: list[IndexedDoc] = []
        for i, (chunk, text) in enumerate(zip(chunks, texts)):
            doc = IndexedDoc(
                source_id=chunk_id(source_id, i, count),
                title=title,
                section=section,
                passage=chunk.text,
                keywords=kws,
                vector=self._backend.embed(text),
                approved=approved,
                regions=list(regions),
                species=list(species),
                summary=summary,
                tag_source=tag_source,
                parent_id=source_id if count > 1 else "",
                chunk_index=i,
                chunk_count=count,
                context=chunk.context,
            )
            self._docs.append(doc)
            added.append(doc)
        if persist:
            self.save()
        return added[0]

    def source_chunks(self, source_id: str) -> list[IndexedDoc]:
        """All chunks of one source, in order."""
        return sorted((d for d in self._docs if d.source_key == source_id), key=lambda d: d.chunk_index)

    def sources(self, *, prefix: str = "") -> list[list[IndexedDoc]]:
        """Docs grouped by source (insertion order), optionally only ids with ``prefix``."""
        groups: dict[str, list[IndexedDoc]] = {}
        for d in self._docs:
            if d.source_key.startswith(prefix):
                groups.setdefault(d.source_key, []).append(d)
        return [sorted(g, key=lambda d: d.chunk_index) for g in groups.values()]

    @_locked
    def set_card(
        self,
        source_id: str,
        *,
        regions: list[str] | tuple[str, ...],
        species: list[str] | tuple[str, ...],
        summary: str,
        tag_source: str,
    ) -> IndexedDoc | None:
        """Update a source's card on all its chunks (the embedding does not depend on it)."""
        chunks = self.source_chunks(source_id)
        for doc in chunks:
            doc.regions = list(regions)
            doc.species = list(species)
            doc.summary = summary
            doc.tag_source = tag_source
        if not chunks:
            return None
        self.save()
        return chunks[0]

    def get(self, source_id: str) -> IndexedDoc | None:
        return next((d for d in self._docs if d.source_id == source_id), None)

    @_locked
    def add_documents_bulk(
        self,
        items: list[dict],
        *,
        default_approved: bool = False,
        tagger: SourceCardTagger | None = None,
    ) -> list[IndexedDoc]:
        """Bulk-index dict rows with keys title/section/passage/keywords/source_id/approved
        (optional regions/species = manual card). ``tagger`` builds each source card."""
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
            section = str(raw.get("section") or "Custom")
            card = (tagger or SourceCardTagger()).card(
                title=title,
                section=section,
                passage=passage,
                keywords=list(keywords),
                regions=raw.get("regions"),
                species=raw.get("species"),
            )
            out.append(
                self.add_document(
                    source_id=source_id,
                    title=title,
                    section=section,
                    passage=passage,
                    keywords=list(keywords),
                    approved=approved,
                    regions=card.regions,
                    species=card.species,
                    summary=card.summary,
                    tag_source=card.tag_source,
                    persist=False,
                )
            )
        if out:
            self.save()
        return out

    @property
    def documents(self) -> list[IndexedDoc]:
        return list(self._docs)

    def __len__(self) -> int:
        return len(self._docs)


class JsonVectorStore(VectorStore):
    """In memory (``path=None``, used by tests and evaluation) or one JSON file."""

    def _read(self) -> tuple[list[IndexedDoc], str] | None:
        if self.path is None or not self.path.is_file():
            return None
        return read_json_index(self.path)

    def save(self) -> None:
        if self.path is None:
            return
        with self._lock:
            payload = {
                "version": "1.0.0",
                "dim": self._backend.dim,
                "embedding": _signature(self._backend),
                "method": "hash_embedding_cosine",
                "count": len(self._docs),
                "documents": [asdict(d) for d in self._docs],
                "note": "Local JSON vector store. Not clinical evidence.",
            }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(self.path)


def read_json_index(path: Path) -> tuple[list[IndexedDoc], str]:
    """Documents and embedding signature from a rag_index.json file (also used for migration)."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    docs = [
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
            summary=str(d.get("summary") or ""),
            tag_source=str(d.get("tag_source") or ""),
            parent_id=str(d.get("parent_id") or ""),
            chunk_index=int(d.get("chunk_index") or 0),
            chunk_count=int(d.get("chunk_count") or 1),
            context=str(d.get("context") or ""),
        )
        for d in raw.get("documents", [])
    ]
    return docs, str(raw.get("embedding") or f"dim-{raw.get('dim')}")
