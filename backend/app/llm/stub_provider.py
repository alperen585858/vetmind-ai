"""Deterministic test/demo LLM provider — proves LLMGateway interchangeability.

Not a real external API. Not clinically validated.
"""

from uuid import uuid4

from app.llm.interfaces import LLMRequest, LLMResponse
from app.llm.rag_grounding import deterministic_used_subset
from app.schemas.enums import ReportStatus, SourceKind
from app.schemas.report import DraftReport, GenerationMetadata, ReportSection

STUB_BANNER = (
    "DETERMINISTIC STUB LLM DRAFT — interchangeability test provider. "
    "Not clinically validated. Not an external LLM API."
)


class DeterministicStubLLMProvider:
    """Second independent LLMProvider implementation for substitution tests."""

    provider_id = "stub-llm"
    model_id = "deterministic-stub-report-v1"
    model_version = "0.1.0"

    def generate(self, request: LLMRequest) -> LLMResponse:
        gen = request.generation
        cited = [f.finding_id for f in gen.findings]
        n = len(gen.findings)
        body = (
            f"{STUB_BANNER}\n\n"
            f"Stub summary for case={gen.case_id}: "
            f"{n} structured finding(s); modality={gen.modality.value}; "
            f"region={gen.anatomical_region.value}."
        )
        used_passages, used_ids = deterministic_used_subset(
            list(gen.rag_passages),
            max_n=2,
            related_finding_ids=cited[:1] if cited else None,
        )
        report = DraftReport(
            report_id=f"stub-rpt-{uuid4().hex[:12]}",
            case_id=gen.case_id,
            status=ReportStatus.DRAFT,
            generation=GenerationMetadata(
                provider_id=self.provider_id,
                model_id=self.model_id,
                model_version=self.model_version,
                source_kind=SourceKind.MOCK,
                synthetic=True,
                clinically_validated=False,
            ),
            technique=ReportSection(text=f"{STUB_BANNER}\n\nTechnique metadata stub.", cited_finding_ids=[]),
            findings=ReportSection(text=body, cited_finding_ids=cited),
            impression=ReportSection(
                text=f"{STUB_BANNER}\n\nImpression stub — expert review required.",
                cited_finding_ids=cited,
            ),
            recommendations=ReportSection(
                text="Stub recommendation: veterinary radiologist review. Do not use clinically.",
                cited_finding_ids=[],
            ),
            synthetic=True,
            clinically_validated=False,
            rag_citations=used_passages,
            used_passage_ids=used_ids,
            rag_note=(
                "Stub LLM cites a deterministic subset of retrieved passages only "
                "(not clinical evidence)."
                if used_ids
                else (
                    "Deterministic stub LLM draft — interchangeability test provider. "
                    "Not clinically validated."
                )
            ),
        )
        return LLMResponse(
            provider_id=self.provider_id,
            model_id=self.model_id,
            model_version=self.model_version,
            report=report,
            raw_text=body,
        )
