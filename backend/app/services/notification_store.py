"""Persist in-app notifications (memory + sqlite sidecar)."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Optional, Protocol

from app.schemas.notifications import AppNotification
from app.storage.sql import Database, SqlConnection, connect_from_settings


class NotificationStore(Protocol):
    def upsert(self, n: AppNotification) -> AppNotification | None:
        """Insert if dedupe_key is new; return None when duplicate."""
        ...

    def list_for(self, recipient: str, *, unread_only: bool = False) -> list[AppNotification]: ...

    def get(self, notification_id: str) -> Optional[AppNotification]: ...

    def save(self, n: AppNotification) -> AppNotification: ...

    def mark_all_read(self, recipient: str) -> int: ...

    def delete(self, notification_id: str) -> bool: ...

    def delete_all_for(self, recipient: str) -> int: ...

    def delete_for_cases(self, case_ids: set[str]) -> int: ...


class InMemoryNotificationStore:
    def __init__(self) -> None:
        self._by_id: dict[str, AppNotification] = {}
        self._dedupe: set[str] = set()

    def upsert(self, n: AppNotification) -> AppNotification | None:
        if n.dedupe_key in self._dedupe:
            return None
        self._dedupe.add(n.dedupe_key)
        self._by_id[n.notification_id] = n
        return n

    def list_for(self, recipient: str, *, unread_only: bool = False) -> list[AppNotification]:
        rows = [n for n in self._by_id.values() if n.recipient_subject == recipient]
        if unread_only:
            rows = [n for n in rows if n.read_at is None]
        return sorted(rows, key=lambda x: x.created_at, reverse=True)

    def get(self, notification_id: str) -> Optional[AppNotification]:
        return self._by_id.get(notification_id)

    def save(self, n: AppNotification) -> AppNotification:
        self._by_id[n.notification_id] = n
        self._dedupe.add(n.dedupe_key)
        return n

    def mark_all_read(self, recipient: str) -> int:
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        n = 0
        for item in self._by_id.values():
            if item.recipient_subject == recipient and item.read_at is None:
                self._by_id[item.notification_id] = item.model_copy(update={"read_at": now})
                n += 1
        return n

    def delete(self, notification_id: str) -> bool:
        item = self._by_id.pop(notification_id, None)
        if item is None:
            return False
        self._dedupe.discard(item.dedupe_key)
        return True

    def delete_all_for(self, recipient: str) -> int:
        doomed = [n for n in self._by_id.values() if n.recipient_subject == recipient]
        for item in doomed:
            del self._by_id[item.notification_id]
            self._dedupe.discard(item.dedupe_key)
        return len(doomed)

    def delete_for_cases(self, case_ids: set[str]) -> int:
        doomed = [n for n in self._by_id.values() if n.case_id in case_ids]
        for item in doomed:
            del self._by_id[item.notification_id]
            self._dedupe.discard(item.dedupe_key)
        return len(doomed)


class SqlNotificationStore:
    """Rows in the shared VetMind database (Postgres, or SQLite for local dev); schema from
    Alembic migrations (#102)."""

    def __init__(self, conn: SqlConnection) -> None:
        self._conn = conn
        # One connection shared by FastAPI's threadpool: serialize every use of it (#36).
        self._lock = threading.RLock()

    def upsert(self, n: AppNotification) -> AppNotification | None:
        with self._lock:
            try:
                self._conn.execute(
                    """
                    INSERT INTO notifications (notification_id, recipient_subject, dedupe_key, created_at, payload)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        n.notification_id,
                        n.recipient_subject,
                        n.dedupe_key,
                        n.created_at.isoformat(),
                        n.model_dump_json(),
                    ),
                )
                self._conn.commit()
                return n
            except self._conn.IntegrityError:
                # Duplicate dedupe_key: end the implicit transaction, or this connection keeps
                # the database write-locked for every other process (e.g. scripts/seed_demo.py).
                self._conn.rollback()
                return None

    def list_for(self, recipient: str, *, unread_only: bool = False) -> list[AppNotification]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT payload FROM notifications WHERE recipient_subject=? ORDER BY created_at DESC",
                (recipient,),
            ).fetchall()
            items = [AppNotification.model_validate_json(r["payload"]) for r in rows]
            if unread_only:
                items = [n for n in items if n.read_at is None]
            return items

    def get(self, notification_id: str) -> Optional[AppNotification]:
        with self._lock:
            row = self._conn.execute(
                "SELECT payload FROM notifications WHERE notification_id=?",
                (notification_id,),
            ).fetchone()
            return AppNotification.model_validate_json(row["payload"]) if row else None

    def save(self, n: AppNotification) -> AppNotification:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO notifications (notification_id, recipient_subject, dedupe_key, created_at, payload)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(notification_id) DO UPDATE SET
                  recipient_subject=excluded.recipient_subject,
                  dedupe_key=excluded.dedupe_key,
                  created_at=excluded.created_at,
                  payload=excluded.payload
                """,
                (
                    n.notification_id,
                    n.recipient_subject,
                    n.dedupe_key,
                    n.created_at.isoformat(),
                    n.model_dump_json(),
                ),
            )
            self._conn.commit()
            return n

    def mark_all_read(self, recipient: str) -> int:
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        items = self.list_for(recipient, unread_only=True)
        for item in items:
            self.save(item.model_copy(update={"read_at": now}))
        return len(items)

    def delete(self, notification_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute(
                "DELETE FROM notifications WHERE notification_id=?",
                (notification_id,),
            )
            self._conn.commit()
            return cur.rowcount > 0

    def delete_all_for(self, recipient: str) -> int:
        with self._lock:
            cur = self._conn.execute(
                "DELETE FROM notifications WHERE recipient_subject=?",
                (recipient,),
            )
            self._conn.commit()
            return cur.rowcount

    def delete_for_cases(self, case_ids: set[str]) -> int:
        with self._lock:
            rows = self._conn.execute("SELECT notification_id, payload FROM notifications").fetchall()
            doomed = [
                r["notification_id"]
                for r in rows
                if AppNotification.model_validate_json(r["payload"]).case_id in case_ids
            ]
            self._conn.executemany(
                "DELETE FROM notifications WHERE notification_id=?", [(i,) for i in doomed]
            )
            self._conn.commit()
            return len(doomed)


class SqliteNotificationStore(SqlNotificationStore):
    """Same store on one SQLite file (tests, local dev, old-data migration)."""

    def __init__(self, db_path: Path | str) -> None:
        super().__init__(Database.sqlite(db_path).connect())


def build_notification_store(settings) -> NotificationStore:
    if settings.storage_backend == "memory":
        return InMemoryNotificationStore()
    return SqlNotificationStore(connect_from_settings(settings))