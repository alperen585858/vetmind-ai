from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.analysis import router as analysis_router
from app.api.cases import router as cases_router
from app.api.dicom import router as dicom_router
from app.api.reports import router as reports_router
from app.container import AppContainer


def create_app(container: AppContainer | None = None) -> FastAPI:
    app = FastAPI(
        title="VetMind AI Backend",
        description=(
            "Veterinary teleradiology senior design backend. "
            "DICOM metadata ingest + mock AI pipeline. "
            "Persistence: SQLite JSON documents by default (CaseRepository); "
            "set VETMIND_STORAGE=memory for ephemeral mode. "
            "No real imaging models, no pixel-based diagnosis, no paid LLM providers. "
            "Analysis runs synchronously in the HTTP request; "
            "job_id is a run identifier, not a background queue ticket."
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
    app.include_router(cases_router)
    app.include_router(analysis_router)
    app.include_router(reports_router)
    app.include_router(dicom_router)

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
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
            "note": "Mock AI pipeline only. Not a clinical system. SQLite is demo persistence, not production Postgres.",
        }

    return app


app = create_app()
