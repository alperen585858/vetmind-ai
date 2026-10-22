"""Runtime settings. Persistence / RAG / auth / vision / jobs are selectable via env."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


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
    # LLM provider: mock (default) | stub | http (requires llm_endpoint; no startup probe).
    llm_provider: str = "mock"
    llm_endpoint: str | None = None
    llm_provider_id: str = "http-llm"
    llm_model_id: str = "generic-http-llm"
    llm_model_version: str = "0.1.0"
    llm_api_key: str | None = None
    llm_timeout_s: float = 30.0
    auth_enabled: bool = False
    auth_api_key: str | None = None
    jwt_secret: str = "vetmind-demo-secret-change-me"
    jwt_ttl_seconds: int = 60 * 60 * 12
    job_backend: str = "thread"  # "thread" | "rq"
    redis_url: str | None = None
    note: str = (
        "CaseRepository: memory | sqlite | postgres. "
        "Optional remote Vision via VETMIND_VISION_ENDPOINT. "
        "Auth off by default (VETMIND_AUTH_ENABLED=1 to enforce). "
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

    auth_enabled = os.getenv("VETMIND_AUTH_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"}
    auth_api_key = os.getenv("VETMIND_API_KEY") or None
    jwt_secret = os.getenv("VETMIND_JWT_SECRET", "vetmind-demo-secret-change-me")
    try:
        jwt_ttl = int(os.getenv("VETMIND_JWT_TTL_SECONDS", str(60 * 60 * 12)))
    except ValueError:
        jwt_ttl = 60 * 60 * 12

    job_backend = os.getenv("VETMIND_JOB_BACKEND", "thread").strip().lower()
    if job_backend not in {"thread", "rq"}:
        job_backend = "thread"
    redis_url = os.getenv("VETMIND_REDIS_URL") or None

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
        llm_provider=llm_provider,
        llm_endpoint=llm_endpoint,
        llm_provider_id=llm_provider_id,
        llm_model_id=llm_model_id,
        llm_model_version=llm_model_version,
        llm_api_key=llm_api_key,
        llm_timeout_s=llm_timeout_s,
        auth_enabled=auth_enabled,
        auth_api_key=auth_api_key,
        jwt_secret=jwt_secret,
        jwt_ttl_seconds=max(60, jwt_ttl),
        job_backend=job_backend,
        redis_url=redis_url,
    )
