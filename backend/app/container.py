from app.auth.security import DEMO_USERS, AuthSettings, DemoUserRecord
from app.imaging.metadata_prep import MetadataOnlyPreparationPipeline
from app.llm.factory import build_llm_provider
from app.llm.gateway import LLMGateway
from app.models.bridge_resources import ResourceLimits
from app.models.http_vision import build_optional_http_vision
from app.models.local_torch import LocalTorchConfig, LocalTorchVisionAdapter, build_optional_local_torch
from app.models.mock_vision import default_model_registry
from app.models.registry import ModelRegistry
from app.orchestration.orchestrator import AIOrchestrator
from app.rag.embedding_retriever import EmbeddingRagRetriever
from app.rag.retriever import LexicalRagRetriever
from app.rag.vector_store import JsonVectorStore
from app.routing.capabilities import default_capabilities
from app.routing.execution_policy import ModelExecutionPolicy, parse_vision_execution_mode
from app.routing.model_router import ModelRouter
from app.routing.registry_validation import validate_registry_capabilities
from app.routing.local_config import local_capability_from_settings, validate_local_torch_settings
from app.routing.remote_config import remote_capability_from_settings
from app.routing.scenario_policy import ScenarioRoutingPolicy
from app.feedback.store import FeedbackStore
from app.security.audit import AuditLogger
from app.security.retention import RetentionPolicy
from app.services.case_service import CaseService
from app.ingest.documents import build_document_text_adapter
from app.services.dicom_service import DicomService
from app.services.document_service import DocumentService
from app.services.notification_service import NotificationService
from app.services.notification_store import build_notification_store
from app.services.user_settings_store import build_user_settings_store
from app.services.repository import CaseRepository, InMemoryCaseRepository, build_repository
from app.services.messaging_service import MessagingService
from app.services.messaging_store import build_messaging_store
from app.services.payment_service import PaymentService
from app.services.payment_store import build_payment_store
from app.services.workflow_service import WorkflowService
from app.services.workflow_store import build_workflow_store
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
        validate_local_torch_settings(self.settings)
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
        self.feedback = FeedbackStore(self.settings.feedback_log_path)
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

        local_cap = local_capability_from_settings(self.settings)
        if local_cap is not None:
            local_adapter = build_optional_local_torch(
                model_id=local_cap.model_id,
                weights_path=self.settings.local_torch_weights_path,
                entrypoint=self.settings.local_torch_entrypoint,
                version=local_cap.model_version,
                device=self.settings.local_torch_device,
                capabilities=capabilities,
                quarantine=self.quarantine,
                limits=None,
            )
            if local_adapter is None:
                local_adapter = LocalTorchVisionAdapter(
                    LocalTorchConfig(
                        model_id=local_cap.model_id,
                        version=local_cap.model_version,
                        weights_path=self.settings.local_torch_weights_path,
                        entrypoint=self.settings.local_torch_entrypoint,
                        device=self.settings.local_torch_device,
                        timeout_s=self.settings.local_torch_timeout_s,
                    ),
                    capabilities=capabilities,
                    quarantine=self.quarantine,
                )
            self.models[local_cap.model_id] = local_adapter
            capabilities.insert(0, local_cap)

        # F8: fail fast if enabled capabilities lack adapters or IDs conflict.
        validate_registry_capabilities(capabilities, self.models)
        self.model_registry_view = ModelRegistry(capabilities, self.models)
        self.vision_resource_limits = ResourceLimits(
            max_instances=self.settings.vision_max_instances,
            max_tensor_bytes=self.settings.vision_max_tensor_bytes,
            inference_timeout_s=self.settings.vision_timeout_s,
            transmit_pixels_over_http=self.settings.vision_transmit_pixels,
        )

        self.vision_execution_mode = parse_vision_execution_mode(
            self.settings.vision_execution_policy
        )
        self.router = ModelRouter(
            capabilities=capabilities,
            pixel_analysis_opt_in=self.settings.pixel_analysis_opt_in,
        )
        self.imaging_prep = MetadataOnlyPreparationPipeline(
            capabilities=capabilities,
            pixel_analysis_opt_in=self.settings.pixel_analysis_opt_in,
            quarantine_root=self.settings.quarantine_root,
        )
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
            pixel_analysis_opt_in=self.settings.pixel_analysis_opt_in,
            quarantine_root=self.settings.quarantine_root,
        )
        self.job_backend = build_job_backend(
            backend=self.settings.job_backend,
            delay_ms=self.settings.async_analyze_delay_ms,
            redis_url=self.settings.redis_url,
        )
        self.notification_store = build_notification_store(self.settings)
        self.notifications = NotificationService(self.notification_store)
        self.user_settings = build_user_settings_store(self.settings)
        self.cases = CaseService(
            self.repo,
            self.orchestrator,
            self.validator,
            async_delay_ms=self.settings.async_analyze_delay_ms,
            job_backend=self.job_backend,
            tenant_isolation=self.settings.tenant_isolation,
            audit=self.audit,
            feedback=self.feedback,
            max_concurrent_analyze=self.settings.max_concurrent_analyze,
            analyze_gate_path=self.settings.analyze_gate_path,
            notifications=self.notifications,
        )
        self.dicom = DicomService(
            self.repo,
            self.quarantine,
            capabilities=capabilities,
            tenant_isolation=self.settings.tenant_isolation,
            audit=self.audit,
            malware_scanner=self.malware_scanner,
            feedback=self.feedback,
        )
        doc_adapter = build_document_text_adapter(
            ocr_endpoint=self.settings.document_ocr_endpoint,
            ocr_timeout_s=self.settings.document_ocr_timeout_s,
        )
        self.documents = DocumentService(
            self.repo,
            self.quarantine,
            capabilities=capabilities,
            tenant_isolation=self.settings.tenant_isolation,
            document_adapter=doc_adapter,
        )
        # Mutable login directory (admin can add/update users via WorkflowService).
        self._auth_users: dict[str, DemoUserRecord] = dict(DEMO_USERS)
        self.workflow_store = build_workflow_store(self.settings)
        self.payment_store = build_payment_store(self.settings)
        self.payments = PaymentService(
            self.payment_store,
            audit=self.audit,
            tenant_isolation=self.settings.tenant_isolation,
        )
        self.workflow = WorkflowService(
            self.workflow_store,
            self.cases,
            dicom=self.dicom,
            notifications=self.notifications,
            tenant_isolation=self.settings.tenant_isolation,
            auth_users=self._auth_users,
            payments=self.payments,
        )
        self.payments.bind_workflow(self.workflow)
        self.workflow.sync_auth_directory()
        self.messaging_store = build_messaging_store(self.settings)
        self.messaging = MessagingService(
            self.messaging_store,
            notifications=self.notifications,
            auth_users=self._auth_users,
            tenant_isolation=self.settings.tenant_isolation,
        )
        self.auth = AuthSettings(
            enabled=self.settings.auth_enabled,
            api_key=self.settings.auth_api_key,
            jwt_secret=self.settings.jwt_secret,
            jwt_ttl_seconds=self.settings.jwt_ttl_seconds,
            users=self._auth_users,
            tenant_isolation=self.settings.tenant_isolation,
            deployment_mode=self.settings.deployment_mode,
        )
