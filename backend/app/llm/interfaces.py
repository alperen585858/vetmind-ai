from enum import Enum
from typing import Optional, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    Modality,
    ModelExecutionStatus,
    SourceKind,
    Species,
)
from app.schemas.rag import RagPassage
from app.schemas.report import DraftReport


class LLMErrorKind(str, Enum):
    TIMEOUT = "timeout"
    MALFORMED_RESPONSE = "malformed_response"
    UNAVAILABLE = "unavailable"
    CONFIG = "config"
    UNKNOWN = "unknown"


class LLMProviderError(RuntimeError):
    """Typed provider failure. Callers must not fall back to a mock draft silently."""

    def __init__(self, message: str, *, kind: LLMErrorKind = LLMErrorKind.UNKNOWN) -> None:
        super().__init__(message)
        self.kind = kind


class LLMTimeoutError(LLMProviderError):
    def __init__(self, message: str = "LLM provider timed out.") -> None:
        super().__init__(message, kind=LLMErrorKind.TIMEOUT)


class LLMMalformedResponseError(LLMProviderError):
    def __init__(self, message: str = "LLM provider returned a malformed response.") -> None:
        super().__init__(message, kind=LLMErrorKind.MALFORMED_RESPONSE)


class LLMUnavailableError(LLMProviderError):
    def __init__(self, message: str = "LLM provider unavailable.") -> None:
        super().__init__(message, kind=LLMErrorKind.UNAVAILABLE)


class LLMConfigError(LLMProviderError):
    def __init__(self, message: str) -> None:
        super().__init__(message, kind=LLMErrorKind.CONFIG)


class LLMFindingRef(BaseModel):
    """Minimal finding projection for outbound LLM generation."""

    model_config = ConfigDict(extra="forbid")

    finding_id: str
    finding_code: str
    description: str
    anatomical_location: str
    finding_status: FindingStatus
    source_model: str


class LLMGenerationInput(BaseModel):
    """Safe outbound generation context — no CaseRecord, quarantine paths, or credentials.

    ``findings`` are clinical-model outputs. ``rag_passages`` are retrieval context only
    and must never be treated as clinical validation of those findings.
    """

    model_config = ConfigDict(extra="forbid")

    case_id: str
    species: Species
    modality: Modality
    anatomical_region: AnatomicalRegion
    clinical_history: Optional[str] = None
    findings: list[LLMFindingRef] = Field(default_factory=list)
    findings_source_kind: SourceKind = SourceKind.MOCK
    findings_model_id: Optional[str] = None
    findings_model_version: Optional[str] = None
    execution_status: ModelExecutionStatus
    no_findings_returned: bool = False
    document_context_file_count: int = 0
    rag_passages: list[RagPassage] = Field(default_factory=list)
    rag_is_clinical_validation: bool = False
    note: str = (
        "Minimal LLM generation input. Opaque case_id for traceability only. "
        "findings_source_kind traces imaging provenance separately from rag_passages. "
        "RAG is never clinical validation. Do not send storage paths or credentials."
    )


class LLMRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation: LLMGenerationInput
    instructions: str = Field(
        default="Produce a structured veterinary radiology DRAFT. Never claim clinical validation."
    )


class LLMResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_id: str
    model_id: str
    model_version: str
    report: DraftReport
    raw_text: str | None = None


@runtime_checkable
class LLMProvider(Protocol):
    provider_id: str
    model_id: str
    model_version: str

    def generate(self, request: LLMRequest) -> LLMResponse: ...
