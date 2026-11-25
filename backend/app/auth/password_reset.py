"""Single-use password reset tokens (issue #31 step 4).

The raw token (32 random bytes, urlsafe) goes only into the emailed link; the store keeps
its SHA-256. A token is valid for ``ttl_seconds``, works once, and issuing a new one for the
same user invalidates the older ones.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Callable, Optional, Protocol

from app.storage.sql import Database, SqlConnection, connect_from_settings


class PasswordResetError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class ResetRecord:
    token_hash: str
    subject: str
    created_at: float
    expires_at: float
    used_at: Optional[float] = None


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class PasswordResetStore(Protocol):
    def save(self, rec: ResetRecord) -> None: ...

    def get(self, token_hash: str) -> Optional[ResetRecord]: ...

    def invalidate_subject(self, subject: str, at: float) -> int: ...


class InMemoryPasswordResetStore:
    def __init__(self) -> None:
        self._rows: dict[str, ResetRecord] = {}

    def save(self, rec: ResetRecord) -> None:
        self._rows[rec.token_hash] = rec

    def get(self, token_hash: str) -> Optional[ResetRecord]:
        return self._rows.get(token_hash)

    def invalidate_subject(self, subject: str, at: float) -> int:
        n = 0
        for key, rec in list(self._rows.items()):
            if rec.subject == subject and rec.used_at is None:
                self._rows[key] = replace(rec, used_at=at)
                n += 1
        return n


class SqlPasswordResetStore:
    """Rows in the shared VetMind database (Postgres, or SQLite for local dev); schema from
    Alembic migrations (#102)."""

    def __init__(self, conn: SqlConnection, *, table: str = "password_resets") -> None:
        self._conn = conn
        # Same row shape is reused for email verification links (issue #41).
        if table not in {"password_resets", "email_verifications"}:
            raise ValueError(f"unknown token table: {table}")
        self._table = table
        # One connection shared by FastAPI's threadpool: serialize every use of it (#36).
        self._lock = threading.RLock()

    def save(self, rec: ResetRecord) -> None:
        with self._lock:
            self._conn.execute(
                f"""
                INSERT INTO {self._table} (token_hash, subject, created_at, expires_at, used_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(token_hash) DO UPDATE SET used_at=excluded.used_at
                """,
                (rec.token_hash, rec.subject, rec.created_at, rec.expires_at, rec.used_at),
            )
            self._conn.commit()

    def get(self, token_hash: str) -> Optional[ResetRecord]:
        with self._lock:
            row = self._conn.execute(
                f"SELECT * FROM {self._table} WHERE token_hash=?", (token_hash,)
            ).fetchone()
        return ResetRecord(**dict(row)) if row else None

    def invalidate_subject(self, subject: str, at: float) -> int:
        with self._lock:
            cur = self._conn.execute(
                f"UPDATE {self._table} SET used_at=? WHERE subject=? AND used_at IS NULL", (at, subject)
            )
            # Housekeeping: rows past expiry can never be used again.
            self._conn.execute(f"DELETE FROM {self._table} WHERE expires_at < ?", (at - 24 * 60 * 60,))
            self._conn.commit()
            return cur.rowcount


class SqlitePasswordResetStore(SqlPasswordResetStore):
    """Same store on one SQLite file (tests, local dev, old-data migration)."""

    def __init__(self, db_path: Path | str, *, table: str = "password_resets") -> None:
        super().__init__(Database.sqlite(db_path).connect(), table=table)


def build_password_reset_store(settings) -> PasswordResetStore:
    if settings.storage_backend == "memory":
        return InMemoryPasswordResetStore()
    return SqlPasswordResetStore(connect_from_settings(settings))

class PasswordResetService:
    def __init__(
        self,
        store: PasswordResetStore,
        *,
        ttl_seconds: int,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._store = store
        self._ttl = ttl_seconds
        self._clock = clock
        self._lock = threading.Lock()

    @property
    def ttl_seconds(self) -> int:
        return self._ttl

    def issue(self, subject: str) -> str:
        subject = subject.lower()
        raw = secrets.token_urlsafe(32)
        now = self._clock()
        with self._lock:
            self._store.invalidate_subject(subject, now)
            self._store.save(ResetRecord(_hash(raw), subject, now, now + self._ttl))
        return raw

    def consume(self, raw: str) -> str:
        """Mark the token used and return its subject. Raises PasswordResetError."""
        if not raw:
            raise PasswordResetError("missing")
        with self._lock:
            rec = self._store.get(_hash(raw))
            self._check(rec)
            assert rec is not None
            now = self._clock()
            self._store.save(replace(rec, used_at=now))
            # Any other outstanding link for this user is void too.
            self._store.invalidate_subject(rec.subject, now)
        return rec.subject

    def _check(self, rec: ResetRecord | None) -> None:
        if rec is None:
            raise PasswordResetError("unknown")
        if rec.used_at is not None:
            raise PasswordResetError("used")
        if rec.expires_at <= self._clock():
            raise PasswordResetError("expired")
