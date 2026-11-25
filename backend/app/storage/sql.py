"""One relational database for every store (#102): PostgreSQL by default, SQLite for local dev.

Stores keep writing plain SQL with ``?`` placeholders and ``ON CONFLICT ... DO UPDATE``
(valid in both). ``SqlConnection`` hides the driver: it turns ``?`` into ``%s`` for psycopg,
returns rows that support ``row["col"]`` and ``dict(row)``, and reads JSONB back as text so
``Model.model_validate_json(row["payload"])`` works on both.

The schema is not created by the stores: Alembic migrations (``backend/migrations``) build it,
once per database per process, when ``Database.connect`` is first called.
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable, Sequence

BACKEND_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = BACKEND_ROOT / "migrations"

_migrated: set[str] = set()
_migrate_lock = threading.Lock()


def _integrity_errors() -> tuple[type[BaseException], ...]:
    errors: list[type[BaseException]] = [sqlite3.IntegrityError]
    try:
        import psycopg

        errors.append(psycopg.IntegrityError)
    except ImportError:  # pragma: no cover
        pass
    return tuple(errors)


IntegrityError = _integrity_errors()


def sqlalchemy_url(url: str) -> str:
    """Alembic/SQLAlchemy URL for a postgres://, postgresql:// or sqlite:/// URL."""
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    return url


def sqlite_url(path: Path | str) -> str:
    return f"sqlite:///{Path(path)}"


class DatabaseUnavailableError(RuntimeError):
    """Postgres is not reachable; say how to fix it instead of a bare driver error."""

    def __init__(self, url: str, exc: BaseException) -> None:
        safe = url.split("@", 1)[-1] if "@" in url else url
        super().__init__(
            f"Cannot connect to PostgreSQL at {safe}: {exc}. Start it with `docker compose up -d db`, "
            "set VETMIND_DATABASE_URL, or use VETMIND_STORAGE=sqlite for a single local file."
        )


class _Result:
    """The part of a DB-API cursor the stores use."""

    def __init__(self, rows: list[Any] | None, rowcount: int) -> None:
        self._rows = rows or []
        self.rowcount = rowcount

    def fetchone(self) -> Any:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[Any]:
        return list(self._rows)


class SqlConnection:
    """One connection, used under the store's own lock (like the old sqlite3 connections)."""

    def __init__(self, url: str) -> None:
        self.url = url
        self.dialect = "sqlite" if url.startswith("sqlite") else "postgres"
        self.IntegrityError = IntegrityError
        self._conn: Any = None
        self._open()

    def _open(self) -> None:
        if self.dialect == "sqlite":
            path = Path(self.url.split("sqlite:///", 1)[1])
            path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(path, check_same_thread=False, timeout=30)
            conn.row_factory = sqlite3.Row
            # DELETE is more portable than WAL (some sandboxed/tmp FS reject -wal/-shm sidecars).
            conn.execute("PRAGMA journal_mode=DELETE;")
            conn.execute("PRAGMA foreign_keys=ON;")
            self._conn = conn
            return
        import psycopg
        from psycopg.rows import dict_row
        from psycopg.types.string import TextLoader

        try:
            conn = psycopg.connect(self.url, row_factory=dict_row, autocommit=False, connect_timeout=10)
        except psycopg.OperationalError as exc:
            raise DatabaseUnavailableError(self.url, exc) from exc
        # Payload columns are JSONB; the stores parse JSON themselves.
        conn.adapters.register_loader("jsonb", TextLoader)
        conn.adapters.register_loader("json", TextLoader)
        self._conn = conn

    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if self.dialect == "postgres" else sql

    def _ensure_open(self) -> None:
        # A Postgres restart closes the connection; open a new one instead of failing forever.
        if self.dialect == "postgres" and (self._conn.closed or self._conn.broken):
            self._open()

    def execute(self, sql: str, params: Sequence[Any] = ()) -> _Result:
        self._ensure_open()
        if self.dialect == "sqlite":
            cur = self._conn.execute(sql, tuple(params))
            rows = cur.fetchall() if cur.description else None
            return _Result(rows, cur.rowcount)
        from psycopg.pq import TransactionStatus

        idle_before = self._conn.info.transaction_status == TransactionStatus.IDLE
        try:
            cur = self._conn.execute(self._sql(sql), tuple(params))
        except Exception:
            # Leave no aborted transaction behind; the caller sees the original error.
            self._conn.rollback()
            raise
        rows = cur.fetchall() if cur.description else None
        if idle_before and rows is not None and sql.lstrip()[:6].upper() == "SELECT":
            # A lone read must not leave the connection "idle in transaction" (holds locks).
            self._conn.commit()
        return _Result(rows, cur.rowcount)

    def executemany(self, sql: str, seq: Iterable[Sequence[Any]]) -> None:
        self._ensure_open()
        if self.dialect == "sqlite":
            self._conn.executemany(sql, [tuple(p) for p in seq])
            return
        with self._conn.cursor() as cur:
            try:
                cur.executemany(self._sql(sql), [tuple(p) for p in seq])
            except Exception:
                self._conn.rollback()
                raise

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()


class Database:
    """A database URL plus its migrations; hands out connections to the stores."""

    def __init__(self, url: str) -> None:
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        self.url = url
        self.dialect = "sqlite" if url.startswith("sqlite") else "postgres"

    @classmethod
    def sqlite(cls, path: Path | str) -> "Database":
        return cls(sqlite_url(path))

    def migrate(self) -> None:
        """``alembic upgrade head`` (once per URL per process)."""
        with _migrate_lock:
            if self.url in _migrated:
                return
            if self.dialect == "postgres":
                SqlConnection(self.url).close()  # clear error if the server is down
            run_migrations(self.url)
            _migrated.add(self.url)

    def connect(self) -> SqlConnection:
        self.migrate()
        return SqlConnection(self.url)


def run_migrations(url: str, revision: str = "head") -> None:
    from alembic import command
    from alembic.config import Config

    if url.startswith("sqlite:///"):
        Path(url.split("sqlite:///", 1)[1]).parent.mkdir(parents=True, exist_ok=True)
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    # ConfigParser interpolation: a literal % in a password must be doubled.
    cfg.set_main_option("sqlalchemy.url", sqlalchemy_url(url).replace("%", "%%"))
    command.upgrade(cfg, revision)


def database_from_settings(settings: Any) -> Database:
    """Postgres when ``storage_backend == "postgres"``, else the single SQLite file."""
    if settings.storage_backend == "postgres":
        if not settings.database_url:
            raise RuntimeError("VETMIND_STORAGE=postgres requires VETMIND_DATABASE_URL (or DATABASE_URL).")
        return Database(settings.database_url)
    return Database.sqlite(settings.sqlite_path)


def connect_from_settings(settings: Any) -> SqlConnection:
    return database_from_settings(settings).connect()
