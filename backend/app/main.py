from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.analysis import router as analysis_router
from app.api.auth import router as auth_router
from app.api.cases import router as cases_router
from app.api.dicom import router as dicom_router
from app.api.documents import router as documents_router
from app.api.rag import router as rag_router
from app.api.reports import router as reports_router
from app.container import AppContainer


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
    app.include_router(rag_router)

    @app.get("/api/v1/health")
    def health() -> dict[str, str | bool | None]:
        c: AppContainer = app.state.container
        sqlite_path = ""
        if c.storage_backend == "sqlite":
            sqlite_path = str(c.settings.sqlite_path)
        return {
            "status": "ok",
            "mode": "mock",
            "version": __version__,
            "storage": c.storage_backend,
            "sqlite_path": sqlite_path,
            "quarantine_root": str(c.settings.quarantine_root),
            "rag": c.rag_method,
            "job_backend": c.job_backend.name,
            "auth_enabled": c.auth.enabled,
            "vision_endpoint": bool(c.settings.vision_endpoint),
            "vision_execution_policy": c.settings.vision_execution_policy,
            "llm_provider": c.settings.llm_provider,
            "note": "Not a clinical system. Optional Postgres/auth/remote Vision/RQ via env.",
        }

    return app


app = create_app()
