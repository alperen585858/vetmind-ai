from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_container
from app.auth.deps import require_auth, require_capability
from app.auth.rbac import CAP_RAG_ADMIN, CAP_RAG_SEARCH
from app.container import AppContainer
from app.rag.source_cards import DOC_REGIONS, SourceCardTagger
from app.rag.vector_store import IndexedDoc, VectorStore
from app.schemas.rag import RagSearchResponse

DocRegion = Literal["BRAIN", "SKULL", "CERVICAL", "SPINE", "SPINE_TL", "THORAX"]
DocSpecies = Literal["canine", "feline"]

router = APIRouter(
    prefix="/api/v1/rag",
    tags=["rag"],
    dependencies=[Depends(require_auth)],
)


class RagDocumentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    section: str = Field(default="Custom", max_length=200)
    # Long sources are split into chunks on upload (#100).
    passage: str = Field(min_length=1, max_length=50_000)
    keywords: list[str] = Field(default_factory=list)
    source_id: str | None = None
    # Default false — do not claim clinical approved KB unless explicitly set.
    approved: bool = False
    # Optional manual source card. Omitted = tags are inferred (app.rag.source_cards);
    # [] = explicitly general (eligible for every case).
    regions: list[DocRegion] | None = None
    species: list[DocSpecies] | None = None


class RagBulkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    documents: list[RagDocumentCreate] = Field(min_length=1, max_length=500)


class RagBulkResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    added: int
    source_ids: list[str]
    count: int
    note: str = (
        "Bulk ingest into the RAG vector store. approved=false by default. "
        "Not clinical evidence."
    )


class RagReindexResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    count: int
    method: str
    index_path: str | None
    note: str = "Seed corpus re-embedded into the RAG vector store."


class RagDocumentResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    title: str
    section: str
    count: int
    approved: bool = False
    regions: list[str] = Field(default_factory=list)
    species: list[str] = Field(default_factory=list)
    summary: str = ""
    tag_source: str = ""
    chunks: int = 1


class RagCardUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    regions: list[DocRegion]
    species: list[DocSpecies]


class RagRetagResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    retagged: int
    skipped_manual: int
    uses_llm: bool


def _store(container: AppContainer) -> VectorStore:
    if container.vector_store is None:
        raise HTTPException(status_code=409, detail="Vector store unavailable (lexical RAG mode).")
    return container.vector_store


def _tagger(container: AppContainer) -> SourceCardTagger:
    return getattr(container, "rag_card_tagger", None) or SourceCardTagger()


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
            "Hash-embedding cosine RAG; vectors stored in ChromaDB (or a JSON file). "
            "Not clinical evidence."
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
    store = container.vector_store
    if store is not None:
        url = getattr(store, "url", None)
        path = url or (str(store.path) if store.path is not None else None)
    return RagReindexResponse(count=count, method=container.rag_method, index_path=path)


class RagCustomDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    title: str
    section: str
    passage: str
    keywords: list[str]
    approved: bool = False
    regions: list[str] = Field(default_factory=list)
    species: list[str] = Field(default_factory=list)
    summary: str = ""
    # seed | manual | rules | llm | none ("" = uploaded before source cards existed)
    tag_source: str = ""
    chunks: int = 1


def _custom(chunks: list[IndexedDoc]) -> RagCustomDocument:
    """One row per uploaded source; the passage is the chunks joined back together."""
    d = chunks[0]
    return RagCustomDocument(
        source_id=d.source_key,
        title=d.title,
        section=d.section,
        passage="\n\n".join(c.passage for c in chunks),
        keywords=list(d.keywords),
        approved=bool(d.approved),
        regions=list(d.regions),
        species=list(d.species),
        summary=d.summary,
        tag_source=d.tag_source,
        chunks=len(chunks),
    )


@router.get("/documents", response_model=list[RagCustomDocument])
def list_custom_rag_documents(
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_RAG_ADMIN)),
) -> list[RagCustomDocument]:
    """Sources added through POST /documents (seed corpus excluded), so the UI can list them."""
    if container.vector_store is None:
        return []
    return [_custom(chunks) for chunks in container.vector_store.sources(prefix="custom-")]


@router.post("/documents", response_model=RagDocumentResponse, status_code=201)
def add_rag_document(
    payload: RagDocumentCreate,
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_RAG_ADMIN)),
) -> RagDocumentResponse:
    store = _store(container)
    source_id = payload.source_id or f"custom-{uuid4().hex[:10]}"
    card = _tagger(container).card(
        title=payload.title,
        section=payload.section,
        passage=payload.passage,
        keywords=payload.keywords,
        regions=payload.regions,
        species=payload.species,
    )
    doc = store.add_document(
        source_id=source_id,
        title=payload.title,
        section=payload.section,
        passage=payload.passage,
        keywords=payload.keywords,
        approved=payload.approved,
        regions=card.regions,
        species=card.species,
        summary=card.summary,
        tag_source=card.tag_source,
    )
    return RagDocumentResponse(
        source_id=doc.source_key,
        title=doc.title,
        section=doc.section,
        count=len(store),
        approved=doc.approved,
        regions=list(doc.regions),
        species=list(doc.species),
        summary=doc.summary,
        tag_source=doc.tag_source,
        chunks=doc.chunk_count,
    )


@router.put("/documents/{source_id}/card", response_model=RagCustomDocument)
def update_rag_document_card(
    source_id: str,
    payload: RagCardUpdate,
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_RAG_ADMIN)),
) -> RagCustomDocument:
    """Admin correction of an uploaded source's region / species tags (wins over inferred tags)."""
    store = _store(container)
    chunks = store.source_chunks(source_id)
    if not chunks or not source_id.startswith("custom-"):
        raise HTTPException(status_code=404, detail="Custom knowledge-base source not found.")
    store.set_card(
        source_id,
        regions=[r for r in DOC_REGIONS if r in set(payload.regions)],
        species=sorted(set(payload.species)),
        summary=chunks[0].summary,
        tag_source="manual",
    )
    return _custom(store.source_chunks(source_id))


@router.post("/documents/retag", response_model=RagRetagResponse)
def retag_rag_documents(
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_RAG_ADMIN)),
) -> RagRetagResponse:
    """Rebuild the card of every uploaded source except admin-tagged ones (for sources
    uploaded before cards existed, or after enabling VETMIND_RAG_CARD_LLM)."""
    store = _store(container)
    tagger = _tagger(container)
    retagged = skipped = 0
    for chunks in store.sources(prefix="custom-"):
        doc = chunks[0]
        if doc.tag_source == "manual":
            skipped += 1
            continue
        full_text = " ".join(c.passage for c in chunks)
        card = tagger.card(title=doc.title, section=doc.section, passage=full_text, keywords=doc.keywords)
        store.set_card(
            doc.source_key, regions=card.regions, species=card.species, summary=card.summary, tag_source=card.tag_source
        )
        retagged += 1
    return RagRetagResponse(retagged=retagged, skipped_manual=skipped, uses_llm=tagger.uses_llm)


@router.post("/documents/bulk", response_model=RagBulkResponse, status_code=201)
def add_rag_documents_bulk(
    payload: RagBulkCreate,
    container: AppContainer = Depends(get_container),
    _auth=Depends(require_capability(CAP_RAG_ADMIN)),
) -> RagBulkResponse:
    store = _store(container)
    rows = [
        {
            "source_id": d.source_id,
            "title": d.title,
            "section": d.section,
            "passage": d.passage,
            "keywords": d.keywords,
            "approved": d.approved,
            "regions": d.regions,
            "species": d.species,
        }
        for d in payload.documents
    ]
    added = store.add_documents_bulk(rows, default_approved=False, tagger=_tagger(container))
    return RagBulkResponse(
        added=len(added),
        source_ids=[d.source_key for d in added],
        count=len(store),
    )
