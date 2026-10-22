from app.llm.interfaces import LLMProvider, LLMRequest, LLMResponse
from app.schemas.case import CaseRecord
from app.schemas.findings import StructuredFindings
from app.schemas.report import DraftReport


class LLMGateway:
    """Provider-independent gateway. Swap MockLLMProvider for a cloud or self-hosted provider later."""

    def __init__(self, provider: LLMProvider) -> None:
        self._provider = provider

    @property
    def provider_id(self) -> str:
        return self._provider.provider_id

    def set_provider(self, provider: LLMProvider) -> None:
        self._provider = provider

    def generate_draft(self, case: CaseRecord, findings: StructuredFindings) -> DraftReport:
        response: LLMResponse = self._provider.generate(LLMRequest(case=case, findings=findings))
        return response.report
