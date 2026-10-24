"""Persist demo payment intents (JSON document store, mirrors WorkflowStore)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional, Protocol

from app.schemas.payment import DemoPayment


class PaymentStore(Protocol):
    def save_payment(self, payment: DemoPayment) -> DemoPayment: ...

    def get_payment(self, payment_id: str) -> Optional[DemoPayment]: ...

    def get_by_submission(self, submission_id: str) -> Optional[DemoPayment]: ...

    def list_payments(self) -> list[DemoPayment]: ...


class InMemoryPaymentStore:
    def __init__(self) -> None:
        self._by_id: dict[str, DemoPayment] = {}
        self._by_sub: dict[str, str] = {}

    def save_payment(self, payment: DemoPayment) -> DemoPayment:
        self._by_id[payment.payment_id] = payment
        self._by_sub[payment.submission_id] = payment.payment_id
        return payment

    def get_payment(self, payment_id: str) -> Optional[DemoPayment]:
        return self._by_id.get(payment_id)

    def get_by_submission(self, submission_id: str) -> Optional[DemoPayment]:
        pid = self._by_sub.get(submission_id)
        return self._by_id.get(pid) if pid else None

    def list_payments(self) -> list[DemoPayment]:
        return sorted(self._by_id.values(), key=lambda p: p.created_at, reverse=True)


class SqlitePaymentStore:
    def __init__(self, db_path: Path | str) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=DELETE;")
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS demo_payments (
                payment_id TEXT PRIMARY KEY,
                submission_id TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_demo_payments_submission
                ON demo_payments(submission_id);
            """
        )
        self._conn.commit()

    def save_payment(self, payment: DemoPayment) -> DemoPayment:
        self._conn.execute(
            """
            INSERT INTO demo_payments (payment_id, submission_id, created_at, payload)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(payment_id) DO UPDATE SET
                submission_id=excluded.submission_id,
                created_at=excluded.created_at,
                payload=excluded.payload
            """,
            (
                payment.payment_id,
                payment.submission_id,
                payment.created_at.isoformat(),
                payment.model_dump_json(),
            ),
        )
        self._conn.commit()
        return payment

    def get_payment(self, payment_id: str) -> Optional[DemoPayment]:
        row = self._conn.execute(
            "SELECT payload FROM demo_payments WHERE payment_id=?", (payment_id,)
        ).fetchone()
        return DemoPayment.model_validate_json(row["payload"]) if row else None

    def get_by_submission(self, submission_id: str) -> Optional[DemoPayment]:
        row = self._conn.execute(
            "SELECT payload FROM demo_payments WHERE submission_id=?", (submission_id,)
        ).fetchone()
        return DemoPayment.model_validate_json(row["payload"]) if row else None

    def list_payments(self) -> list[DemoPayment]:
        rows = self._conn.execute(
            "SELECT payload FROM demo_payments ORDER BY created_at DESC"
        ).fetchall()
        return [DemoPayment.model_validate_json(r["payload"]) for r in rows]


def build_payment_store(settings) -> PaymentStore:
    if settings.storage_backend == "memory":
        return InMemoryPaymentStore()
    path = Path(settings.sqlite_path).with_name("vetmind_payments.sqlite3")
    return SqlitePaymentStore(path)
