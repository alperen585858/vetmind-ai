"""Optional RAG contracts — lexical demo retrieval, not clinical evidence."""

from pydantic import BaseModel, ConfigDict, Field

RAG_SCHEMA_VERSION = "1.0.0"


class RagPassage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str
    title: str
    section: str
    passage: str
    # Retrieval similarity / overlap only — never clinical confidence.
    score: float = Field(ge=0.0, le=1.0)
    keywords: list[str] = Field(default_factory=list)
    # Optional finding links when the draft explicitly ties a passage to findings.
    related_finding_ids: list[str] = Field(default_factory=list)


class RagSearchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = RAG_SCHEMA_VERSION
    query: str
    hits: list[RagPassage]
    method: str = "lexical_token_overlap"
    note: str = (
        "Demo RAG: keyword overlap over seeded veterinary neurology and breed morphology "
        "references. "
        "Not embeddings, not Qdrant, not clinically validated evidence."
    )
