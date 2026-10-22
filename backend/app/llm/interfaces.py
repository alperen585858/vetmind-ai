from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.case import CaseRecord
from app.schemas.findings import StructuredFindings
from app.schemas.rag import RagPassage
from app.schemas.report import DraftReport


class LLMRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case: CaseRecord
    findings: StructuredFindings
    rag_passages: list[RagPassage] = Field(default_factory=list)
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
