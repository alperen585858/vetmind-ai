"""Pick the RAG vector store from settings (#103)."""

from __future__ import annotations

from app.rag.embeddings import EmbeddingBackend
from app.rag.vector_store import JsonVectorStore, VectorStore
from app.settings import Settings


def build_vector_store(settings: Settings, backend: EmbeddingBackend, *, in_memory: bool = False) -> VectorStore:
    """Chroma (local folder or server) by default; ``VETMIND_RAG_STORE=json`` keeps the JSON file.

    ``in_memory`` (tests with memory storage) never touches disk.
    """
    if in_memory:
        return JsonVectorStore(path=None, backend=backend)
    if settings.rag_store == "json":
        return JsonVectorStore(path=settings.rag_index_path, backend=backend)
    from app.rag.chroma_store import ChromaVectorStore

    return ChromaVectorStore(
        path=None if settings.chroma_url else settings.chroma_path,
        url=settings.chroma_url,
        backend=backend,
        legacy_json=settings.rag_index_path,
    )
