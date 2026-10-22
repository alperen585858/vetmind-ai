from app.llm.interfaces import LLMProvider, LLMRequest, LLMResponse
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


class LLMGateway:
    """Provider-independent gateway. Optional RAG retriever enriches the mock draft."""

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
        response: LLMResponse = self._provider.generate(
            LLMRequest(case=case, findings=findings, rag_passages=passages)
        )
        return response.report
