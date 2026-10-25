"""Persist owner↔radiologist/admin support threads."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional, Protocol

from app.schemas.messaging import SupportThread


class MessagingStore(Protocol):
    def save_thread(self, thread: SupportThread) -> SupportThread: ...

    def get_thread(self, thread_id: str) -> Optional[SupportThread]: ...

    def list_threads(self) -> list[SupportThread]: ...

    def delete_thread(self, thread_id: str) -> bool: ...


class InMemoryMessagingStore:
    def __init__(self) -> None:
        self._threads: dict[str, SupportThread] = {}

    def save_thread(self, thread: SupportThread) -> SupportThread:
        self._threads[thread.thread_id] = thread
        return thread

    def get_thread(self, thread_id: str) -> Optional[SupportThread]:
        return self._threads.get(thread_id)

    def list_threads(self) -> list[SupportThread]:
        return sorted(self._threads.values(), key=lambda t: t.updated_at, reverse=True)

    def delete_thread(self, thread_id: str) -> bool:
        return self._threads.pop(thread_id, None) is not None


class SqliteMessagingStore:
    def __init__(self, db_path: Path | str) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=DELETE;")
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS support_threads (
                thread_id TEXT PRIMARY KEY,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            """
        )
        self._conn.commit()

    def save_thread(self, thread: SupportThread) -> SupportThread:
        self._conn.execute(
            """
            INSERT INTO support_threads (thread_id, updated_at, payload) VALUES (?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET
                updated_at=excluded.updated_at,
                payload=excluded.payload
            """,
            (thread.thread_id, thread.updated_at.isoformat(), thread.model_dump_json()),
        )
        self._conn.commit()
        return thread

    def get_thread(self, thread_id: str) -> Optional[SupportThread]:
        row = self._conn.execute(
            "SELECT payload FROM support_threads WHERE thread_id=?", (thread_id,)
        ).fetchone()
        return SupportThread.model_validate_json(row["payload"]) if row else None

    def list_threads(self) -> list[SupportThread]:
        rows = self._conn.execute(
            "SELECT payload FROM support_threads ORDER BY updated_at DESC"
        ).fetchall()
        return [SupportThread.model_validate_json(r["payload"]) for r in rows]

    def delete_thread(self, thread_id: str) -> bool:
        cur = self._conn.execute("DELETE FROM support_threads WHERE thread_id=?", (thread_id,))
        self._conn.commit()
        return cur.rowcount > 0


def build_messaging_store(settings) -> MessagingStore:
    if settings.storage_backend == "memory":
        return InMemoryMessagingStore()
    path = Path(settings.sqlite_path).with_name("vetmind_messaging.sqlite3")
    return SqliteMessagingStore(path)
