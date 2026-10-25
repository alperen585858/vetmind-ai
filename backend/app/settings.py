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
    # LLM provider: mock (default) | stub | http (requires llm_endpoint; no startup probe)
    # | openai (any OpenAI-compatible API) | ollama | anthropic.
    llm_provider: str = "mock"
    llm_endpoint: str | None = None
    llm_provider_id: str = "http-llm"
    llm_model_id: str = "generic-http-llm"
    llm_model_version: str = "0.1.0"
    llm_api_key: str | None = None
    llm_timeout_s: float = 30.0
    llm_report_language: str = "tr"  # tr | en — language of generated report text
    llm_temperature: float | None = 0.2
    llm_max_tokens: int = 2048
    llm_json_mode: str = "schema"  # schema | object | none (OpenAI-compatible only)
    auth_enabled: bool = False
    auth_api_key: str | None = None
    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_ttl_seconds: int = 60 * 60 * 12
    job_backend: str = "thread"  # "thread" | "rq"
    redis_url: str | None = None
    # Phase 5 — security / privacy / performance
    deployment_mode: str = "demo"  # demo | protected
    tenant_isolation: bool = False
    allow_insecure_demo: bool = False
    malware_scan_required: bool = False
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
    # Load scripted demo cases on startup when the case store is empty (app.demo_seed).
    demo_seed: bool = False
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


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_optional_int(name: str) -> int | None:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def load_settings() -> Settings:
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

    llm_provider = os.getenv("VETMIND_LLM_PROVIDER", "mock").strip().lower() or "mock"
    llm_endpoint = os.getenv("VETMIND_LLM_ENDPOINT") or None
    llm_provider_id = os.getenv("VETMIND_LLM_PROVIDER_ID", "http-llm").strip() or "http-llm"
    llm_model_id = os.getenv("VETMIND_LLM_MODEL_ID", "generic-http-llm").strip() or "generic-http-llm"
    llm_model_version = os.getenv("VETMIND_LLM_MODEL_VERSION", "0.1.0").strip() or "0.1.0"
    llm_api_key = os.getenv("VETMIND_LLM_API_KEY") or None
    try:
        llm_timeout_s = float(os.getenv("VETMIND_LLM_TIMEOUT_S", "30"))
    except ValueError:
        llm_timeout_s = 30.0
    llm_report_language = os.getenv("VETMIND_LLM_REPORT_LANGUAGE", "tr").strip().lower() or "tr"
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

    auth_enabled = _env_bool("VETMIND_AUTH_ENABLED", False)
    auth_api_key = os.getenv("VETMIND_API_KEY") or None
    jwt_secret = os.getenv("VETMIND_JWT_SECRET", DEFAULT_JWT_SECRET)
    try:
        jwt_ttl = int(os.getenv("VETMIND_JWT_TTL_SECONDS", str(60 * 60 * 12)))
    except ValueError:
        jwt_ttl = 60 * 60 * 12

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
        llm_provider=llm_provider,
        llm_endpoint=llm_endpoint,
        llm_provider_id=llm_provider_id,
        llm_model_id=llm_model_id,
        llm_model_version=llm_model_version,
        llm_api_key=llm_api_key,
        llm_timeout_s=llm_timeout_s,
        llm_report_language=llm_report_language,
        llm_temperature=llm_temperature,
        llm_max_tokens=max(256, llm_max_tokens),
        llm_json_mode=llm_json_mode,
        auth_enabled=auth_enabled,
        auth_api_key=auth_api_key,
        jwt_secret=jwt_secret,
        jwt_ttl_seconds=max(60, jwt_ttl),
        job_backend=job_backend,
        redis_url=redis_url,
        deployment_mode=deployment_mode,
        tenant_isolation=tenant_isolation,
        allow_insecure_demo=allow_insecure_demo,
        malware_scan_required=malware_scan_required,
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
        demo_seed=_env_bool("VETMIND_DEMO_SEED", False),
    )


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
    # Refuse fake "encryption enabled" claims — NullEncryptor is passthrough only.
    enc = (settings.encryption_at_rest or "none").strip().lower()
    if enc not in {"none", "off", "disabled", ""}:
        raise RuntimeError(
            f"VETMIND_ENCRYPTION_AT_REST={enc!r} is not implemented. "
            "Use 'none' until a real BlobEncryptor + KMS is wired. "
            "Refusing to start with a false encryption claim."
        )
