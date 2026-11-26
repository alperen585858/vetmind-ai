"""RAG vector store in PostgreSQL with the pgvector extension (#117).

Same contract as the Chroma store (#103): every vector comes from our embedding backend
(hash or bge-m3), the database only stores and searches. One ``rag_chunks`` row per chunk
(migration 0006). What this adds over a separate vector service:

- one database for records and vectors (one backup, one retention / deletion policy);
- a source's chunks and their card are written in one transaction;
- the region / species filter of ``RagFilter.allows`` is a plain SQL ``WHERE``.

Search is an exact scan ordered by pgvector's cosine distance (``<=>``); the score is then
recomputed from our own vector so it matches the in-memory store. A copy of the documents
stays in memory for the admin listing and the indexing rules; ``save`` writes only what
changed.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

from app.rag.embeddings import EmbeddingBackend, cosine
from app.rag.relevance import RagFilter
from app.rag.source_cards import DOC_SPECIES
from app.rag.vector_store import IndexedDoc, VectorStore, _signature, read_json_index

log = logging.getLogger(__name__)

_COLUMNS = (
    "source_id, seq, title, section, passage, keywords, approved, regions, species, summary, "
    "tag_source, parent_id, chunk_index, chunk_count, context, embedding_sig, embedding, fingerprint"
)
_UPSERT = f"""
    INSERT INTO rag_chunks ({_COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::vector, ?)
    ON CONFLICT (source_id) DO UPDATE SET
        seq = EXCLUDED.seq, title = EXCLUDED.title, section = EXCLUDED.section,
        passage = EXCLUDED.passage, keywords = EXCLUDED.keywords, approved = EXCLUDED.approved,
        regions = EXCLUDED.regions, species = EXCLUDED.species, summary = EXCLUDED.summary,
        tag_source = EXCLUDED.tag_source, parent_id = EXCLUDED.parent_id,
        chunk_index = EXCLUDED.chunk_index, chunk_count = EXCLUDED.chunk_count,
        context = EXCLUDED.context, embedding_sig = EXCLUDED.embedding_sig,
        embedding = EXCLUDED.embedding, fingerprint = EXCLUDED.fingerprint
"""


def vector_literal(vector: list[float]) -> str:
    """pgvector text form: ``[0.1,0.2,...]``."""
    return "[" + ",".join(repr(float(v)) for v in vector) + "]"


def sql_filter(filters: RagFilter | None) -> tuple[str, list[Any]]:
    """``RagFilter.allows`` as a SQL condition plus its parameters ("TRUE" = no filter).

    Regions are stored upper-case and species lower-case, so the comparisons are exact.
    """
    if filters is None:
        return "TRUE", []
    clauses = ["NOT ('META' = ANY(regions))"]
    params: list[Any] = []
    if filters.region and not filters._skull_allowed:  # noqa: SLF001
        clauses.append("NOT ('SKULL' = ANY(regions))")
    case_species = (filters.species or "").lower()
    if case_species in DOC_SPECIES:
        clauses.append("(cardinality(species) = 0 OR ? = ANY(species))")
        params.append(case_species)
    allowed = filters.allowed_regions()
    if allowed is not None:
        clauses.append("(cardinality(regions) = 0 OR regions && ?::text[])")
        params.append(sorted(allowed))
    return " AND ".join(clauses), params


def _row_values(doc: IndexedDoc, *, seq: int, signature: str) -> list[Any]:
    return [
        doc.source_id,
        seq,
        doc.title,
        doc.section,
        doc.passage,
        json.dumps(list(doc.keywords), ensure_ascii=False),
        bool(doc.approved),
        sorted({r.upper() for r in doc.regions}),
        sorted({s.lower() for s in doc.species}),
        doc.summary,
        doc.tag_source,
        doc.parent_id,
        int(doc.chunk_index),
        int(doc.chunk_count),
        doc.context,
        signature,
        vector_literal(doc.vector),
    ]


def _fingerprint(values: list[Any], vector: list[float]) -> str:
    # The stored vector is float4; round so a doc read back compares equal to itself.
    meta = values[:-1]
    h = hashlib.sha1(json.dumps(meta, sort_keys=False, ensure_ascii=False, default=str).encode())
    h.update(json.dumps([round(float(v), 6) for v in vector]).encode())
    return h.hexdigest()


def _doc_from_row(row: dict[str, Any], vector: list[float]) -> IndexedDoc:
    keywords = row["keywords"]
    if isinstance(keywords, str):
        keywords = json.loads(keywords or "[]")
    return IndexedDoc(
        source_id=row["source_id"],
        title=row["title"],
        section=row["section"],
        passage=row["passage"],
        keywords=list(keywords or []),
        vector=vector,
        approved=bool(row["approved"]),
        regions=list(row["regions"] or []),
        species=list(row["species"] or []),
        summary=row["summary"] or "",
        tag_source=row["tag_source"] or "",
        parent_id=row["parent_id"] or "",
        chunk_index=int(row["chunk_index"] or 0),
        chunk_count=int(row["chunk_count"] or 1),
        context=row["context"] or "",
    )


class PgVectorStore(VectorStore):
    """Vector store kept in the ``rag_chunks`` table of the app's PostgreSQL database.

    ``legacy_json`` is a rag_index.json whose documents are copied in when the table is empty
    (one-time migration, as for Chroma). ``connection`` lets tests pass their own.
    """

    def __init__(
        self,
        database_url: str,
        backend: EmbeddingBackend | None = None,
        *,
        legacy_json: Path | None = None,
        connection: Any = None,
    ) -> None:
        super().__init__(path=None, backend=backend)
        from app.storage.sql import Database

        self.database_url = database_url
        self.legacy_json = legacy_json
        self._conn = connection or Database(database_url).connect()  # runs migrations
        if getattr(self._conn, "dialect", "postgres") != "postgres":
            raise RuntimeError("The pgvector RAG store needs PostgreSQL (VETMIND_STORAGE=postgres).")
        # id -> fingerprint of what the table holds; id -> insertion sequence (keeps list order).
        self._synced: dict[str, str] = {}
        self._seq: dict[str, int] = {}
        self.migrated_from: Path | None = None

    @property
    def persistent(self) -> bool:
        return True

    @property
    def kind(self) -> str:
        return "pgvector"

    def _read(self) -> tuple[list[IndexedDoc], str] | None:
        rows = self._conn.execute(
            f"SELECT {_COLUMNS.replace('embedding,', 'embedding::text AS embedding,')} FROM rag_chunks ORDER BY seq"
        ).fetchall()
        if not rows:
            return self._read_legacy()
        docs: list[IndexedDoc] = []
        signature = ""
        for row in rows:
            row = dict(row)
            vector = [float(x) for x in json.loads(row["embedding"])]
            doc = _doc_from_row(row, vector)
            docs.append(doc)
            signature = signature or str(row["embedding_sig"] or "")
            self._seq[doc.source_id] = int(row["seq"])
            self._synced[doc.source_id] = _fingerprint(
                _row_values(doc, seq=int(row["seq"]), signature=row["embedding_sig"]), vector
            )
        return docs, signature

    def _read_legacy(self) -> tuple[list[IndexedDoc], str] | None:
        if self.legacy_json is None or not self.legacy_json.is_file():
            return None
        docs, signature = read_json_index(self.legacy_json)
        if not docs:
            return None
        log.warning("RAG: copying %d documents from %s into PostgreSQL (pgvector)", len(docs), self.legacy_json)
        self.migrated_from = self.legacy_json
        self._docs = docs
        self._write(signature_override=signature)
        return docs, signature

    def save(self) -> None:
        self._write()

    def _write(self, *, signature_override: str | None = None) -> None:
        """Upsert changed chunks and delete removed ones in one transaction."""
        with self._lock:
            signature = signature_override or _signature(self._backend)
            next_seq = max(self._seq.values(), default=-1) + 1
            pending: list[tuple[list[Any], str]] = []
            current: set[str] = set()
            new_seq: dict[str, int] = {}
            for doc in self._docs:
                seq = self._seq.get(doc.source_id)
                if seq is None:
                    seq = new_seq[doc.source_id] = next_seq
                    next_seq += 1
                values = _row_values(doc, seq=seq, signature=signature)
                fp = _fingerprint(values, doc.vector)
                current.add(doc.source_id)
                if self._synced.get(doc.source_id) != fp:
                    pending.append(([*values, fp], fp))
            removed = [sid for sid in self._synced if sid not in current]
            if not pending and not removed:
                return
            try:
                if removed:
                    self._conn.execute("DELETE FROM rag_chunks WHERE source_id = ANY(?)", [removed])
                if pending:
                    self._conn.executemany(_UPSERT, [row for row, _ in pending])
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
            for sid in removed:
                self._synced.pop(sid, None)
                self._seq.pop(sid, None)
            self._seq.update(new_seq)
            for row, fp in pending:
                self._synced[row[0]] = fp

    def search(
        self, query_vector: list[float], *, filters: RagFilter | None = None, limit: int = 100
    ) -> list[tuple[float, IndexedDoc]]:
        with self._lock:
            by_id = {d.source_id: d for d in self._docs}
            if not by_id:
                return []
            where, params = sql_filter(filters)
            rows = self._conn.execute(
                f"SELECT source_id FROM rag_chunks WHERE {where} "
                "ORDER BY embedding <=> ?::vector, seq LIMIT ?",
                [*params, vector_literal(query_vector), max(1, min(limit, len(by_id)))],
            ).fetchall()
        out: list[tuple[float, IndexedDoc]] = []
        # The database picks and filters the candidates; the score comes from our own vector.
        for row in rows:
            doc = by_id.get(dict(row)["source_id"])
            if doc is not None:
                out.append((cosine(query_vector, doc.vector), doc))
        out.sort(key=lambda x: x[0], reverse=True)
        return out

    def count(self) -> int:
        with self._lock:
            row = self._conn.execute("SELECT count(*) AS n FROM rag_chunks").fetchall()[0]
        return int(dict(row)["n"])
