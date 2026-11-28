from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.api.analysis import router as analysis_router
from app.api.auth import router as auth_router
from app.api.cases import router as cases_router
from app.api.dicom import router as dicom_router
from app.api.documents import router as documents_router
from app.api.evidence import router as evidence_router
from app.api.models import router as models_router
from app.api.rag import router as rag_router
from app.api.report_links import router as report_links_router
from app.api.reports import router as reports_router
from app.api.notifications import router as notifications_router
from app.api.admin_retention import router as admin_retention_router
from app.api.architecture import router as architecture_router
from app.api.llm_feedback import router as llm_feedback_router
from app.api.feedback import router as feedback_router
from app.api.messaging import live_router, router as messaging_router
from app.api.radiologist_payouts import router as radiologist_payouts_router
from app.api.workflow import router as workflow_router
from app.api.settings import router as settings_router
from app.api.training_export import router as training_export_router
from app.api.lessons import router as lessons_router
from app.api.patients import router as patients_router
from app.api.admin_audit import router as admin_audit_router
from app.api.owner_summary import router as owner_summary_router
from app.auth.security import decode_token, resolve_jwt_identity, verify_api_key
from app.container import AppContainer
from app.http_errors import normalize_detail, validation_detail
from app.demo_seed import ensure_demo_seed


def _local_torch_health(c: AppContainer) -> dict[str, Any] | None:
    """Configured local PyTorch model, labelled honestly (tiny contract models are mock)."""
    model_id = (c.settings.local_torch_model_id or "").strip()
    adapter = c.models.get(model_id) if model_id else None
    if adapter is None:
        return None
    cap = next((x for x in c.router.list_capabilities() if x.model_id == model_id), None)
    return {
        "model_id": model_id,
        "model_kind": getattr(adapter, "model_kind", None),
        "source_kind": cap.source_kind.value if cap is not None else None,
        "routed": bool(cap is not None and cap.enabled),
        "availability": cap.availability if cap is not None else None,
    }


def _health_caller_is_trusted(request: Request, c: AppContainer) -> bool:
    """Full health details only with auth off (local demo) or for admin / API-key callers."""
    if not c.auth.enabled:
        return True
    if verify_api_key(request.headers.get("X-API-Key"), c.auth.api_key):
        return True
    scheme, _, token = (request.headers.get("Authorization") or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        return False
    try:
        payload = decode_token(token.strip(), c.auth.jwt_secret)
        _subject, role, _clinic = resolve_jwt_identity(payload, c.auth.users)
    except ValueError:
        return False
    return role == "admin" and not payload.get("mfa_setup")


def create_app(container: AppContainer | None = None) -> FastAPI:
    fresh_process = container is None
    container = container or AppContainer()
    # Auth on / protected: no public API map (/docs, /redoc, /openapi.json).
    public_docs = not container.settings.auth_enabled and container.settings.deployment_mode == "demo"
    app = FastAPI(
        docs_url="/docs" if public_docs else None,
        redoc_url="/redoc" if public_docs else None,
        openapi_url="/openapi.json" if public_docs else None,
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
    app.state.container = container
    if fresh_process:
        # Fresh process: analyses the previous one was running are gone (#118).
        app.state.container.analysis.recover_interrupted_jobs()

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        # Same 422 body as FastAPI, minus echoed inputs: NaN/inf inputs cannot be JSON-encoded
        # (the default handler turned them into a 500) and inputs may carry sensitive text.
        errors = [{k: v for k, v in err.items() if k not in {"input", "ctx", "url"}} for err in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": jsonable_encoder(validation_detail(errors))})

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # One error shape for the whole API (#85): {"detail": {"code", "message", ...}}.
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": jsonable_encoder(normalize_detail(exc.status_code, exc.detail))},
            headers=getattr(exc, "headers", None),
        )
    ensure_demo_seed(app.state.container)

    @app.middleware("http")
    async def _security_headers(request: Request, call_next):
        # Same baseline as docker/security-headers.conf, for when the API is reached directly.
        response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "no-referrer")
        # API answers carry patient data and tokens: never keep them in shared or browser caches.
        if request.url.path.startswith("/api/"):
            headers.setdefault("Cache-Control", "no-store")
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app.state.container.settings.cors_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth_router)
    app.include_router(cases_router)
    app.include_router(report_links_router)
    app.include_router(evidence_router)
    app.include_router(analysis_router)
    app.include_router(reports_router)
    app.include_router(dicom_router)
    app.include_router(documents_router)
    app.include_router(models_router)
    app.include_router(rag_router)
    app.include_router(workflow_router)
    app.include_router(radiologist_payouts_router)
    app.include_router(messaging_router)
    app.include_router(live_router)
    app.include_router(notifications_router)
    app.include_router(settings_router)
    app.include_router(llm_feedback_router)
    app.include_router(admin_retention_router)
    app.include_router(architecture_router)
    app.include_router(feedback_router)
    app.include_router(training_export_router)
    app.include_router(lessons_router)
    app.include_router(patients_router)
    app.include_router(admin_audit_router)
    app.include_router(owner_summary_router)

    @app.get("/api/v1/health")
    def health(request: Request) -> dict[str, Any]:
        c: AppContainer = app.state.container
        if not _health_caller_is_trusted(request, c):
            # Liveness only: configuration details (providers, storage, policies) are for admins.
            return {
                "status": "ok",
                "auth_enabled": c.auth.enabled,
                "deployment_mode": c.auth.deployment_mode,
                "details": "admin_only",
            }
        # Protected / auth-enabled: do not leak absolute filesystem paths.
        expose_paths = c.auth.deployment_mode == "demo" and not c.auth.enabled
        sqlite_path = ""
        quarantine_root = ""
        if expose_paths:
            if c.storage_backend == "sqlite":
                sqlite_path = str(c.settings.sqlite_path)
            quarantine_root = str(c.settings.quarantine_root)
        vision_remote = bool(c.settings.vision_endpoint)
        vlm_enabled = bool(c.settings.vlm_enabled)
        llm_kind = (c.settings.llm_provider or "mock").strip().lower()
        llm_remote = llm_kind not in {"mock", "stub"}
        if (vision_remote or vlm_enabled) and llm_remote:
            pipeline_mode = "configured"
        elif vision_remote or vlm_enabled or llm_remote:
            pipeline_mode = "partial_remote"
        else:
            pipeline_mode = "mock"
        rate_backend = getattr(c.rate_limiter, "backend", "memory")
        return {
            "local_torch": _local_torch_health(c),
            "status": "ok",
            "mode": pipeline_mode,
            "version": __version__,
            "storage": c.storage_backend,
            "sqlite_path": sqlite_path,
            "quarantine_root": quarantine_root,
            "rag": c.rag_method,
            # #101: which embedding runs (bge-m3 or hash) and why, if it fell back.
            "rag_embedding": c.rag_embedding.as_dict() if getattr(c, "rag_embedding", None) else None,
            "rag_store": c.vector_store.kind if getattr(c, "vector_store", None) is not None else None,
            "job_backend": c.job_backend.name,
            "auth_enabled": c.auth.enabled,
            "deployment_mode": c.auth.deployment_mode,
            "tenant_isolation": c.auth.tenant_isolation,
            "encryption_at_rest": c.encryption.mode,
            "vision_endpoint": vision_remote,
            "vlm_enabled": vlm_enabled,
            "vision_execution_policy": c.settings.vision_execution_policy,
            "llm_provider": c.settings.llm_provider,
            "smtp_configured": bool(c.settings.smtp_host),
            "demo_apis_enabled": c.settings.deployment_mode == "demo",
            "self_registration_enabled": bool(c.settings.self_registration_enabled),
            "rate_limit_backend": rate_backend,
            "note": "Not a clinical system. Optional Postgres/auth/remote Vision/RQ via env.",
        }

    return app


app = create_app()
