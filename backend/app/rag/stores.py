"""Pick the RAG vector store from settings (#103, #117)."""

from __future__ import annotations

from app.rag.embeddings import EmbeddingBackend
from app.rag.vector_store import JsonVectorStore, VectorStore
from app.settings import Settings


def resolve_rag_store(settings: Settings) -> str:
    """"auto" -> "pgvector" when records are in PostgreSQL (one database), else "json"."""
    kind = (settings.rag_store or "auto").lower()
    if kind != "auto":
        return kind
    return "pgvector" if settings.storage_backend == "postgres" and settings.database_url else "json"


def build_vector_store(settings: Settings, backend: EmbeddingBackend, *, in_memory: bool = False) -> VectorStore:
    """pgvector (in the app's PostgreSQL) by default on PostgreSQL, the JSON file otherwise;
    ``VETMIND_RAG_STORE=chroma`` keeps the optional Chroma store (#103).
    ``in_memory`` (tests with memory storage) never touches disk or a database.
    """
    if in_memory:
        return JsonVectorStore(path=None, backend=backend)
    kind = resolve_rag_store(settings)
    if kind == "json":
        return JsonVectorStore(path=settings.rag_index_path, backend=backend)
    if kind == "pgvector":
        if not settings.database_url:
            raise RuntimeError("VETMIND_RAG_STORE=pgvector needs PostgreSQL (VETMIND_DATABASE_URL).")
        from app.rag.pgvector_store import PgVectorStore

        return PgVectorStore(settings.database_url, backend, legacy_json=settings.rag_index_path)
    import importlib.util

    if importlib.util.find_spec("chromadb") is None:  # optional since #117
        raise RuntimeError(
            "VETMIND_RAG_STORE=chroma needs the optional chromadb package: "
            "pip install -r requirements-chroma.txt"
        )
    from app.rag.chroma_store import ChromaVectorStore

    return ChromaVectorStore(
        path=None if settings.chroma_url else settings.chroma_path,
        url=settings.chroma_url,
        backend=backend,
        legacy_json=settings.rag_index_path,
    )
