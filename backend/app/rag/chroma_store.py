"""ChromaDB-backed vector store (#103).

Chroma only stores and searches: every vector comes from our embedding backend (hash or
bge-m3), so changing the embedding re-indexes under our control, as with the JSON file.

Each chunk is one Chroma record: id = chunk source_id, document = passage, embedding = our
vector, metadata = the rest of ``IndexedDoc`` plus one boolean per region/species tag
(``r_BRAIN``, ``s_canine``, ...). Those booleans let the region/species filter of
``RagFilter.allows`` run as a Chroma ``where`` clause. A copy of the documents stays in
memory for the admin listing and the indexing rules; ``save`` writes only what changed.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.rag.embeddings import EmbeddingBackend, cosine
from app.rag.relevance import RagFilter
from app.rag.source_cards import DOC_REGIONS, DOC_SPECIES
from app.rag.vector_store import IndexedDoc, VectorStore, _signature, read_json_index

log = logging.getLogger(__name__)

DEFAULT_COLLECTION = "vetmind_rag"
# Every record carries a flag for each of these, so "$eq False" also matches untagged docs.
REGION_FLAGS: tuple[str, ...] = (*DOC_REGIONS, "META")
SPECIES_FLAGS: tuple[str, ...] = DOC_SPECIES
_UPSERT_BATCH = 500


def _region_key(tag: str) -> str:
    return f"r_{tag.upper()}"


def _species_key(tag: str) -> str:
    return f"s_{tag.lower()}"


def chroma_where(filters: RagFilter | None) -> dict[str, Any] | None:
    """``RagFilter.allows`` as a Chroma ``where`` clause (None = no filter)."""
    if filters is None:
        return None
    clauses: list[dict[str, Any]] = [{_region_key("META"): False}]
    if filters.region and not filters._skull_allowed:  # noqa: SLF001
        clauses.append({_region_key("SKULL"): False})
    case_species = (filters.species or "").lower()
    if case_species in SPECIES_FLAGS:
        clauses.append({"$or": [{"has_species": False}, {_species_key(case_species): True}]})
    allowed = filters.allowed_regions()
    if allowed is not None:
        clauses.append(
            {"$or": [{"has_regions": False}, *({_region_key(t): True} for t in sorted(allowed))]}
        )
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


def _metadata(doc: IndexedDoc, *, signature: str, seq: int) -> dict[str, Any]:
    regions = {r.upper() for r in doc.regions}
    species = {s.lower() for s in doc.species}
    meta: dict[str, Any] = {
        "title": doc.title,
        "section": doc.section,
        "keywords": json.dumps(doc.keywords, ensure_ascii=False),
        "approved": bool(doc.approved),
        "regions": json.dumps(doc.regions),
        "species": json.dumps(doc.species),
        "summary": doc.summary,
        "tag_source": doc.tag_source,
        "parent_id": doc.parent_id,
        "source_key": doc.source_key,
        "chunk_index": int(doc.chunk_index),
        "chunk_count": int(doc.chunk_count),
        "context": doc.context,
        "embedding_sig": signature,
        "seq": seq,
        "has_regions": bool(regions),
        "has_species": bool(species),
    }
    for tag in {*REGION_FLAGS, *regions}:
        meta[_region_key(tag)] = tag in regions
    for tag in {*SPECIES_FLAGS, *species}:
        meta[_species_key(tag)] = tag in species
    return meta


def _doc_from_record(source_id: str, passage: str, vector: Any, meta: dict[str, Any]) -> IndexedDoc:
    return IndexedDoc(
        source_id=source_id,
        title=str(meta.get("title") or ""),
        section=str(meta.get("section") or ""),
        passage=passage or "",
        keywords=list(json.loads(meta.get("keywords") or "[]")),
        vector=[float(x) for x in vector],
        approved=bool(meta.get("approved", False)),
        regions=list(json.loads(meta.get("regions") or "[]")),
        species=list(json.loads(meta.get("species") or "[]")),
        summary=str(meta.get("summary") or ""),
        tag_source=str(meta.get("tag_source") or ""),
        parent_id=str(meta.get("parent_id") or ""),
        chunk_index=int(meta.get("chunk_index") or 0),
        chunk_count=int(meta.get("chunk_count") or 1),
        context=str(meta.get("context") or ""),
    )


def _fingerprint(meta: dict[str, Any], passage: str, vector: list[float]) -> str:
    h = hashlib.sha1(json.dumps(meta, sort_keys=True, ensure_ascii=False).encode())
    h.update(passage.encode())
    h.update(json.dumps([round(v, 7) for v in vector]).encode())
    return h.hexdigest()


def make_chroma_client(path: Path | None = None, url: str | None = None):  # noqa: ANN201
    """HTTP client when ``url`` is set (separate Chroma server), else a local folder, else memory."""
    import chromadb

    if url:
        from urllib.parse import urlparse

        u = urlparse(url if "://" in url else f"http://{url}")
        return chromadb.HttpClient(host=u.hostname or "localhost", port=u.port or 8000, ssl=u.scheme == "https")
    if path is not None:
        path.mkdir(parents=True, exist_ok=True)
        return chromadb.PersistentClient(path=str(path))
    return chromadb.EphemeralClient()


class ChromaVectorStore(VectorStore):
    """Vector store kept in a Chroma collection (cosine space).

    ``path`` / ``url`` pick a local folder or a Chroma server; with neither the collection
    lives in memory under a unique name (tests). ``legacy_json`` is a rag_index.json whose
    documents are copied in when the collection is empty (one-time migration).
    """

    def __init__(
        self,
        path: Path | None = None,
        backend: EmbeddingBackend | None = None,
        *,
        url: str | None = None,
        collection: str | None = None,
        legacy_json: Path | None = None,
        client: Any = None,
    ) -> None:
        super().__init__(path=path, backend=backend)
        self.url = url
        self.legacy_json = legacy_json
        self._client = client or make_chroma_client(path, url)
        in_memory = client is None and path is None and not url
        name = collection or (f"{DEFAULT_COLLECTION}-{uuid4().hex[:12]}" if in_memory else DEFAULT_COLLECTION)
        self.collection_name = name
        self._col = self._open_collection()
        # id -> fingerprint of what Chroma holds; id -> insertion sequence (keeps list order).
        self._synced: dict[str, str] = {}
        self._seq: dict[str, int] = {}
        self.migrated_from: Path | None = None

    @property
    def persistent(self) -> bool:
        return True

    def _open_collection(self):  # noqa: ANN202
        return self._client.get_or_create_collection(
            self.collection_name, configuration={"hnsw": {"space": "cosine"}}, embedding_function=None
        )

    def _collection_dim(self) -> int | None:
        got = self._col.peek(limit=1)
        embeddings = got.get("embeddings")
        return len(embeddings[0]) if embeddings is not None and len(embeddings) else None

    def _read(self) -> tuple[list[IndexedDoc], str] | None:
        got = self._col.get(include=["embeddings", "metadatas", "documents"])
        ids = list(got.get("ids") or [])
        if not ids:
            return self._read_legacy()
        rows = sorted(
            zip(ids, got["documents"], got["embeddings"], got["metadatas"]),
            key=lambda r: int((r[3] or {}).get("seq") or 0),
        )
        docs: list[IndexedDoc] = []
        signature = ""
        for source_id, passage, vector, meta in rows:
            meta = dict(meta or {})
            signature = signature or str(meta.get("embedding_sig") or "")
            doc = _doc_from_record(source_id, passage, vector, meta)
            docs.append(doc)
            self._seq[source_id] = int(meta.get("seq") or 0)
            self._synced[source_id] = _fingerprint(meta, doc.passage, doc.vector)
        return docs, signature

    def _read_legacy(self) -> tuple[list[IndexedDoc], str] | None:
        if self.legacy_json is None or not self.legacy_json.is_file():
            return None
        docs, signature = read_json_index(self.legacy_json)
        if not docs:
            return None
        log.warning("RAG: copying %d documents from %s into Chroma", len(docs), self.legacy_json)
        self.migrated_from = self.legacy_json
        # Write them now: _refresh_after_load only saves when something changed.
        self._docs = docs
        self._write(signature_override=signature)
        return docs, signature

    def save(self) -> None:
        self._write()

    def _write(self, *, signature_override: str | None = None) -> None:
        with self._lock:
            signature = signature_override or _signature(self._backend)
            # A collection holds one vector size; a new embedding size means a fresh collection.
            if self._docs and self._synced and self._collection_dim() not in (None, len(self._docs[0].vector)):
                self._client.delete_collection(self.collection_name)
                self._col = self._open_collection()
                self._synced.clear()
            next_seq = max(self._seq.values(), default=-1) + 1
            records: list[tuple[str, str, list[float], dict[str, Any], str]] = []
            current: set[str] = set()
            for doc in self._docs:
                if doc.source_id not in self._seq:
                    self._seq[doc.source_id] = next_seq
                    next_seq += 1
                meta = _metadata(doc, signature=signature, seq=self._seq[doc.source_id])
                fp = _fingerprint(meta, doc.passage, doc.vector)
                current.add(doc.source_id)
                if self._synced.get(doc.source_id) != fp:
                    records.append((doc.source_id, doc.passage, doc.vector, meta, fp))
            removed = [sid for sid in self._synced if sid not in current]
            if removed:
                self._col.delete(ids=removed)
                for sid in removed:
                    self._synced.pop(sid, None)
                    self._seq.pop(sid, None)
            for i in range(0, len(records), _UPSERT_BATCH):
                batch = records[i : i + _UPSERT_BATCH]
                self._col.upsert(
                    ids=[r[0] for r in batch],
                    documents=[r[1] for r in batch],
                    embeddings=[r[2] for r in batch],
                    metadatas=[r[3] for r in batch],
                )
                for r in batch:
                    self._synced[r[0]] = r[4]

    def search(
        self, query_vector: list[float], *, filters: RagFilter | None = None, limit: int = 100
    ) -> list[tuple[float, IndexedDoc]]:
        with self._lock:
            by_id = {d.source_id: d for d in self._docs}
        if not by_id:
            return []
        res = self._col.query(
            query_embeddings=[query_vector],
            n_results=max(1, min(limit, len(by_id))),
            where=chroma_where(filters),
            include=["distances"],
        )
        out: list[tuple[float, IndexedDoc]] = []
        # Chroma picks and filters the candidates; the score is recomputed from our own vector so
        # it matches the in-memory store exactly (Chroma keeps float32).
        for source_id in res["ids"][0]:
            doc = by_id.get(source_id)
            if doc is not None:
                out.append((cosine(query_vector, doc.vector), doc))
        out.sort(key=lambda x: x[0], reverse=True)
        return out

    def count(self) -> int:
        return int(self._col.count())
