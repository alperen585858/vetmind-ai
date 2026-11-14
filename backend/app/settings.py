"""Runtime settings. Persistence / RAG / auth / vision / jobs / security are selectable via env."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from app.auth.security import DEFAULT_JWT_SECRET


@dataclass(frozen=True)
class Settings:
    """Environment-driven settings. Defaults favor local demo durability."""

    storage_backend: str  # "memory" | "sqlite" | "postgres"
    sqlite_path: Path
    quarantine_root: Path
    database_url: str | None = None
    async_analyze_delay_ms: int = 400
    rag_backend: str = "embedding"  # "lexical" | "embedding"
    rag_index_path: Path | None = None
    vision_endpoint: str | None = None
    vision_model_id: str = "remote-vision-v1"
    vision_api_key: str | None = None
    # When a remote Vision endpoint is set: exclusive_real (default) or mixed (dev/test only).
    vision_execution_policy: str = "exclusive_real"
    # Explicit remote capability declaration (required when vision_endpoint is set).
    vision_modalities: tuple[str, ...] = ()
    vision_regions: tuple[str, ...] = ()
    vision_species: tuple[str, ...] = ()  # empty → all species
    vision_priority: int = 1
    vision_enabled: bool = True
    vision_source_kind: str = "real"
    vision_timeout_s: float = 30.0
    vision_model_version: str = "0.1.0-http"
    # Phase 9 bridge resource limits (prep/inference; pixel egress still default-deny).
    vision_max_instances: int = 512
    vision_max_tensor_bytes: int = 256 * 1024 * 1024
    vision_transmit_pixels: bool = False
    # Build-level opt-in for pixel decode / bridge (default deny; synthetic probes exempt).
    pixel_analysis_opt_in: bool = False
    # Multimodal VLM Vision (Gemini/OpenAI-compatible): send study images to chat model.
    vlm_enabled: bool = False
    vlm_model_id: str = "vlm-vision-v1"
    vlm_chat_model_id: str | None = None  # default = llm_model_id
    vlm_timeout_s: float = 180.0
    vlm_max_images: int = 6  # per VLM API batch
    vlm_max_total_frames: int = 128  # total frames across all batches (honest budget; raise for full studies)
    vlm_include_localizers: bool = False
    vlm_priority: int = 1
    # Optional local PyTorch Vision (weights + entrypoint required for loaded state).
    local_torch_model_id: str | None = None
    local_torch_weights_path: str | None = None
    # Expected SHA-256 of the checkpoint. When set, a mismatch refuses to load, and only a
    # pinned checkpoint may use full (pickle) loading; otherwise weights_only loading is used.
    local_torch_weights_sha256: str | None = None
    local_torch_entrypoint: str | None = None
    local_torch_model_version: str = "0.0.0-unconfigured"
    local_torch_device: str = "cpu"
    local_torch_timeout_s: float = 30.0
    local_torch_priority: int = 2
    local_torch_enabled: bool = True
    local_torch_source_kind: str = "real"
    local_torch_modalities: tuple[str, ...] = ()
    local_torch_regions: tuple[str, ...] = ()
    local_torch_species: tuple[str, ...] = ()
    # Explicit CT WW/WC for local torch (no silent clinical presets).
    local_torch_window_center: float | None = None
    local_torch_window_width: float | None = None
    # Optional bridge artifact root (defaults under quarantine/_bridge_tmp).
    vision_artifact_root: str | None = None
    # Optional temperature scaling artifact for calibration (path to JSON).
    vision_calibration_path: str | None = None
    # LLM provider: mock (default) | stub | http (requires llm_endpoint; no startup probe)
    # | openai (any OpenAI-compatible API) | ollama | anthropic.
    llm_provider: str = "mock"
    llm_endpoint: str | None = None
    llm_provider_id: str = "http-llm"
    llm_model_id: str = "generic-http-llm"
    # Comma-separated alternates tried after primary hits 503/429 (Gemini capacity).
    llm_fallback_model_ids: tuple[str, ...] = ()
    llm_model_version: str = "0.1.0"
    llm_api_key: str | None = None
    llm_timeout_s: float = 30.0
    llm_report_language: str = "tr"  # tr | en — language of generated report text
    report_anatomy_dictionary_path: Path | None = None
    report_anatomy_approvals_path: Path | None = None
    llm_temperature: float | None = 0.2
    llm_max_tokens: int = 2048
    llm_json_mode: str = "schema"  # schema | object | none (OpenAI-compatible only)
    llm_prompt_version: str = "vetmind-report-v5"
    llm_verify: bool = False  # sentence-level citation verifier pass (one extra call)
    llm_verifier_model_id: str | None = None  # judge model on the same endpoint; default = writer
    auth_enabled: bool = False
    auth_api_key: str | None = None
    jwt_secret: str = DEFAULT_JWT_SECRET
    # Access JWT lifetime. Short on purpose: the frontend renews it with a refresh token.
    jwt_ttl_seconds: int = 15 * 60
    refresh_ttl_seconds: int = 7 * 24 * 60 * 60
    # Issue #31 — public sign-up (POST /api/v1/auth/register).
    self_registration_enabled: bool = True
    # Clinic that self-registered pet owners' imaging requests are routed to.
    self_registration_owner_clinic_id: str | None = "clinic-demo-a"
    # Issue #31 step 4 — password reset links (single use).
    password_reset_ttl_seconds: int = 30 * 60
    # Frontend origin used to build links in emails.
    public_base_url: str = "http://localhost:5173"
    # Outgoing mail. Without smtp_host, mails are written to the server log in demo mode.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str = "VetMind <no-reply@vetmind.local>"
    smtp_starttls: bool = True
    # Issue #31 step 5 — attempt limits on auth endpoints (in-process).
    auth_rate_limit_enabled: bool = True
    # Use the first X-Forwarded-For hop as the client IP. Only behind a trusted proxy:
    # otherwise clients can spoof it to dodge per-IP limits.
    trust_proxy_headers: bool = False
    job_backend: str = "thread"  # "thread" | "rq"
    redis_url: str | None = None
    # Phase 5 — security / privacy / performance
    deployment_mode: str = "demo"  # demo | protected
    tenant_isolation: bool = False
    allow_insecure_demo: bool = False
    malware_scan_required: bool = False
    dicom_identity_scrub: bool = False
    encryption_at_rest: str = "none"
    retention_dicom_days: int | None = None
    retention_temp_hours: int = 24
    retention_artifacts_days: int | None = None
    retention_reports_days: int | None = None
    retention_logs_days: int = 90
    max_concurrent_analyze: int = 8
    analyze_gate_path: Path | None = None
    audit_log_path: Path | None = None
    feedback_log_path: Path | None = None
    # Expert revision lessons (app/llm/lessons.py). None = in-memory (tests / memory storage).
    lessons_path: Path | None = None
    document_ocr_endpoint: str | None = None
    document_ocr_timeout_s: float = 30.0
    # Load scripted demo cases on startup when the case store is empty (app.demo_seed).
    demo_seed: bool = False
    # DICOM classifier: ask the configured LLM when metadata rules are unsure (app.dicom.llm_classifier).
    # Off by default; uses the VETMIND_LLM_* provider, optionally with its own model id.
    classifier_llm: bool = False
    classifier_llm_model_id: str | None = None
    classifier_llm_timeout_s: float = 20.0
    note: str = (
        "CaseRepository: memory | sqlite | postgres. "
        "Optional remote Vision via VETMIND_VISION_ENDPOINT. "
        "Auth off by default (VETMIND_AUTH_ENABLED=1 to enforce). "
        "Protected mode: VETMIND_DEPLOYMENT_MODE=protected (requires auth + non-default JWT secret). "
        "Jobs: thread (default) or rq+redis."
    )


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[1]  # backend/


def _default_sqlite_path() -> Path:
    return _backend_root() / "data" / "vetmind.sqlite3"


def _default_quarantine_root() -> Path:
    return _backend_root() / "data" / "quarantine"


def _default_rag_index_path() -> Path:
    return _backend_root() / "data" / "rag_index.json"


def _default_audit_log_path() -> Path:
    return _backend_root() / "data" / "audit" / "security.jsonl"


def _default_feedback_log_path() -> Path:
    return _backend_root() / "data" / "feedback" / "feedback.jsonl"


def _default_lessons_path() -> Path:
    return _backend_root() / "data" / "revision_lessons.json"


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _env_optional_int(name: str) -> int | None:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _load_dotenv_files() -> None:
    """Load backend/.env into os.environ when present (does not override existing vars)."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    env_path = _backend_root() / ".env"
    if env_path.is_file():
        load_dotenv(env_path, override=False)


def load_settings() -> Settings:
    _load_dotenv_files()
    backend = os.getenv("VETMIND_STORAGE", "sqlite").strip().lower()
    if backend not in {"memory", "sqlite", "postgres"}:
        backend = "sqlite"
    path_raw = os.getenv("VETMIND_SQLITE_PATH")
    sqlite_path = Path(path_raw) if path_raw else _default_sqlite_path()
    q_raw = os.getenv("VETMIND_QUARANTINE_ROOT")
    quarantine_root = Path(q_raw) if q_raw else _default_quarantine_root()
    database_url = os.getenv("VETMIND_DATABASE_URL") or os.getenv("DATABASE_URL")
    try:
        delay_ms = int(os.getenv("VETMIND_ASYNC_DELAY_MS", "400"))
    except ValueError:
        delay_ms = 400
    delay_ms = max(0, min(delay_ms, 10_000))

    rag_backend = os.getenv("VETMIND_RAG", "embedding").strip().lower()
    if rag_backend not in {"lexical", "embedding"}:
        rag_backend = "embedding"
    rag_index_raw = os.getenv("VETMIND_RAG_INDEX_PATH")
    rag_index_path = Path(rag_index_raw) if rag_index_raw else _default_rag_index_path()

    vision_endpoint = os.getenv("VETMIND_VISION_ENDPOINT") or None
    vision_model_id = os.getenv("VETMIND_VISION_MODEL_ID", "remote-vision-v1").strip() or "remote-vision-v1"
    vision_api_key = os.getenv("VETMIND_VISION_API_KEY") or None
    vision_execution_policy = (
        os.getenv("VETMIND_VISION_EXECUTION_POLICY", "exclusive_real").strip().lower()
        or "exclusive_real"
    )
    if vision_execution_policy not in {"exclusive_real", "mixed"}:
        vision_execution_policy = "exclusive_real"

    def _csv_tuple(env_name: str) -> tuple[str, ...]:
        raw = os.getenv(env_name, "") or ""
        return tuple(part.strip() for part in raw.split(",") if part.strip())

    vision_modalities = _csv_tuple("VETMIND_VISION_MODALITIES")
    vision_regions = _csv_tuple("VETMIND_VISION_REGIONS")
    vision_species = _csv_tuple("VETMIND_VISION_SPECIES")
    try:
        vision_priority = int(os.getenv("VETMIND_VISION_PRIORITY", "1"))
    except ValueError:
        vision_priority = 1
    vision_enabled = os.getenv("VETMIND_VISION_ENABLED", "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }
    vision_source_kind = os.getenv("VETMIND_VISION_SOURCE_KIND", "real").strip().lower() or "real"
    try:
        vision_timeout_s = float(os.getenv("VETMIND_VISION_TIMEOUT_S", "30"))
    except ValueError:
        vision_timeout_s = 30.0
    vision_model_version = (
        os.getenv("VETMIND_VISION_MODEL_VERSION", "0.1.0-http").strip() or "0.1.0-http"
    )
    try:
        vision_max_instances = int(os.getenv("VETMIND_VISION_MAX_INSTANCES", "512"))
    except ValueError:
        vision_max_instances = 512
    vision_max_instances = max(1, min(vision_max_instances, 4096))
    try:
        vision_max_tensor_bytes = int(
            os.getenv("VETMIND_VISION_MAX_TENSOR_BYTES", str(256 * 1024 * 1024))
        )
    except ValueError:
        vision_max_tensor_bytes = 256 * 1024 * 1024
    vision_max_tensor_bytes = max(1024 * 1024, vision_max_tensor_bytes)
    vision_transmit_pixels = _env_bool("VETMIND_VISION_TRANSMIT_PIXELS", False)
    pixel_analysis_opt_in = _env_bool("VETMIND_PIXEL_ANALYSIS_OPT_IN", False)

    vlm_enabled = _env_bool("VETMIND_VLM_ENABLED", False)
    vlm_model_id = os.getenv("VETMIND_VLM_ADAPTER_ID", "vlm-vision-v1").strip() or "vlm-vision-v1"
    vlm_chat_model_id = (os.getenv("VETMIND_VLM_MODEL_ID") or "").strip() or None
    try:
        vlm_timeout_s = float(os.getenv("VETMIND_VLM_TIMEOUT_S", "180"))
    except ValueError:
        vlm_timeout_s = 180.0
    try:
        vlm_max_images = int(os.getenv("VETMIND_VLM_MAX_IMAGES", "6"))
    except ValueError:
        vlm_max_images = 6
    try:
        vlm_max_total_frames = int(os.getenv("VETMIND_VLM_MAX_TOTAL_FRAMES", "128"))
    except ValueError:
        vlm_max_total_frames = 128
    vlm_include_localizers = _env_bool("VETMIND_VLM_INCLUDE_LOCALIZERS", False)
    try:
        vlm_priority = int(os.getenv("VETMIND_VLM_PRIORITY", "1"))
    except ValueError:
        vlm_priority = 1

    local_torch_model_id = os.getenv("VETMIND_LOCAL_TORCH_MODEL_ID") or None
    local_torch_weights_path = os.getenv("VETMIND_LOCAL_TORCH_WEIGHTS_PATH") or None
    local_torch_weights_sha256 = (os.getenv("VETMIND_LOCAL_TORCH_WEIGHTS_SHA256") or "").strip().lower() or None
    local_torch_entrypoint = os.getenv("VETMIND_LOCAL_TORCH_ENTRYPOINT") or None
    local_torch_model_version = (
        os.getenv("VETMIND_LOCAL_TORCH_MODEL_VERSION", "0.0.0-unconfigured").strip()
        or "0.0.0-unconfigured"
    )
    local_torch_device = os.getenv("VETMIND_LOCAL_TORCH_DEVICE", "cpu").strip() or "cpu"
    try:
        local_torch_timeout_s = float(os.getenv("VETMIND_LOCAL_TORCH_TIMEOUT_S", "30"))
    except ValueError:
        local_torch_timeout_s = 30.0
    try:
        local_torch_priority = int(os.getenv("VETMIND_LOCAL_TORCH_PRIORITY", "2"))
    except ValueError:
        local_torch_priority = 2
    local_torch_enabled = os.getenv("VETMIND_LOCAL_TORCH_ENABLED", "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }
    local_torch_source_kind = (
        os.getenv("VETMIND_LOCAL_TORCH_SOURCE_KIND", "real").strip().lower() or "real"
    )
    local_torch_modalities = _csv_tuple("VETMIND_LOCAL_TORCH_MODALITIES")
    local_torch_regions = _csv_tuple("VETMIND_LOCAL_TORCH_REGIONS")
    local_torch_species = _csv_tuple("VETMIND_LOCAL_TORCH_SPECIES")
    try:
        wc_raw = os.getenv("VETMIND_LOCAL_TORCH_WINDOW_CENTER")
        local_torch_window_center = float(wc_raw) if wc_raw not in (None, "") else None
    except ValueError:
        local_torch_window_center = None
    try:
        ww_raw = os.getenv("VETMIND_LOCAL_TORCH_WINDOW_WIDTH")
        local_torch_window_width = float(ww_raw) if ww_raw not in (None, "") else None
    except ValueError:
        local_torch_window_width = None
    vision_artifact_root = os.getenv("VETMIND_VISION_ARTIFACT_ROOT") or None
    vision_calibration_path = os.getenv("VETMIND_VISION_CALIBRATION_PATH") or None

    llm_provider = os.getenv("VETMIND_LLM_PROVIDER", "mock").strip().lower() or "mock"
    llm_endpoint = os.getenv("VETMIND_LLM_ENDPOINT") or None
    llm_provider_id = os.getenv("VETMIND_LLM_PROVIDER_ID", "http-llm").strip() or "http-llm"
    llm_model_id = os.getenv("VETMIND_LLM_MODEL_ID", "generic-http-llm").strip() or "generic-http-llm"
    llm_fallback_model_ids = _csv_tuple("VETMIND_LLM_FALLBACK_MODELS")
    llm_model_version = os.getenv("VETMIND_LLM_MODEL_VERSION", "0.1.0").strip() or "0.1.0"
    llm_api_key = os.getenv("VETMIND_LLM_API_KEY") or None
    try:
        llm_timeout_s = float(os.getenv("VETMIND_LLM_TIMEOUT_S", "30"))
    except ValueError:
        llm_timeout_s = 30.0
    llm_report_language = os.getenv("VETMIND_LLM_REPORT_LANGUAGE", "tr").strip().lower() or "tr"
    anatomy_dictionary_path = os.getenv("VETMIND_REPORT_ANATOMY_DICTIONARY_PATH", "").strip()
    anatomy_approvals_path = os.getenv("VETMIND_REPORT_ANATOMY_APPROVALS_PATH", "").strip()
    llm_temperature_raw = os.getenv("VETMIND_LLM_TEMPERATURE", "0.2").strip().lower()
    try:
        llm_temperature = None if llm_temperature_raw in {"", "none"} else float(llm_temperature_raw)
    except ValueError:
        llm_temperature = 0.2
    try:
        llm_max_tokens = int(os.getenv("VETMIND_LLM_MAX_TOKENS", "2048"))
    except ValueError:
        llm_max_tokens = 2048
    llm_json_mode = os.getenv("VETMIND_LLM_JSON_MODE", "schema").strip().lower() or "schema"
    llm_prompt_version = os.getenv("VETMIND_LLM_PROMPT_VERSION", "vetmind-report-v5").strip() or "vetmind-report-v5"
    llm_verify = _env_bool("VETMIND_LLM_VERIFY", False)
    llm_verifier_model_id = (os.getenv("VETMIND_LLM_VERIFIER_MODEL_ID") or "").strip() or None

    auth_enabled = _env_bool("VETMIND_AUTH_ENABLED", False)
    auth_api_key = os.getenv("VETMIND_API_KEY") or None
    jwt_secret = os.getenv("VETMIND_JWT_SECRET", DEFAULT_JWT_SECRET)
    try:
        jwt_ttl = int(os.getenv("VETMIND_JWT_TTL_SECONDS", str(15 * 60)))
    except ValueError:
        jwt_ttl = 15 * 60
    try:
        refresh_ttl = int(os.getenv("VETMIND_REFRESH_TTL_SECONDS", str(7 * 24 * 60 * 60)))
    except ValueError:
        refresh_ttl = 7 * 24 * 60 * 60
    self_registration_enabled = _env_bool("VETMIND_SELF_REGISTRATION", True)
    self_registration_owner_clinic_id = (
        os.getenv("VETMIND_SELF_REGISTRATION_OWNER_CLINIC", "clinic-demo-a").strip() or None
    )
    try:
        password_reset_ttl = int(os.getenv("VETMIND_PASSWORD_RESET_TTL_SECONDS", str(30 * 60)))
    except ValueError:
        password_reset_ttl = 30 * 60
    public_base_url = (os.getenv("VETMIND_PUBLIC_BASE_URL") or "http://localhost:5173").strip().rstrip("/")
    smtp_host = (os.getenv("VETMIND_SMTP_HOST") or "").strip() or None
    try:
        smtp_port = int(os.getenv("VETMIND_SMTP_PORT", "587"))
    except ValueError:
        smtp_port = 587
    smtp_username = (os.getenv("VETMIND_SMTP_USERNAME") or "").strip() or None
    smtp_password = os.getenv("VETMIND_SMTP_PASSWORD") or None
    smtp_from = (os.getenv("VETMIND_SMTP_FROM") or "").strip() or "VetMind <no-reply@vetmind.local>"
    smtp_starttls = _env_bool("VETMIND_SMTP_STARTTLS", True)
    auth_rate_limit_enabled = _env_bool("VETMIND_AUTH_RATE_LIMIT", True)
    trust_proxy_headers = _env_bool("VETMIND_TRUST_PROXY_HEADERS", False)

    job_backend = os.getenv("VETMIND_JOB_BACKEND", "thread").strip().lower()
    if job_backend not in {"thread", "rq"}:
        job_backend = "thread"
    redis_url = os.getenv("VETMIND_REDIS_URL") or None

    deployment_mode = os.getenv("VETMIND_DEPLOYMENT_MODE", "demo").strip().lower() or "demo"
    if deployment_mode not in {"demo", "protected"}:
        deployment_mode = "demo"
    # Isolation defaults on when auth is enabled unless explicitly overridden.
    if os.getenv("VETMIND_TENANT_ISOLATION") is None:
        tenant_isolation = auth_enabled or deployment_mode == "protected"
    else:
        tenant_isolation = _env_bool("VETMIND_TENANT_ISOLATION", False)
    allow_insecure_demo = _env_bool("VETMIND_ALLOW_INSECURE_DEMO", False)
    malware_scan_required = _env_bool(
        "VETMIND_MALWARE_SCAN_REQUIRED",
        default=(deployment_mode == "protected"),
    )
    dicom_identity_scrub = _env_bool(
        "VETMIND_DICOM_IDENTITY_SCRUB",
        default=(deployment_mode == "protected"),
    )
    encryption_at_rest = os.getenv("VETMIND_ENCRYPTION_AT_REST", "none").strip().lower() or "none"

    retention_dicom_days = _env_optional_int("VETMIND_RETENTION_DICOM_DAYS")
    try:
        retention_temp_hours = int(os.getenv("VETMIND_RETENTION_TEMP_HOURS", "24"))
    except ValueError:
        retention_temp_hours = 24
    retention_artifacts_days = _env_optional_int("VETMIND_RETENTION_ARTIFACTS_DAYS")
    retention_reports_days = _env_optional_int("VETMIND_RETENTION_REPORTS_DAYS")
    try:
        retention_logs_days = int(os.getenv("VETMIND_RETENTION_LOGS_DAYS", "90"))
    except ValueError:
        retention_logs_days = 90
    try:
        max_concurrent_analyze = int(os.getenv("VETMIND_MAX_CONCURRENT_ANALYZE", "8"))
    except ValueError:
        max_concurrent_analyze = 8
    max_concurrent_analyze = max(1, min(max_concurrent_analyze, 64))

    gate_raw = os.getenv("VETMIND_ANALYZE_GATE_PATH")
    analyze_gate_path = Path(gate_raw) if gate_raw else (_backend_root() / "data" / "analyze_gate.count")

    audit_raw = os.getenv("VETMIND_AUDIT_LOG_PATH")
    if audit_raw:
        audit_log_path = Path(audit_raw)
    elif auth_enabled or deployment_mode == "protected":
        audit_log_path = _default_audit_log_path()
    else:
        audit_log_path = None

    feedback_raw = os.getenv("VETMIND_FEEDBACK_LOG_PATH")
    if feedback_raw:
        feedback_log_path = Path(feedback_raw)
    elif backend != "memory":
        feedback_log_path = _default_feedback_log_path()
    else:
        feedback_log_path = None

    lessons_raw = os.getenv("VETMIND_LESSONS_PATH")
    if lessons_raw:
        lessons_path = Path(lessons_raw)
    elif backend != "memory":
        lessons_path = _default_lessons_path()
    else:
        lessons_path = None

    document_ocr_endpoint = os.getenv("VETMIND_DOCUMENT_OCR_ENDPOINT") or None
    try:
        document_ocr_timeout_s = float(os.getenv("VETMIND_DOCUMENT_OCR_TIMEOUT_S", "30"))
    except ValueError:
        document_ocr_timeout_s = 30.0

    return Settings(
        storage_backend=backend,
        sqlite_path=sqlite_path,
        quarantine_root=quarantine_root,
        database_url=database_url,
        async_analyze_delay_ms=delay_ms,
        rag_backend=rag_backend,
        rag_index_path=rag_index_path,
        vision_endpoint=vision_endpoint,
        vision_model_id=vision_model_id,
        vision_api_key=vision_api_key,
        vision_execution_policy=vision_execution_policy,
        vision_modalities=vision_modalities,
        vision_regions=vision_regions,
        vision_species=vision_species,
        vision_priority=vision_priority,
        vision_enabled=vision_enabled,
        vision_source_kind=vision_source_kind,
        vision_timeout_s=max(1.0, vision_timeout_s),
        vision_model_version=vision_model_version,
        vision_max_instances=vision_max_instances,
        vision_max_tensor_bytes=vision_max_tensor_bytes,
        vision_transmit_pixels=vision_transmit_pixels,
        pixel_analysis_opt_in=pixel_analysis_opt_in,
        vlm_enabled=vlm_enabled,
        vlm_model_id=vlm_model_id,
        vlm_chat_model_id=vlm_chat_model_id,
        vlm_timeout_s=max(5.0, vlm_timeout_s),
        vlm_max_images=max(1, min(vlm_max_images, 12)),
        vlm_max_total_frames=max(1, min(vlm_max_total_frames, 1000)),
        vlm_include_localizers=vlm_include_localizers,
        vlm_priority=max(0, vlm_priority),
        local_torch_model_id=local_torch_model_id,
        local_torch_weights_path=local_torch_weights_path,
        local_torch_weights_sha256=local_torch_weights_sha256,
        local_torch_entrypoint=local_torch_entrypoint,
        local_torch_model_version=local_torch_model_version,
        local_torch_device=local_torch_device,
        local_torch_timeout_s=max(1.0, local_torch_timeout_s),
        local_torch_priority=max(0, local_torch_priority),
        local_torch_enabled=local_torch_enabled,
        local_torch_source_kind=local_torch_source_kind,
        local_torch_modalities=local_torch_modalities,
        local_torch_regions=local_torch_regions,
        local_torch_species=local_torch_species,
        local_torch_window_center=local_torch_window_center,
        local_torch_window_width=local_torch_window_width,
        vision_artifact_root=vision_artifact_root,
        vision_calibration_path=vision_calibration_path,
        llm_provider=llm_provider,
        llm_endpoint=llm_endpoint,
        llm_provider_id=llm_provider_id,
        llm_model_id=llm_model_id,
        llm_fallback_model_ids=llm_fallback_model_ids,
        llm_model_version=llm_model_version,
        llm_api_key=llm_api_key,
        llm_timeout_s=llm_timeout_s,
        llm_report_language=llm_report_language,
        report_anatomy_dictionary_path=Path(anatomy_dictionary_path) if anatomy_dictionary_path else None,
        report_anatomy_approvals_path=Path(anatomy_approvals_path) if anatomy_approvals_path else None,
        llm_temperature=llm_temperature,
        llm_max_tokens=max(256, llm_max_tokens),
        llm_json_mode=llm_json_mode,
        llm_prompt_version=llm_prompt_version,
        llm_verify=llm_verify,
        llm_verifier_model_id=llm_verifier_model_id,
        auth_enabled=auth_enabled,
        auth_api_key=auth_api_key,
        jwt_secret=jwt_secret,
        jwt_ttl_seconds=max(60, jwt_ttl),
        refresh_ttl_seconds=max(300, refresh_ttl),
        self_registration_enabled=self_registration_enabled,
        self_registration_owner_clinic_id=self_registration_owner_clinic_id,
        password_reset_ttl_seconds=min(max(300, password_reset_ttl), 24 * 60 * 60),
        public_base_url=public_base_url,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_username=smtp_username,
        smtp_password=smtp_password,
        smtp_from=smtp_from,
        smtp_starttls=smtp_starttls,
        auth_rate_limit_enabled=auth_rate_limit_enabled,
        trust_proxy_headers=trust_proxy_headers,
        job_backend=job_backend,
        redis_url=redis_url,
        deployment_mode=deployment_mode,
        tenant_isolation=tenant_isolation,
        allow_insecure_demo=allow_insecure_demo,
        malware_scan_required=malware_scan_required,
        dicom_identity_scrub=dicom_identity_scrub,
        encryption_at_rest=encryption_at_rest,
        retention_dicom_days=retention_dicom_days,
        retention_temp_hours=max(1, retention_temp_hours),
        retention_artifacts_days=retention_artifacts_days,
        retention_reports_days=retention_reports_days,
        retention_logs_days=max(1, retention_logs_days),
        max_concurrent_analyze=max_concurrent_analyze,
        analyze_gate_path=analyze_gate_path,
        audit_log_path=audit_log_path,
        feedback_log_path=feedback_log_path,
        lessons_path=lessons_path,
        document_ocr_endpoint=document_ocr_endpoint,
        document_ocr_timeout_s=max(1.0, document_ocr_timeout_s),
        demo_seed=_env_bool("VETMIND_DEMO_SEED", False),
        classifier_llm=_env_bool("VETMIND_CLASSIFIER_LLM", False),
        classifier_llm_model_id=(os.getenv("VETMIND_CLASSIFIER_LLM_MODEL_ID") or "").strip() or None,
        classifier_llm_timeout_s=max(1.0, _env_float("VETMIND_CLASSIFIER_LLM_TIMEOUT_S", 20.0)),
    )


MIN_PROTECTED_JWT_SECRET_LENGTH = 32


def validate_security_settings(settings: Settings) -> None:
    """Fail closed for protected / auth-enabled deployments with insecure defaults."""
    if settings.deployment_mode == "protected" and not settings.auth_enabled:
        raise RuntimeError(
            "Protected deployment requires VETMIND_AUTH_ENABLED=1. "
            "Demo mode remains available with VETMIND_DEPLOYMENT_MODE=demo."
        )
    insecure_secret = settings.jwt_secret == DEFAULT_JWT_SECRET
    if settings.auth_enabled and insecure_secret and not settings.allow_insecure_demo:
        raise RuntimeError(
            "Auth is enabled but VETMIND_JWT_SECRET is still the demo default. "
            "Set a strong secret, or set VETMIND_ALLOW_INSECURE_DEMO=1 for local demos only."
        )
    if settings.deployment_mode == "protected" and insecure_secret:
        raise RuntimeError(
            "Protected deployment forbids the demo JWT secret. Set VETMIND_JWT_SECRET."
        )
    if settings.deployment_mode == "protected" and len(settings.jwt_secret) < MIN_PROTECTED_JWT_SECRET_LENGTH:
        raise RuntimeError(
            f"Protected deployment requires VETMIND_JWT_SECRET of at least "
            f"{MIN_PROTECTED_JWT_SECRET_LENGTH} characters (HS256 key strength)."
        )
    # Refuse fake "encryption enabled" claims — NullEncryptor is passthrough only.
    enc = (settings.encryption_at_rest or "none").strip().lower()
    if enc not in {"none", "off", "disabled", ""}:
        raise RuntimeError(
            f"VETMIND_ENCRYPTION_AT_REST={enc!r} is not implemented. "
            "Use 'none' until a real BlobEncryptor + KMS is wired. "
            "Refusing to start with a false encryption claim."
        )
    if settings.deployment_mode == "protected":
        if not settings.malware_scan_required:
            raise RuntimeError(
                "Protected deployment requires VETMIND_MALWARE_SCAN_REQUIRED=1 "
                "(fail-closed scanner). Clinical PHI is not allowed without it."
            )
        if not settings.dicom_identity_scrub:
            raise RuntimeError(
                "Protected deployment requires VETMIND_DICOM_IDENTITY_SCRUB=1."
            )
        if enc in {"none", "off", "disabled", ""}:
            # Honesty lock: protected may run for software readiness tests, but
            # must not claim clinical-data-OK without encryption.
            pass  # encryption remains unimplemented — see readiness docs
