"""Persist public contact inquiries (JSON document store)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional, Protocol

from app.schemas.contact import ContactInquiry


class ContactStore(Protocol):
    def save(self, inquiry: ContactInquiry) -> ContactInquiry: ...

    def get(self, inquiry_id: str) -> Optional[ContactInquiry]: ...

    def list(self) -> list[ContactInquiry]: ...


class InMemoryContactStore:
    def __init__(self) -> None:
        self._by_id: dict[str, ContactInquiry] = {}

    def save(self, inquiry: ContactInquiry) -> ContactInquiry:
        self._by_id[inquiry.inquiry_id] = inquiry
        return inquiry

    def get(self, inquiry_id: str) -> Optional[ContactInquiry]:
        return self._by_id.get(inquiry_id)

    def list(self) -> list[ContactInquiry]:
        return sorted(self._by_id.values(), key=lambda i: i.created_at, reverse=True)


class SqliteContactStore:
    def __init__(self, db_path: Path | str) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=DELETE;")
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS contact_inquiries (
                inquiry_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            """
        )
        self._conn.commit()

    def save(self, inquiry: ContactInquiry) -> ContactInquiry:
        self._conn.execute(
            """
            INSERT INTO contact_inquiries (inquiry_id, created_at, payload) VALUES (?, ?, ?)
            ON CONFLICT(inquiry_id) DO UPDATE SET
                created_at=excluded.created_at,
                payload=excluded.payload
            """,
            (inquiry.inquiry_id, inquiry.created_at.isoformat(), inquiry.model_dump_json()),
        )
        self._conn.commit()
        return inquiry

    def get(self, inquiry_id: str) -> Optional[ContactInquiry]:
        row = self._conn.execute(
            "SELECT payload FROM contact_inquiries WHERE inquiry_id=?",
            (inquiry_id,),
        ).fetchone()
        return ContactInquiry.model_validate_json(row["payload"]) if row else None

    def list(self) -> list[ContactInquiry]:
        rows = self._conn.execute(
            "SELECT payload FROM contact_inquiries ORDER BY created_at DESC"
        ).fetchall()
        return [ContactInquiry.model_validate_json(r["payload"]) for r in rows]


def build_contact_store(settings) -> ContactStore:
    if settings.storage_backend == "memory":
        return InMemoryContactStore()
    path = Path(settings.sqlite_path).with_name("vetmind_contact_inquiries.sqlite3")
    return SqliteContactStore(path)
