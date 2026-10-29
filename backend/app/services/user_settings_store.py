"""Persist per-user settings (memory + sqlite sidecar)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Protocol

from app.schemas.user_settings import UserSettings, UserSettingsUpdate, utcnow


class UserSettingsStore(Protocol):
    def get(self, subject: str) -> UserSettings: ...

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

    def update(self, subject: str, patch: UserSettingsUpdate) -> UserSettings:
        key = subject.strip().lower()
        updated = _apply(self.get(key), patch)
        self._by_subject[key] = updated
        return updated


class SqliteUserSettingsStore:
    def __init__(self, db_path: Path | str) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=DELETE;")
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS user_settings (
                subject TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        self._conn.commit()

    def get(self, subject: str) -> UserSettings:
        key = subject.strip().lower()
        row = self._conn.execute(
            "SELECT payload FROM user_settings WHERE subject=?",
            (key,),
        ).fetchone()
        if not row:
            return _defaults(key)
        return UserSettings.model_validate_json(row["payload"])

    def update(self, subject: str, patch: UserSettingsUpdate) -> UserSettings:
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


def build_user_settings_store(settings) -> UserSettingsStore:
    if settings.storage_backend == "memory":
        return InMemoryUserSettingsStore()
    path = Path(settings.sqlite_path).with_name("vetmind_user_settings.sqlite3")
    return SqliteUserSettingsStore(path)
