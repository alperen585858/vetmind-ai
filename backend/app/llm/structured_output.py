"""Parse chat-model output into a validated ``DraftReport``.

The model returns four plain-text sections with inline markers ([F1], [S2]).
Citations are derived from those markers rather than trusted from a separate list,
so what the reviewer reads is exactly what gets checked.
"""

from __future__ import annotations

import json
import re
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from app.llm.http_provider import _report_provenance_from_findings
from app.llm.interfaces import LLMMalformedResponseError, LLMRequest
from app.llm.prompts import CitationAliases
from app.schemas.enums import ReportStatus
from app.schemas.report import DraftReport, GenerationMetadata, ReportSection

SECTION_KEYS = ("technique", "findings", "impression", "recommendations")

REPORT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": list(SECTION_KEYS),
    "properties": {
        "technique": {"type": "string", "description": "Species, modality, region, analysis status."},
        "findings": {"type": "string", "description": "One line per imaging finding, each cited [F#]."},
        "impression": {"type": "string", "description": "Ranked interpretation and differentials, cited."},
        "recommendations": {"type": "string", "description": "Next steps; ends with radiologist review."},
    },
}

# Matches one bracket group of markers: [F1], [S2], [F1, S2].
MARKER_GROUP_RE = re.compile(r"\[\s*([FS]\d+(?:\s*[,;]\s*[FS]\d+)*)\s*\]")
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


class ReportWire(BaseModel):
    model_config = ConfigDict(extra="ignore")

    technique: str
    findings: str
    impression: str
    recommendations: str

    @field_validator(*SECTION_KEYS)
    @classmethod
    def _non_empty(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("section must not be empty")
        return value.strip()


def extract_markers(text: str) -> list[str]:
    """Return citation aliases in first-seen order, e.g. ['F1', 'S2']."""
    seen: dict[str, None] = {}
    for group in MARKER_GROUP_RE.findall(text):
        for alias in re.split(r"\s*[,;]\s*", group):
            seen.setdefault(alias.strip(), None)
    return list(seen)


def parse_report_payload(payload: str | dict[str, Any]) -> ReportWire:
    """Accept a dict (tool call input) or model text (optionally fenced) and validate it."""
    if isinstance(payload, str):
        text = _FENCE_RE.sub("", payload.strip())
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise LLMMalformedResponseError("LLM response contains no JSON object.")
        try:
            payload = json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise LLMMalformedResponseError(f"LLM response is not valid JSON: {exc.msg}.") from exc
    if not isinstance(payload, dict):
        raise LLMMalformedResponseError("LLM response JSON must be an object.")
    try:
        return ReportWire.model_validate(payload)
    except ValidationError as exc:
        err = exc.errors()[0]
        loc = ".".join(str(x) for x in err["loc"]) or "response"
        raise LLMMalformedResponseError(
            f"LLM response failed schema validation at '{loc}': {err['msg']}"
        ) from exc


def build_draft_report(
    wire: ReportWire,
    request: LLMRequest,
    aliases: CitationAliases,
    *,
    provider_id: str,
    model_id: str,
    model_version: str,
    prompt_version: str,
) -> DraftReport:
    gen = request.generation

    def section(key: str) -> ReportSection:
        text = getattr(wire, key)
        cited = [aliases.findings[a] for a in extract_markers(text) if a in aliases.findings]
        return ReportSection(text=text, cited_finding_ids=cited)

    report_kind, synthetic = _report_provenance_from_findings(gen.findings_source_kind)
    return DraftReport(
        report_id=f"llm-rpt-{uuid4().hex[:12]}",
        case_id=gen.case_id,
        status=ReportStatus.DRAFT,
        generation=GenerationMetadata(
            provider_id=provider_id,
            model_id=model_id,
            model_version=model_version,
            source_kind=report_kind,
            synthetic=synthetic,
            clinically_validated=False,
            prompt_version=prompt_version,
        ),
        technique=section("technique"),
        findings=section("findings"),
        impression=section("impression"),
        recommendations=section("recommendations"),
        synthetic=synthetic,
        clinically_validated=False,
        rag_citations=list(gen.rag_passages),
        citation_map=aliases.as_map(),
    )
