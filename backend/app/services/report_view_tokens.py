"""Single-use, time-limited tokens for unauthenticated approved-report viewing.

Raw token goes only into the emailed link; the store keeps SHA-256.
Issuing a new token for a case invalidates older unused ones.
"""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Optional, Protocol


class ReportViewTokenError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class ReportViewRecord:
    token_hash: str
    case_id: str
    report_version: int
    created_at: float
    expires_at: float
    used_at: Optional[float] = None
    revoked_at: Optional[float] = None


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class ReportViewTokenStore(Protocol):
    def save(self, rec: ReportViewRecord) -> None: ...

    def get(self, token_hash: str) -> Optional[ReportViewRecord]: ...

    def invalidate_case(self, case_id: str, at: float) -> int: ...


class InMemoryReportViewTokenStore:
    def __init__(self) -> None:
        self._rows: dict[str, ReportViewRecord] = {}

    def save(self, rec: ReportViewRecord) -> None:
        self._rows[rec.token_hash] = rec

    def get(self, token_hash: str) -> Optional[ReportViewRecord]:
        return self._rows.get(token_hash)

    def invalidate_case(self, case_id: str, at: float) -> int:
        n = 0
        for key, rec in list(self._rows.items()):
            if rec.case_id == case_id and rec.used_at is None and rec.revoked_at is None:
                self._rows[key] = replace(rec, revoked_at=at)
                n += 1
        return n


class SqliteReportViewTokenStore:
    def __init__(self, db_path: Path | str) -> None:
        path = Path(db_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._conn.execute("PRAGMA journal_mode=DELETE;")
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS report_view_tokens (
                token_hash TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                report_version INTEGER NOT NULL,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL,
                used_at REAL,
                revoked_at REAL
            );
            CREATE INDEX IF NOT EXISTS ix_report_view_case ON report_view_tokens(case_id);
            """
        )
        self._conn.commit()

    def save(self, rec: ReportViewRecord) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO report_view_tokens
                  (token_hash, case_id, report_version, created_at, expires_at, used_at, revoked_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(token_hash) DO UPDATE SET
                  used_at=excluded.used_at,
                  revoked_at=excluded.revoked_at
                """,
                (
                    rec.token_hash,
                    rec.case_id,
                    rec.report_version,
                    rec.created_at,
                    rec.expires_at,
                    rec.used_at,
                    rec.revoked_at,
                ),
            )
            self._conn.commit()

    def get(self, token_hash: str) -> Optional[ReportViewRecord]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM report_view_tokens WHERE token_hash=?", (token_hash,)
            ).fetchone()
        return ReportViewRecord(**dict(row)) if row else None

    def invalidate_case(self, case_id: str, at: float) -> int:
        with self._lock:
            cur = self._conn.execute(
                """
                UPDATE report_view_tokens
                SET revoked_at=?
                WHERE case_id=? AND used_at IS NULL AND revoked_at IS NULL
                """,
                (at, case_id),
            )
            self._conn.execute(
                "DELETE FROM report_view_tokens WHERE expires_at < ?",
                (at - 24 * 60 * 60,),
            )
            self._conn.commit()
            return cur.rowcount


def build_report_view_token_store(settings) -> ReportViewTokenStore:
    if settings.storage_backend == "memory":
        return InMemoryReportViewTokenStore()
    path = Path(settings.sqlite_path).with_name("report_view_tokens.sqlite3")
    return SqliteReportViewTokenStore(path)


class ReportViewTokenService:
    def __init__(self, store: ReportViewTokenStore, *, ttl_seconds: int = 72 * 3600) -> None:
        self._store = store
        self.ttl_seconds = max(60, int(ttl_seconds))

    def issue(self, *, case_id: str, report_version: int) -> str:
        now = time.time()
        self._store.invalidate_case(case_id, now)
        raw = secrets.token_urlsafe(32)
        rec = ReportViewRecord(
            token_hash=_hash(raw),
            case_id=case_id,
            report_version=report_version,
            created_at=now,
            expires_at=now + self.ttl_seconds,
        )
        self._store.save(rec)
        return raw

    def peek(self, raw: str) -> ReportViewRecord:
        """Validate without consuming (for GET preview)."""
        rec = self._store.get(_hash(raw.strip()))
        if rec is None:
            raise ReportViewTokenError("invalid")
        now = time.time()
        if rec.revoked_at is not None:
            raise ReportViewTokenError("revoked")
        if rec.used_at is not None:
            raise ReportViewTokenError("used")
        if rec.expires_at < now:
            raise ReportViewTokenError("expired")
        return rec

    def consume(self, raw: str) -> ReportViewRecord:
        rec = self.peek(raw)
        now = time.time()
        used = replace(rec, used_at=now)
        self._store.save(used)
        return used

    def revoke_case(self, case_id: str) -> int:
        return self._store.invalidate_case(case_id, time.time())
