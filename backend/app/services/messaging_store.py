"""Persist owner↔radiologist/admin support threads."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Optional, Protocol

from app.schemas.messaging import SupportThread
from app.storage.sql import Database, SqlConnection, connect_from_settings


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


class SqlMessagingStore:
    """Rows in the shared VetMind database (Postgres, or SQLite for local dev); schema from
    Alembic migrations (#102)."""

    def __init__(self, conn: SqlConnection) -> None:
        self._conn = conn
        # One connection shared by FastAPI's threadpool: serialize every use of it (#36).
        self._lock = threading.RLock()

    def save_thread(self, thread: SupportThread) -> SupportThread:
        with self._lock:
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
        with self._lock:
            row = self._conn.execute(
                "SELECT payload FROM support_threads WHERE thread_id=?", (thread_id,)
            ).fetchone()
            return SupportThread.model_validate_json(row["payload"]) if row else None

    def list_threads(self) -> list[SupportThread]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT payload FROM support_threads ORDER BY updated_at DESC"
            ).fetchall()
            return [SupportThread.model_validate_json(r["payload"]) for r in rows]

    def delete_thread(self, thread_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM support_threads WHERE thread_id=?", (thread_id,))
            self._conn.commit()
            return cur.rowcount > 0


class SqliteMessagingStore(SqlMessagingStore):
    """Same store on one SQLite file (tests, local dev, old-data migration)."""

    def __init__(self, db_path: Path | str) -> None:
        super().__init__(Database.sqlite(db_path).connect())


def build_messaging_store(settings) -> MessagingStore:
    if settings.storage_backend == "memory":
        return InMemoryMessagingStore()
    return SqlMessagingStore(connect_from_settings(settings))