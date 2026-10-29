from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.analysis import router as analysis_router
from app.api.auth import router as auth_router
from app.api.cases import router as cases_router
from app.api.dicom import router as dicom_router
from app.api.documents import router as documents_router
from app.api.models import router as models_router
from app.api.rag import router as rag_router
from app.api.reports import router as reports_router
from app.api.notifications import router as notifications_router
from app.api.llm_feedback import router as llm_feedback_router
from app.api.feedback import router as feedback_router
from app.api.messaging import router as messaging_router
from app.api.payments import router as payments_router
from app.api.workflow import router as workflow_router
from app.api.settings import router as settings_router
from app.container import AppContainer
from app.demo_seed import ensure_demo_seed


def create_app(container: AppContainer | None = None) -> FastAPI:
    app = FastAPI(
        title="VetMind AI Backend",
        description=(
            "Veterinary teleradiology senior design backend. "
            "DICOM + document ingest, quarantine, mock/remote Vision adapters, "
            "embedding or lexical RAG, sync/async analyze. "
            "Storage: memory | sqlite | postgres (CaseRepository Protocol). "
            "Auth optional (VETMIND_AUTH_ENABLED). Not a clinical production system."
        ),
        version=__version__,
    )
    app.state.container = container or AppContainer()
    ensure_demo_seed(app.state.container)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth_router)
    app.include_router(cases_router)
    app.include_router(analysis_router)
    app.include_router(reports_router)
    app.include_router(dicom_router)
    app.include_router(documents_router)
    app.include_router(models_router)
    app.include_router(rag_router)
    app.include_router(workflow_router)
    app.include_router(payments_router)
    app.include_router(messaging_router)
    app.include_router(notifications_router)
    app.include_router(settings_router)
    app.include_router(llm_feedback_router)
    app.include_router(feedback_router)

    @app.get("/api/v1/health")
    def health() -> dict[str, str | bool | None]:
        c: AppContainer = app.state.container
        # Protected / auth-enabled: do not leak absolute filesystem paths.
        expose_paths = c.auth.deployment_mode == "demo" and not c.auth.enabled
        sqlite_path = ""
        quarantine_root = ""
        if expose_paths:
            if c.storage_backend == "sqlite":
                sqlite_path = str(c.settings.sqlite_path)
            quarantine_root = str(c.settings.quarantine_root)
        vision_remote = bool(c.settings.vision_endpoint)
        llm_kind = (c.settings.llm_provider or "mock").strip().lower()
        llm_remote = llm_kind not in {"mock", "stub"}
        if vision_remote and llm_remote:
            pipeline_mode = "configured"
        elif vision_remote or llm_remote:
            pipeline_mode = "partial_remote"
        else:
            pipeline_mode = "mock"
        return {
            "status": "ok",
            "mode": pipeline_mode,
            "version": __version__,
            "storage": c.storage_backend,
            "sqlite_path": sqlite_path,
            "quarantine_root": quarantine_root,
            "rag": c.rag_method,
            "job_backend": c.job_backend.name,
            "auth_enabled": c.auth.enabled,
            "deployment_mode": c.auth.deployment_mode,
            "tenant_isolation": c.auth.tenant_isolation,
            "encryption_at_rest": c.encryption.mode,
            "vision_endpoint": vision_remote,
            "vision_execution_policy": c.settings.vision_execution_policy,
            "llm_provider": c.settings.llm_provider,
            "note": "Not a clinical system. Optional Postgres/auth/remote Vision/RQ via env.",
        }

    return app


app = create_app()
