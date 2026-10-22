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
        auth_enabled=auth_enabled,
        auth_api_key=auth_api_key,
        jwt_secret=jwt_secret,
        jwt_ttl_seconds=max(60, jwt_ttl),
        job_backend=job_backend,
        redis_url=redis_url,
    )
