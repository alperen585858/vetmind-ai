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

from app.http_policy import llm_http_policy
from app.llm.interfaces import (
    LLMErrorKind,
    LLMMalformedResponseError,
    LLMProviderError,
    LLMRequest,
    LLMResponse,
    LLMTimeoutError,
    LLMUnavailableError,
)
from app.llm.rag_grounding import apply_used_passages_to_report
from app.schemas.enums import ReportStatus, SourceKind
from app.schemas.report import DraftReport, GenerationMetadata, ReportSection


def _report_provenance_from_findings(findings_kind: SourceKind) -> tuple[SourceKind, bool]:
    """HTTP LLM must not label a report REAL when imaging findings are mock/mixed."""
    if findings_kind == SourceKind.REAL:
        return SourceKind.REAL, False
    if findings_kind == SourceKind.MIXED:
        return SourceKind.MIXED, True
    return SourceKind.MOCK, True


class HttpLLMWireResponse(BaseModel):
    """Strict response contract for the generic HTTP LLM adapter."""

    model_config = ConfigDict(extra="forbid")

    technique: str
    findings: str
    impression: str
    recommendations: str
    cited_finding_ids: list[str] = Field(default_factory=list)
    # Optional: passages the remote draft actually used (ISS-RAG-04).
    # Absent/empty → legacy: all retrieved shown with honesty note.
    used_passage_ids: list[str] = Field(default_factory=list)
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
        policy = llm_http_policy(self._timeout_s)
        # No POST retries (non-idempotent). Separate connect vs read timeouts.
        timeout = httpx.Timeout(policy.timeout_s, connect=min(5.0, policy.timeout_s))
        try:
            with httpx.Client(timeout=timeout) as client:
                res = client.post(self._endpoint, json=payload, headers=headers)
        except httpx.TimeoutException as exc:
            raise LLMTimeoutError(
                f"LLM HTTP provider timed out after {policy.timeout_s}s."
            ) from exc
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
        report_kind, synthetic = _report_provenance_from_findings(
            request.generation.findings_source_kind
        )
        report = DraftReport(
            report_id=wire.report_id or f"http-rpt-{uuid4().hex[:12]}",
            case_id=request.generation.case_id,
            status=ReportStatus.DRAFT,
            generation=GenerationMetadata(
                provider_id=self.provider_id,
                model_id=self.model_id,
                model_version=self.model_version,
                source_kind=report_kind,
                synthetic=synthetic,
                clinically_validated=False,
            ),
            technique=ReportSection(text=wire.technique, cited_finding_ids=[]),
            findings=ReportSection(text=wire.findings, cited_finding_ids=cited),
            impression=ReportSection(text=wire.impression, cited_finding_ids=cited),
            recommendations=ReportSection(text=wire.recommendations, cited_finding_ids=[]),
            synthetic=synthetic,
            clinically_validated=False,
        )
        report = apply_used_passages_to_report(
            report,
            list(request.generation.rag_passages),
            list(wire.used_passage_ids) or None,
            related_finding_ids=cited[:1] if cited else None,
        )
        return LLMResponse(
            provider_id=self.provider_id,
            model_id=self.model_id,
            model_version=self.model_version,
            report=report,
            raw_text=None,
        )
