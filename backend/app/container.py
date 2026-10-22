from app.llm.gateway import LLMGateway
from app.llm.mock_provider import MockLLMProvider
from app.models.mock_vision import default_model_registry
from app.orchestration.orchestrator import AIOrchestrator
from app.routing.capabilities import default_capabilities
from app.routing.model_router import ModelRouter
from app.routing.scenario_policy import ScenarioRoutingPolicy
from app.services.case_service import CaseService
from app.services.dicom_service import DicomService
from app.services.repository import CaseRepository, InMemoryCaseRepository, build_repository
from app.settings import Settings, load_settings
from app.validation.report_validator import ReportValidator


class AppContainer:
    def __init__(
        self,
        repo: CaseRepository | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or load_settings()
        # Explicit repo wins (tests inject InMemory). Otherwise use settings factory.
        self.repo = repo if repo is not None else build_repository(self.settings)
        self.storage_backend = (
            "memory"
            if isinstance(self.repo, InMemoryCaseRepository)
            else self.settings.storage_backend
        )
        self.router = ModelRouter(capabilities=default_capabilities())
        self.scenario_policy = ScenarioRoutingPolicy()
        self.models = default_model_registry()
        self.llm = LLMGateway(MockLLMProvider())
        self.validator = ReportValidator()
        self.orchestrator = AIOrchestrator(
            self.router,
            self.models,
            self.llm,
            self.validator,
            scenario_policy=self.scenario_policy,
        )
        self.cases = CaseService(self.repo, self.orchestrator, self.validator)
        self.dicom = DicomService(self.repo)
