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

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.llm.http_provider import _report_provenance_from_findings
from app.llm.interfaces import LLMGenerationInput, LLMMalformedResponseError, LLMRequest
from app.llm.prompts import CitationAliases
from app.schemas.enums import ModelExecutionStatus, ReportStatus
from app.schemas.report import DifferentialDiagnosis, DraftReport, GenerationMetadata, ReportSection

SECTION_KEYS = ("technique", "findings", "impression", "recommendations")

REPORT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [*SECTION_KEYS, "differentials"],
    "properties": {
        "technique": {"type": "string", "description": "Species, modality, region, analysis status."},
        "findings": {"type": "string", "description": "One line per imaging finding, each cited [F#]."},
        "impression": {"type": "string", "description": "Ranked interpretation and differentials, cited."},
        "recommendations": {"type": "string", "description": "Next steps; ends with radiologist review."},
        "differentials": {
            "type": "array",
            "description": "2-5 ranked differential diagnoses; empty when there are no findings.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "likelihood", "supporting", "against", "citations"],
                "properties": {
                    "name": {"type": "string"},
                    "likelihood": {"type": "string", "enum": ["high", "moderate", "low"]},
                    "supporting": {"type": "array", "items": {"type": "string"}},
                    "against": {"type": "array", "items": {"type": "string"}},
                    "citations": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Markers such as F1 or S2 that support this differential.",
                    },
                },
            },
        },
    },
}


DIFFERENTIALS_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["differentials"],
    "properties": {"differentials": REPORT_JSON_SCHEMA["properties"]["differentials"]},
}


def parse_differentials_payload(payload: str | dict[str, Any]) -> list["DifferentialWire"]:
    """Second-step output: {"differentials": [...]}; bad items are dropped."""
    data = _load_json_object(payload)
    items = data.get("differentials")
    return ReportWire._drop_bad_differentials(items)  # type: ignore[call-arg]


def report_json_schema(with_differentials: bool = True) -> dict[str, Any]:
    if with_differentials:
        return REPORT_JSON_SCHEMA
    props = {k: v for k, v in REPORT_JSON_SCHEMA["properties"].items() if k != "differentials"}
    return {**REPORT_JSON_SCHEMA, "required": list(SECTION_KEYS), "properties": props}


# Matches one bracket group of markers: [F1], [S2], [F1, S2].
MARKER_GROUP_RE = re.compile(r"\[\s*([FS]\d+(?:\s*[,;]\s*[FS]\d+)*)\s*\]")
_PAREN_MARKERS_RE = re.compile(r"\(\s*([FS]\d+(?:\s*[,;]\s*[FS]\d+)*)\s*\)")
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


# Used when a model leaves a section blank (typical for no-findings / failed analysis).
# Blank sections must never read as "nothing abnormal".
EMPTY_SECTION_TEXT = {
    "tr": {
        "technique": "Teknik bilgi model tarafından üretilmedi.",
        "findings": "Otomatik görüntü analizi raporlanabilir yapılandırılmış bulgu sunmadı. "
        "Bu, çalışmanın normal olduğu anlamına gelmez.",
        "impression": "Otomatik yorum üretilmedi; tüm çalışmanın uzman radyolog tarafından manuel incelenmesi gerekir.",
        "recommendations": "Görüntülerin uzman veteriner radyolog tarafından tam olarak incelenmesi gereklidir.",
    },
    "en": {
        "technique": "Technique was not provided by the model.",
        "findings": "Automated image analysis returned no reportable structured findings. "
        "This does not mean the study is normal.",
        "impression": "No automated impression was produced; full manual review by a radiologist is required.",
        "recommendations": "Full review of the images by a veterinary radiologist is required.",
    },
}


_LIKELIHOOD = {
    "high": "high", "yüksek": "high", "yuksek": "high", "likely": "high",
    "moderate": "moderate", "medium": "moderate", "orta": "moderate", "possible": "moderate",
    "low": "low", "düşük": "low", "dusuk": "low", "unlikely": "low",
}


# When there are no findings to report and the model leaves "findings" blank, this is the
# correct section content — written by code, not a placeholder for missing model work.
NO_FINDINGS_TEXT = {
    "tr": "Görüntü modeli raporlanabilir yapılandırılmış bulgu döndürmedi (analiz durumu: {status}). "
    "Bu, çalışmanın normal olduğu anlamına gelmez; görüntülerin tamamı uzman radyolog tarafından incelenmelidir.",
    "en": "The imaging model returned no reportable structured findings (analysis status: {status}). "
    "This does not mean the study is normal; the full study must be reviewed by a radiologist.",
}

# When the model leaves "findings" blank but structured findings exist, the section is
# rebuilt from them (a restatement with [F#] citations, not new claims). The first line
# marks it so grounding can tell the reviewer the model did not write it.
AUTO_FINDINGS_HEADER = {
    "tr": "Otomatik bulgu listesi (model bu bölümü yazmadı; görüntü modelinin bulgularından oluşturuldu):",
    "en": "Automatic finding list (the model did not write this section; built from the imaging model's findings):",
}
_STATUS_LABEL = {
    "tr": {"suspected": "şüpheli", "possible": "olası", "uncertain": "belirsiz", "not_assessed": "değerlendirilmedi"},
    "en": {"suspected": "suspected", "possible": "possible", "uncertain": "uncertain", "not_assessed": "not assessed"},
}


def auto_findings_text(gen: LLMGenerationInput, aliases: CitationAliases, language: str) -> str:
    lang = language if language in AUTO_FINDINGS_HEADER else "en"
    by_id = {f.finding_id: f for f in gen.findings}
    lines = [AUTO_FINDINGS_HEADER[lang]]
    for alias, finding_id in aliases.findings.items():
        f = by_id[finding_id]
        status = _STATUS_LABEL[lang].get(f.finding_status.value, f.finding_status.value)
        lines.append(f"- {f.anatomical_location}: {f.description} ({status}) [{alias}]")
    return "\n".join(lines)


class DifferentialWire(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    likelihood: str = "moderate"
    supporting: list[str] = Field(default_factory=list)
    against: list[str] = Field(default_factory=list)
    citations: list[str] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("differential name must not be empty")
        return value.strip()

    @field_validator("likelihood", mode="before")
    @classmethod
    def _likelihood(cls, value: object) -> str:
        return _LIKELIHOOD.get(str(value or "").strip().lower(), "moderate")

    @field_validator("supporting", "against", mode="before")
    @classmethod
    def _phrases(cls, value: object) -> list[str]:
        if isinstance(value, str):
            value = [value]
        return [str(v).strip() for v in (value or []) if str(v).strip()]

    @field_validator("citations", mode="before")
    @classmethod
    def _citations(cls, value: object) -> list[str]:
        """Accept ["F1", "S2"], ["[F1, S2]"] or "F1, S2"; keep F#/S# tokens in order."""
        raw = " ".join(value) if isinstance(value, list) else str(value or "")
        return list(dict.fromkeys(re.findall(r"\b[FS]\d+\b", raw)))


class ReportWire(BaseModel):
    model_config = ConfigDict(extra="ignore")

    technique: str = ""
    findings: str = ""
    impression: str = ""
    recommendations: str = ""
    differentials: list[DifferentialWire] = Field(default_factory=list)

    @field_validator("differentials", mode="before")
    @classmethod
    def _drop_bad_differentials(cls, value: object) -> list:
        """A malformed differential item is dropped, not allowed to fail the whole draft."""
        if not isinstance(value, list):
            return []
        good = []
        for item in value:
            try:
                good.append(DifferentialWire.model_validate(item))
            except ValidationError:
                continue
        return good

    @field_validator(*SECTION_KEYS, mode="before")
    @classmethod
    def _strip(cls, value: object) -> str:
        if value is None:
            return ""
        if not isinstance(value, str):
            raise ValueError("section must be a string")
        # "(F1)" / "(F1, S2)" → "[F1]" / "[F1, S2]": same citation, the form our checks read.
        return _PAREN_MARKERS_RE.sub(r"[\1]", value).strip()

    @model_validator(mode="after")
    def _not_all_empty(self) -> "ReportWire":
        if not any(getattr(self, k) for k in SECTION_KEYS):
            raise ValueError("all report sections are empty")
        return self

    def empty_sections(self) -> list[str]:
        return [k for k in SECTION_KEYS if not getattr(self, k)]


def extract_markers(text: str) -> list[str]:
    """Return citation aliases in first-seen order, e.g. ['F1', 'S2']."""
    seen: dict[str, None] = {}
    for group in MARKER_GROUP_RE.findall(text):
        for alias in re.split(r"\s*[,;]\s*", group):
            seen.setdefault(alias.strip(), None)
    return list(seen)


def _load_json_object(payload: str | dict[str, Any]) -> dict[str, Any]:
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
    return payload


def parse_report_payload(payload: str | dict[str, Any]) -> ReportWire:
    """Accept a dict (tool call input) or model text (optionally fenced) and validate it."""
    payload = _load_json_object(payload)
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
    language: str = "tr",
    pipeline_steps: list[str] | None = None,
) -> DraftReport:
    gen = request.generation
    fallback = EMPTY_SECTION_TEXT.get(language, EMPTY_SECTION_TEXT["en"])
    # Hard rule, not left to the prompt: no imaging findings → no differential list.
    no_findings = (
        gen.no_findings_returned
        or not gen.findings
        or gen.execution_status in {ModelExecutionStatus.FAILED, ModelExecutionStatus.UNSUPPORTED}
    )

    def section(key: str) -> ReportSection:
        text = getattr(wire, key)
        if not text and key == "findings" and gen.findings and not no_findings:
            text = auto_findings_text(gen, aliases, language)
        if not text and key == "findings" and no_findings:
            text = NO_FINDINGS_TEXT.get(language, NO_FINDINGS_TEXT["en"]).format(status=gen.execution_status.value)
        text = text or fallback[key]
        cited = [aliases.findings[a] for a in extract_markers(text) if a in aliases.findings]
        return ReportSection(text=text, cited_finding_ids=cited)

    # Passages the draft actually cites ([S#] in any section), in first-cited order.
    # rag_citations keeps every retrieved passage so S# numbering stays reconstructible
    # (feedback export); the UI shows only used_passage_ids.
    differentials = [] if no_findings else [
        DifferentialDiagnosis(
            name=d.name,
            likelihood=d.likelihood,
            supporting=d.supporting,
            against=d.against,
            citations=d.citations,
            finding_ids=[aliases.findings[a] for a in d.citations if a in aliases.findings],
        )
        for d in wire.differentials
    ]
    diff_markers = " ".join(f"[{a}]" for d in differentials for a in d.citations)
    all_text = "\n".join(getattr(wire, k) for k in SECTION_KEYS) + "\n" + diff_markers
    cited_sources = list(
        dict.fromkeys(aliases.sources[a] for a in extract_markers(all_text) if a in aliases.sources)
    )
    rag_note = DraftReport.model_fields["rag_note"].default
    if gen.rag_passages and not cited_sources:
        rag_note += " Taslak hiçbir kaynak pasajına atıf yapmadı; listelenenler yalnızca erişim sonuçlarıdır."

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
            pipeline_steps=list(pipeline_steps or []),
        ),
        technique=section("technique"),
        findings=section("findings"),
        impression=section("impression"),
        recommendations=section("recommendations"),
        synthetic=synthetic,
        clinically_validated=False,
        rag_citations=list(gen.rag_passages),
        used_passage_ids=cited_sources,
        rag_note=rag_note,
        citation_map=aliases.as_map(),
        differentials=differentials,
    )
