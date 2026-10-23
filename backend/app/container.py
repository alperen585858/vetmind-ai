from app.auth.security import DEMO_USERS, AuthSettings
from app.imaging.metadata_prep import MetadataOnlyPreparationPipeline
from app.llm.factory import build_llm_provider
from app.llm.gateway import LLMGateway
from app.models.http_vision import build_optional_http_vision
from app.models.mock_vision import default_model_registry
from app.orchestration.orchestrator import AIOrchestrator
from app.rag.embedding_retriever import EmbeddingRagRetriever
from app.rag.retriever import LexicalRagRetriever
from app.rag.vector_store import JsonVectorStore
from app.routing.capabilities import default_capabilities
from app.routing.execution_policy import ModelExecutionPolicy, parse_vision_execution_mode
from app.routing.model_router import ModelRouter
from app.routing.registry_validation import validate_registry_capabilities
from app.routing.remote_config import remote_capability_from_settings
from app.routing.scenario_policy import ScenarioRoutingPolicy
from app.security.audit import AuditLogger
from app.security.retention import RetentionPolicy
from app.services.case_service import CaseService
from app.services.dicom_service import DicomService
from app.services.document_service import DocumentService
from app.services.repository import CaseRepository, InMemoryCaseRepository, build_repository
from app.settings import Settings, load_settings, validate_security_settings
from app.storage.encryption import encryption_status
from app.storage.malware_scan import build_scanner
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
        validate_security_settings(self.settings)
        self.repo = repo if repo is not None else build_repository(self.settings)
        self.storage_backend = (
            "memory"
            if isinstance(self.repo, InMemoryCaseRepository)
            else self.settings.storage_backend
        )
        self.quarantine = QuarantineStore(
            self.settings.quarantine_root,
            max_file_bytes=25 * 1024 * 1024,
        )
        self.audit = AuditLogger(self.settings.audit_log_path)
        self.encryption = encryption_status(self.settings.encryption_at_rest)
        self.malware_scanner = build_scanner(required=self.settings.malware_scan_required)
        self.retention_policy = RetentionPolicy(
            dicom_days=self.settings.retention_dicom_days,
            temp_hours=self.settings.retention_temp_hours,
            artifacts_days=self.settings.retention_artifacts_days,
            reports_days=self.settings.retention_reports_days,
            logs_days=self.settings.retention_logs_days,
            preserve_approved_reports=True,
        )

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
        remote_cap = remote_capability_from_settings(self.settings)
        if remote_cap is not None:
            remote = build_optional_http_vision(
                endpoint=self.settings.vision_endpoint,
                model_id=remote_cap.model_id,
                api_key=self.settings.vision_api_key,
                timeout_s=self.settings.vision_timeout_s,
                version=self.settings.vision_model_version,
            )
            if remote is None:
                raise RuntimeError("vision_endpoint set but remote adapter was not built.")
            self.models[remote.model_id] = remote
            capabilities.insert(0, remote_cap)

        # F8: fail fast if enabled capabilities lack adapters or IDs conflict.
        validate_registry_capabilities(capabilities, self.models)

        self.vision_execution_mode = parse_vision_execution_mode(
            self.settings.vision_execution_policy
        )
        self.router = ModelRouter(capabilities=capabilities)
        self.imaging_prep = MetadataOnlyPreparationPipeline(capabilities=capabilities)
        self.scenario_policy = ScenarioRoutingPolicy()
        self.execution_policy = ModelExecutionPolicy(
            mode=self.vision_execution_mode,
            capabilities=capabilities,
        )
        # F11: settings-selected provider (mock default). No network probe at startup.
        self.llm_provider = build_llm_provider(self.settings)
        self.llm = LLMGateway(self.llm_provider, rag=self.rag)
        self.validator = ReportValidator()
        self.orchestrator = AIOrchestrator(
            self.router,
            self.models,
            self.llm,
            self.validator,
            scenario_policy=self.scenario_policy,
            execution_policy=self.execution_policy,
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
            tenant_isolation=self.settings.tenant_isolation,
            audit=self.audit,
            max_concurrent_analyze=self.settings.max_concurrent_analyze,
            analyze_gate_path=self.settings.analyze_gate_path,
        )
        self.dicom = DicomService(
            self.repo,
            self.quarantine,
            capabilities=capabilities,
            tenant_isolation=self.settings.tenant_isolation,
            audit=self.audit,
            malware_scanner=self.malware_scanner,
        )
        self.documents = DocumentService(
            self.repo,
            self.quarantine,
            capabilities=capabilities,
            tenant_isolation=self.settings.tenant_isolation,
        )
        self.auth = AuthSettings(
            enabled=self.settings.auth_enabled,
            api_key=self.settings.auth_api_key,
            jwt_secret=self.settings.jwt_secret,
            jwt_ttl_seconds=self.settings.jwt_ttl_seconds,
            users=DEMO_USERS,
            tenant_isolation=self.settings.tenant_isolation,
            deployment_mode=self.settings.deployment_mode,
        )
