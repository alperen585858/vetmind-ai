"""Runtime settings. Persistence is selectable without changing service code."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    """Environment-driven settings. Defaults favor local demo durability."""

    storage_backend: str  # "memory" | "sqlite"
    sqlite_path: Path
    note: str = (
        "SQLite JSON document store implements CaseRepository. "
        "PostgreSQL can replace the same Protocol later without rewriting orchestrator services."
    )


def _default_sqlite_path() -> Path:
    root = Path(__file__).resolve().parents[1]  # backend/
    return root / "data" / "vetmind.sqlite3"


def load_settings() -> Settings:
    backend = os.getenv("VETMIND_STORAGE", "sqlite").strip().lower()
    if backend not in {"memory", "sqlite"}:
        backend = "sqlite"
    path_raw = os.getenv("VETMIND_SQLITE_PATH")
    sqlite_path = Path(path_raw) if path_raw else _default_sqlite_path()
    return Settings(storage_backend=backend, sqlite_path=sqlite_path)
