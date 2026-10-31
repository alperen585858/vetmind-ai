from app.llm.interfaces import (
    LLMFindingRef,
    LLMGenerationInput,
    LLMProvider,
    LLMProviderError,
    LLMRequest,
    LLMResponse,
    RevisionContext,
)
from app.llm.privacy import redact_personal_data
from app.rag.retriever import RagRetriever
from app.schemas.case import CaseRecord
from app.schemas.findings import StructuredFindings
from app.schemas.report import DraftReport


def build_rag_query(case: CaseRecord, findings: StructuredFindings) -> str:
    parts = [
        case.species.value,
        case.modality.value,
        case.anatomical_region.value,
        case.clinical_history or "",
    ]
    for f in findings.findings:
        parts.append(f.finding_code)
        parts.append(f.description)
        parts.append(f.anatomical_location)
    if case.document_context and case.document_context.combined_text_preview:
        parts.append(case.document_context.combined_text_preview[:500])
    return " ".join(p for p in parts if p)


_STRUCTURED_HISTORY_LABELS = (
    ("complaint", "Şikâyet"),
    ("onset", "Başlangıç"),
    ("course", "Seyir"),
    ("medications", "İlaçlar"),
    ("relevant_history", "İlgili öykü"),
)


def _compose_history(case: CaseRecord) -> str:
    parts = [case.clinical_history.strip()] if case.clinical_history and case.clinical_history.strip() else []
    structured = case.clinical_history_structured
    if structured is not None:
        for attr, label in _STRUCTURED_HISTORY_LABELS:
            value = getattr(structured, attr)
            if value and value.strip():
                parts.append(f"{label}: {value.strip()}")
    return "\n".join(parts)


def build_generation_input(
    case: CaseRecord,
    findings: StructuredFindings,
    *,
    rag_passages: list | None = None,
) -> LLMGenerationInput:
    """Project case/findings into a minimal outbound DTO (no quarantine/credentials/PII names)."""
    doc_count = 0
    if case.document_context is not None:
        doc_count = len(case.document_context.documents)
    redacted = redact_personal_data(
        _compose_history(case),
        known=[(case.patient_name, "[HASTA]"), (case.referring_clinic, "[KLİNİK]")],
    )
    return LLMGenerationInput(
        case_id=case.case_id,
        species=case.species,
        breed=case.breed,
        patient_age_years=case.patient_age_years,
        modality=case.modality,
        anatomical_region=case.anatomical_region,
        clinical_history=redacted.text or None,
        redaction_counts=redacted.counts,
        findings=[
            LLMFindingRef(
                finding_id=f.finding_id,
                finding_code=f.finding_code,
                description=f.description,
                anatomical_location=f.anatomical_location,
                finding_status=f.finding_status,
                source_model=f.source_model,
            )
            for f in findings.findings
        ],
        findings_source_kind=findings.source_kind,
        findings_model_id=findings.source_model_id,
        findings_model_version=findings.source_model_version,
        execution_status=findings.execution_status,
        no_findings_returned=findings.no_findings_returned,
        document_context_file_count=doc_count,
        rag_passages=list(rag_passages or []),
        rag_is_clinical_validation=False,
    )


class LLMGateway:
    """Provider-independent gateway. Optional RAG retriever enriches the draft."""

    def __init__(
        self,
        provider: LLMProvider,
        rag: RagRetriever | None = None,
        *,
        rag_top_k: int = 4,
    ) -> None:
        self._provider = provider
        self._rag = rag
        self._rag_top_k = rag_top_k

    @property
    def provider_id(self) -> str:
        return self._provider.provider_id

    def set_provider(self, provider: LLMProvider) -> None:
        self._provider = provider

    def set_rag(self, rag: RagRetriever | None) -> None:
        self._rag = rag

    def generate_draft(self, case: CaseRecord, findings: StructuredFindings) -> DraftReport:
        passages = []
        if self._rag is not None:
            query = build_rag_query(case, findings)
            passages = self._rag.retrieve(query, top_k=self._rag_top_k)
        generation = build_generation_input(case, findings, rag_passages=passages)
        try:
            response: LLMResponse = self._provider.generate(
                LLMRequest(generation=generation)
            )
        except LLMProviderError:
            # Do not fall back to a mock draft after a real provider failure.
            raise
        return response.report

    def revise_draft(
        self,
        case: CaseRecord,
        findings: StructuredFindings,
        previous: DraftReport,
        expert_note: str,
    ) -> DraftReport:
        """Regenerate the draft with the expert's revision request; same findings, fresh retrieval."""
        passages = []
        if self._rag is not None:
            passages = self._rag.retrieve(build_rag_query(case, findings), top_k=self._rag_top_k)
        generation = build_generation_input(case, findings, rag_passages=passages)
        known = [(case.patient_name, "[HASTA]"), (case.referring_clinic, "[KLİNİK]")]
        revision = RevisionContext(
            previous_sections={
                k: redact_personal_data(getattr(previous, k).text, known=known).text
                for k in ("technique", "findings", "impression", "recommendations")
            },
            expert_note=redact_personal_data(expert_note, known=known).text,
        )
        response = self._provider.generate(LLMRequest(generation=generation, revision=revision))
        return response.report
