"""Generic HTTP LLM provider adapter.

Posts ``LLMGenerationInput`` to a configured endpoint. Does not claim compatibility
with arbitrary vendor APIs — the remote service must accept this wire contract and
return the validated response shape below.
"""

from __future__ import annotations

from typing import Any, Optional
from uuid import uuid4

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.llm.interfaces import (
    LLMErrorKind,
    LLMMalformedResponseError,
    LLMProviderError,
    LLMRequest,
    LLMResponse,
    LLMTimeoutError,
    LLMUnavailableError,
)
from app.schemas.enums import ReportStatus, SourceKind
from app.schemas.report import DraftReport, GenerationMetadata, ReportSection


class HttpLLMWireResponse(BaseModel):
    """Strict response contract for the generic HTTP LLM adapter."""

    model_config = ConfigDict(extra="forbid")

    technique: str
    findings: str
    impression: str
    recommendations: str
    cited_finding_ids: list[str] = Field(default_factory=list)
    report_id: Optional[str] = None


class HttpLLMProvider:
    """Optional remote draft generator. No network I/O at construction time."""

    def __init__(
        self,
        *,
        endpoint: str,
        provider_id: str = "http-llm",
        model_id: str = "generic-http-llm",
        model_version: str = "0.1.0",
        api_key: str | None = None,
        timeout_s: float = 30.0,
    ) -> None:
        self.provider_id = provider_id
        self.model_id = model_id
        self.model_version = model_version
        self._endpoint = endpoint.rstrip("/")
        self._api_key = api_key
        self._timeout_s = timeout_s

    def generate(self, request: LLMRequest) -> LLMResponse:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        payload = {
            "provider_id": self.provider_id,
            "model_id": self.model_id,
            "model_version": self.model_version,
            "instructions": request.instructions,
            "generation": request.generation.model_dump(mode="json"),
            "note": (
                "Generic VetMind HTTP LLM wire format. "
                "Not a guarantee of OpenAI/Anthropic/etc. compatibility."
            ),
        }
        try:
            with httpx.Client(timeout=self._timeout_s) as client:
                res = client.post(self._endpoint, json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            raise LLMTimeoutError("LLM HTTP provider timed out.") from exc
        except httpx.HTTPError as exc:
            raise LLMUnavailableError(
                f"LLM HTTP provider unavailable: {type(exc).__name__}"
            ) from exc

        if res.status_code >= 500:
            raise LLMUnavailableError(f"LLM HTTP provider returned HTTP {res.status_code}.")
        if res.status_code >= 400:
            raise LLMProviderError(
                f"LLM HTTP provider returned HTTP {res.status_code}.",
                kind=LLMErrorKind.UNAVAILABLE,
            )

        try:
            body: Any = res.json()
        except ValueError as exc:
            raise LLMMalformedResponseError("LLM HTTP response is not JSON.") from exc

        try:
            wire = HttpLLMWireResponse.model_validate(body)
        except ValidationError as exc:
            raise LLMMalformedResponseError(
                f"LLM HTTP response failed schema validation: {exc.errors()[0]['msg']}"
            ) from exc

        cited = list(wire.cited_finding_ids) or [f.finding_id for f in request.generation.findings]
        report = DraftReport(
            report_id=wire.report_id or f"http-rpt-{uuid4().hex[:12]}",
            case_id=request.generation.case_id,
            status=ReportStatus.DRAFT,
            generation=GenerationMetadata(
                provider_id=self.provider_id,
                model_id=self.model_id,
                model_version=self.model_version,
                source_kind=SourceKind.REAL,
                synthetic=False,
                clinically_validated=False,
            ),
            technique=ReportSection(text=wire.technique, cited_finding_ids=[]),
            findings=ReportSection(text=wire.findings, cited_finding_ids=cited),
            impression=ReportSection(text=wire.impression, cited_finding_ids=cited),
            recommendations=ReportSection(text=wire.recommendations, cited_finding_ids=[]),
            synthetic=False,
            clinically_validated=False,
            rag_citations=list(request.generation.rag_passages),
        )
        return LLMResponse(
            provider_id=self.provider_id,
            model_id=self.model_id,
            model_version=self.model_version,
            report=report,
            raw_text=None,
        )
