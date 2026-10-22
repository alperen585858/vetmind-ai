from app.auth.security import DEMO_USERS, AuthSettings
from app.llm.gateway import LLMGateway
from app.llm.mock_provider import MockLLMProvider
from app.models.http_vision import build_optional_http_vision
from app.models.mock_vision import default_model_registry
from app.orchestration.orchestrator import AIOrchestrator
from app.rag.embedding_retriever import EmbeddingRagRetriever
from app.rag.retriever import LexicalRagRetriever
from app.rag.vector_store import JsonVectorStore
from app.routing.capabilities import ModelCapability, default_capabilities
from app.routing.model_router import ModelRouter
from app.routing.scenario_policy import ScenarioRoutingPolicy
from app.schemas.enums import AnatomicalRegion, Modality, Species
from app.services.case_service import CaseService
from app.services.dicom_service import DicomService
from app.services.document_service import DocumentService
from app.services.repository import CaseRepository, InMemoryCaseRepository, build_repository
from app.settings import Settings, load_settings
from app.storage.quarantine import QuarantineStore
from app.validation.report_validator import ReportValidator
from app.workers.job_backend import build_job_backend


class AppContainer:
    def __init__(
        self,
        repo: CaseRepository | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.settings = settings or load_settings()
        self.repo = repo if repo is not None else build_repository(self.settings)
        self.storage_backend = (
            "memory"
            if isinstance(self.repo, InMemoryCaseRepository)
            else self.settings.storage_backend
        )
        self.quarantine = QuarantineStore(self.settings.quarantine_root)

        if self.settings.rag_backend == "lexical":
            self.rag = LexicalRagRetriever()
            self.rag_method = "lexical_token_overlap"
            self.vector_store = None
        else:
            # Tests with memory storage: keep index in-memory (no disk) unless path set explicitly.
            index_path = None if self.storage_backend == "memory" else self.settings.rag_index_path
            self.vector_store = JsonVectorStore(path=index_path)
            self.vector_store.load()
            self.rag = EmbeddingRagRetriever(store=self.vector_store)
            self.rag_method = "hash_embedding_cosine"

        capabilities = list(default_capabilities())
        self.models = default_model_registry()
        remote = build_optional_http_vision(
            endpoint=self.settings.vision_endpoint,
            model_id=self.settings.vision_model_id,
            api_key=self.settings.vision_api_key,
        )
        if remote is not None:
            self.models[remote.model_id] = remote
            canine_feline = frozenset({Species.CANINE, Species.FELINE})
            capabilities.insert(
                0,
                ModelCapability(
                    model_id=remote.model_id,
                    modalities=frozenset({Modality.MR, Modality.CT, Modality.XR}),
                    regions=frozenset(
                        {
                            AnatomicalRegion.BRAIN,
                            AnatomicalRegion.CERVICAL,
                            AnatomicalRegion.THORAX,
                        }
                    ),
                    species=canine_feline,
                    priority=1,
                    description="Remote HTTP Vision/VLM adapter",
                ),
            )

        self.router = ModelRouter(capabilities=capabilities)
        self.scenario_policy = ScenarioRoutingPolicy()
        self.llm = LLMGateway(MockLLMProvider(), rag=self.rag)
        self.validator = ReportValidator()
        self.orchestrator = AIOrchestrator(
            self.router,
            self.models,
            self.llm,
            self.validator,
            scenario_policy=self.scenario_policy,
        )
        self.job_backend = build_job_backend(
            backend=self.settings.job_backend,
            delay_ms=self.settings.async_analyze_delay_ms,
            redis_url=self.settings.redis_url,
        )
        self.cases = CaseService(
            self.repo,
            self.orchestrator,
            self.validator,
            async_delay_ms=self.settings.async_analyze_delay_ms,
            job_backend=self.job_backend,
        )
        self.dicom = DicomService(self.repo, self.quarantine)
        self.documents = DocumentService(self.repo, self.quarantine)
        self.auth = AuthSettings(
            enabled=self.settings.auth_enabled,
            api_key=self.settings.auth_api_key,
            jwt_secret=self.settings.jwt_secret,
            jwt_ttl_seconds=self.settings.jwt_ttl_seconds,
            users=DEMO_USERS,
        )
