from uuid import uuid4

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.auth.deps import require_auth, require_capability
from app.auth.rbac import CAP_RAG_ADMIN, CAP_RAG_SEARCH
from app.container import AppContainer
from app.schemas.rag import RagSearchResponse

router = APIRouter(
    prefix="/api/v1/rag",
    tags=["rag"],
    dependencies=[Depends(require_auth)],
)


class RagDocumentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    section: str = Field(default="Custom", max_length=200)
    passage: str = Field(min_length=1, max_length=8000)
    keywords: list[str] = Field(default_factory=list)
    source_id: str | None = None


class RagReindexResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    count: int
    method: str
    index_path: str | None
    note: str = "Seed corpus re-embedded into local JSON vector store."


class RagDocumentResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    title: str
    section: str
    count: int


@router.get("/search", response_model=RagSearchResponse)
def search_rag(
    q: str = Query(..., min_length=1, max_length=500, description="Search query"),
    top_k: int = Query(default=5, ge=1, le=20),
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_RAG_SEARCH)),
) -> RagSearchResponse:
    hits = container.rag.retrieve(q, top_k=top_k)
    method = getattr(container, "rag_method", None) or getattr(container.rag, "method", "unknown")
    note = (
        "Demo RAG over a seeded veterinary neurology corpus. "
        "Not clinically validated evidence."
    )
    if method == "hash_embedding_cosine":
        note = (
            "Hash-embedding cosine RAG with optional on-disk JSON index. "
            "Not sentence-transformers / not Qdrant. Not clinical evidence."
        )
    return RagSearchResponse(query=q, hits=hits, method=method, note=note)


@router.post("/reindex", response_model=RagReindexResponse)
def reindex_rag(
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_RAG_ADMIN)),
) -> RagReindexResponse:
    if not hasattr(container.rag, "reindex"):
        return RagReindexResponse(
            count=0,
            method=container.rag_method,
            index_path=None,
            note="Lexical RAG has no vector index to rebuild.",
        )
    count = container.rag.reindex()
    path = None
    if container.vector_store is not None and container.vector_store.path is not None:
        path = str(container.vector_store.path)
    return RagReindexResponse(count=count, method=container.rag_method, index_path=path)


class RagCustomDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    title: str
    section: str
    passage: str
    keywords: list[str]


@router.get("/documents", response_model=list[RagCustomDocument])
def list_custom_rag_documents(
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_RAG_ADMIN)),
) -> list[RagCustomDocument]:
    """Sources added through POST /documents (seed corpus excluded), so the UI can list them."""
    if container.vector_store is None:
        return []
    return [
        RagCustomDocument(
            source_id=d.source_id,
            title=d.title,
            section=d.section,
            passage=d.passage,
            keywords=list(d.keywords),
        )
        for d in container.vector_store.documents
        if d.source_id.startswith("custom-")
    ]


@router.post("/documents", response_model=RagDocumentResponse, status_code=201)
def add_rag_document(
    payload: RagDocumentCreate,
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_RAG_ADMIN)),
) -> RagDocumentResponse:
    if container.vector_store is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=409, detail="Vector store unavailable (lexical RAG mode).")
    source_id = payload.source_id or f"custom-{uuid4().hex[:10]}"
    doc = container.vector_store.add_document(
        source_id=source_id,
        title=payload.title,
        section=payload.section,
        passage=payload.passage,
        keywords=payload.keywords,
    )
    return RagDocumentResponse(
        source_id=doc.source_id,
        title=doc.title,
        section=doc.section,
        count=len(container.vector_store),
    )
