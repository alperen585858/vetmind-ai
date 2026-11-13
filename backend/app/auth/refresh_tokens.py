"""Opaque, rotating refresh tokens (issue #31 step 3).

- The raw token is 32 random bytes (urlsafe base64) returned to the client once.
  Only its SHA-256 is stored, so a leaked database does not leak usable tokens.
- Every refresh rotates: the presented token is revoked and a new one is issued in
  the same *family* (one family per sign-in).
- Presenting an already-rotated token is treated as theft: the whole family is
  revoked, so both the attacker and the victim must sign in again.
- A refresh is refused when the user is gone/inactive or their ``token_version``
  changed (password change) since the family was issued.
"""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Callable, Optional, Protocol

from app.auth.security import DemoUserRecord


class RefreshTokenError(Exception):
    """Refresh refused. ``reason`` is a short code for audit logs (never shown to users)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class RefreshRecord:
    token_hash: str
    subject: str
    family_id: str
    token_version: int
    created_at: float
    expires_at: float
    revoked_at: Optional[float] = None
    replaced_by: Optional[str] = None


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class RefreshTokenStore(Protocol):
    def save(self, rec: RefreshRecord) -> None: ...

    def get(self, token_hash: str) -> Optional[RefreshRecord]: ...

    def revoke_family(self, family_id: str, at: float) -> int: ...

    def revoke_subject(self, subject: str, at: float) -> int: ...


class InMemoryRefreshTokenStore:
    def __init__(self) -> None:
        self._rows: dict[str, RefreshRecord] = {}

    def save(self, rec: RefreshRecord) -> None:
        self._rows[rec.token_hash] = rec

    def get(self, token_hash: str) -> Optional[RefreshRecord]:
        return self._rows.get(token_hash)

    def _revoke_where(self, pred: Callable[[RefreshRecord], bool], at: float) -> int:
        n = 0
        for key, rec in list(self._rows.items()):
            if rec.revoked_at is None and pred(rec):
                self._rows[key] = replace(rec, revoked_at=at)
                n += 1
        return n

    def revoke_family(self, family_id: str, at: float) -> int:
        return self._revoke_where(lambda r: r.family_id == family_id, at)

    def revoke_subject(self, subject: str, at: float) -> int:
        return self._revoke_where(lambda r: r.subject == subject, at)


class SqliteRefreshTokenStore:
    def __init__(self, db_path: Path | str) -> None:
        path = Path(db_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=DELETE;")
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                token_hash TEXT PRIMARY KEY,
                subject TEXT NOT NULL,
                family_id TEXT NOT NULL,
                token_version INTEGER NOT NULL,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL,
                revoked_at REAL,
                replaced_by TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_refresh_family ON refresh_tokens(family_id);
            CREATE INDEX IF NOT EXISTS ix_refresh_subject ON refresh_tokens(subject);
            """
        )
        self._conn.commit()

    def save(self, rec: RefreshRecord) -> None:
        self._conn.execute(
            """
            INSERT INTO refresh_tokens
                (token_hash, subject, family_id, token_version, created_at, expires_at, revoked_at, replaced_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(token_hash) DO UPDATE SET
                revoked_at=excluded.revoked_at, replaced_by=excluded.replaced_by
            """,
            (
                rec.token_hash,
                rec.subject,
                rec.family_id,
                rec.token_version,
                rec.created_at,
                rec.expires_at,
                rec.revoked_at,
                rec.replaced_by,
            ),
        )
        self._conn.commit()

    def get(self, token_hash: str) -> Optional[RefreshRecord]:
        row = self._conn.execute(
            "SELECT * FROM refresh_tokens WHERE token_hash=?", (token_hash,)
        ).fetchone()
        return RefreshRecord(**dict(row)) if row else None

    def revoke_family(self, family_id: str, at: float) -> int:
        cur = self._conn.execute(
            "UPDATE refresh_tokens SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL",
            (at, family_id),
        )
        self._conn.commit()
        return cur.rowcount

    def revoke_subject(self, subject: str, at: float) -> int:
        cur = self._conn.execute(
            "UPDATE refresh_tokens SET revoked_at=? WHERE subject=? AND revoked_at IS NULL",
            (at, subject),
        )
        self._conn.commit()
        return cur.rowcount


def build_refresh_token_store(settings) -> RefreshTokenStore:
    if settings.storage_backend == "memory":
        return InMemoryRefreshTokenStore()
    # sqlite and postgres deployments keep auth sidecar data next to the case DB,
    # like the workflow store.
    return SqliteRefreshTokenStore(Path(settings.sqlite_path).with_name("vetmind_auth.sqlite3"))


class RefreshTokenService:
    def __init__(
        self,
        store: RefreshTokenStore,
        *,
        ttl_seconds: int,
        directory: dict[str, DemoUserRecord],
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._store = store
        self._ttl = ttl_seconds
        self._directory = directory
        self._clock = clock
        self._lock = threading.Lock()

    @property
    def ttl_seconds(self) -> int:
        return self._ttl

    def issue(self, subject: str, *, token_version: int, family_id: str | None = None) -> str:
        raw = secrets.token_urlsafe(32)
        now = self._clock()
        self._store.save(
            RefreshRecord(
                token_hash=hash_refresh_token(raw),
                subject=subject.lower(),
                family_id=family_id or secrets.token_hex(16),
                token_version=token_version,
                created_at=now,
                expires_at=now + self._ttl,
            )
        )
        return raw

    def rotate(self, raw: str) -> tuple[str, DemoUserRecord, str]:
        """Exchange ``raw`` for a new refresh token. Returns (subject, user, new_raw)."""
        if not raw:
            raise RefreshTokenError("missing")
        now = self._clock()
        with self._lock:
            rec = self._store.get(hash_refresh_token(raw))
            if rec is None:
                raise RefreshTokenError("unknown")
            if rec.revoked_at is not None:
                # A rotated/revoked token came back: assume it was stolen.
                self._store.revoke_family(rec.family_id, now)
                raise RefreshTokenError("reused")
            if rec.expires_at <= now:
                self._store.revoke_family(rec.family_id, now)
                raise RefreshTokenError("expired")
            user = self._directory.get(rec.subject)
            if user is None:
                self._store.revoke_family(rec.family_id, now)
                raise RefreshTokenError("user_inactive")
            if user.token_version != rec.token_version:
                self._store.revoke_family(rec.family_id, now)
                raise RefreshTokenError("token_version_changed")
            new_raw = secrets.token_urlsafe(32)
            new_hash = hash_refresh_token(new_raw)
            self._store.save(replace(rec, revoked_at=now, replaced_by=new_hash))
            self._store.save(
                RefreshRecord(
                    token_hash=new_hash,
                    subject=rec.subject,
                    family_id=rec.family_id,
                    token_version=rec.token_version,
                    created_at=now,
                    # Sliding window: a session left idle longer than the TTL ends.
                    expires_at=now + self._ttl,
                )
            )
        return rec.subject, user, new_raw

    def revoke(self, raw: str) -> str | None:
        """Sign-out: revoke the presented token's family. Returns the subject if known."""
        if not raw:
            return None
        rec = self._store.get(hash_refresh_token(raw))
        if rec is None:
            return None
        self._store.revoke_family(rec.family_id, self._clock())
        return rec.subject

    def revoke_all_for(self, subject: str) -> int:
        return self._store.revoke_subject(subject.lower(), self._clock())
