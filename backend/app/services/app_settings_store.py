"""Settings an admin changes from the UI (issue #107: which roles must use 2FA).

One JSON document per key. Memory for tests; the shared SQL database otherwise (Alembic 0005).
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from typing import Any, Protocol

from app.storage.sql import SqlConnection, connect_from_settings


class AppSettingsStore(Protocol):
    def get(self, key: str) -> dict[str, Any] | None: ...

    def set(self, key: str, value: dict[str, Any], *, updated_by: str | None = None) -> None: ...


class InMemoryAppSettingsStore:
    def __init__(self) -> None:
        self._rows: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._rows.get(key)
            return dict(row) if row is not None else None

    def set(self, key: str, value: dict[str, Any], *, updated_by: str | None = None) -> None:
        with self._lock:
            self._rows[key] = dict(value)


class SqlAppSettingsStore:
    def __init__(self, conn: SqlConnection) -> None:
        self._conn = conn
        # One connection shared by FastAPI's threadpool: serialize every use of it (#36).
        self._lock = threading.RLock()

    def get(self, key: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT payload FROM app_settings WHERE key=?", (key,)).fetchone()
        if row is None:
            return None
        payload = row["payload"]
        return json.loads(payload) if isinstance(payload, str) else dict(payload)

    def set(self, key: str, value: dict[str, Any], *, updated_by: str | None = None) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO app_settings (key, payload, updated_at, updated_by) VALUES (?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    payload=excluded.payload, updated_at=excluded.updated_at, updated_by=excluded.updated_by
                """,
                (key, json.dumps(value, ensure_ascii=False), now, updated_by),
            )
            self._conn.commit()


def build_app_settings_store(settings) -> AppSettingsStore:
    if settings.storage_backend == "memory":
        return InMemoryAppSettingsStore()
    return SqlAppSettingsStore(connect_from_settings(settings))
