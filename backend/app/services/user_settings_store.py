"""Persist per-user settings (memory + sqlite sidecar)."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Protocol

from app.schemas.user_settings import UserSettings, UserSettingsUpdate, utcnow
from app.storage.sql import Database, SqlConnection, connect_from_settings


class UserSettingsStore(Protocol):
    def get(self, subject: str) -> UserSettings: ...

    def get_stored(self, subject: str) -> UserSettings | None:
        """Only settings the user actually saved (``get`` falls back to defaults)."""
        ...

    def update(self, subject: str, patch: UserSettingsUpdate) -> UserSettings: ...


def _defaults(subject: str) -> UserSettings:
    return UserSettings(subject=subject)


def _apply(current: UserSettings, patch: UserSettingsUpdate) -> UserSettings:
    data = current.model_dump()
    for key, value in patch.model_dump(exclude_unset=True).items():
        if value is not None:
            data[key] = value.strip() if isinstance(value, str) else value
    data["updated_at"] = utcnow()
    return UserSettings.model_validate(data)


class InMemoryUserSettingsStore:
    def __init__(self) -> None:
        self._by_subject: dict[str, UserSettings] = {}

    def get(self, subject: str) -> UserSettings:
        key = subject.strip().lower()
        return self._by_subject.get(key) or _defaults(key)

    def get_stored(self, subject: str) -> UserSettings | None:
        return self._by_subject.get(subject.strip().lower())

    def update(self, subject: str, patch: UserSettingsUpdate) -> UserSettings:
        key = subject.strip().lower()
        updated = _apply(self.get(key), patch)
        self._by_subject[key] = updated
        return updated


class SqlUserSettingsStore:
    """Rows in the shared VetMind database (Postgres, or SQLite for local dev); schema from
    Alembic migrations (#102)."""

    def __init__(self, conn: SqlConnection) -> None:
        self._conn = conn
        # One connection shared by FastAPI's threadpool: serialize every use of it (#36).
        self._lock = threading.RLock()

    def get(self, subject: str) -> UserSettings:
        with self._lock:
            key = subject.strip().lower()
            row = self._conn.execute(
                "SELECT payload FROM user_settings WHERE subject=?",
                (key,),
            ).fetchone()
            if not row:
                return _defaults(key)
            return UserSettings.model_validate_json(row["payload"])

    def get_stored(self, subject: str) -> UserSettings | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT payload FROM user_settings WHERE subject=?",
                (subject.strip().lower(),),
            ).fetchone()
            return UserSettings.model_validate_json(row["payload"]) if row else None

    def update(self, subject: str, patch: UserSettingsUpdate) -> UserSettings:
        with self._lock:
            key = subject.strip().lower()
            updated = _apply(self.get(key), patch)
            self._conn.execute(
                """
                INSERT INTO user_settings (subject, payload, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(subject) DO UPDATE SET
                  payload=excluded.payload,
                  updated_at=excluded.updated_at
                """,
                (key, updated.model_dump_json(), updated.updated_at.isoformat()),
            )
            self._conn.commit()
            return updated


class SqliteUserSettingsStore(SqlUserSettingsStore):
    """Same store on one SQLite file (tests, local dev, old-data migration)."""

    def __init__(self, db_path: Path | str) -> None:
        super().__init__(Database.sqlite(db_path).connect())


def build_user_settings_store(settings) -> UserSettingsStore:
    if settings.storage_backend == "memory":
        return InMemoryUserSettingsStore()
    return SqlUserSettingsStore(connect_from_settings(settings))