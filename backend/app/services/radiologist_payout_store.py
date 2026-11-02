"""Persist radiologist case payouts + fee settings (JSON document store)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional, Protocol

from app.schemas.radiologist_payout import (
    RADIOLOGIST_CASE_FEE,
    RadiologistCasePayout,
    RadiologistPayoutSettings,
)


class RadiologistPayoutStore(Protocol):
    def save_payout(self, payout: RadiologistCasePayout) -> RadiologistCasePayout: ...

    def get_payout(self, payout_id: str) -> Optional[RadiologistCasePayout]: ...

    def get_by_case(self, case_id: str) -> Optional[RadiologistCasePayout]: ...

    def list_payouts(self) -> list[RadiologistCasePayout]: ...

    def list_by_radiologist(self, radiologist_subject: str) -> list[RadiologistCasePayout]: ...

    def get_settings(self) -> RadiologistPayoutSettings: ...

    def save_settings(self, settings: RadiologistPayoutSettings) -> RadiologistPayoutSettings: ...


class InMemoryRadiologistPayoutStore:
    def __init__(self) -> None:
        self._by_id: dict[str, RadiologistCasePayout] = {}
        self._by_case: dict[str, str] = {}
        self._settings = RadiologistPayoutSettings(fee_per_case=RADIOLOGIST_CASE_FEE)

    def save_payout(self, payout: RadiologistCasePayout) -> RadiologistCasePayout:
        self._by_id[payout.payout_id] = payout
        self._by_case[payout.case_id] = payout.payout_id
        return payout

    def get_payout(self, payout_id: str) -> Optional[RadiologistCasePayout]:
        return self._by_id.get(payout_id)

    def get_by_case(self, case_id: str) -> Optional[RadiologistCasePayout]:
        pid = self._by_case.get(case_id)
        return self._by_id.get(pid) if pid else None

    def list_payouts(self) -> list[RadiologistCasePayout]:
        return sorted(self._by_id.values(), key=lambda p: p.approved_at, reverse=True)

    def list_by_radiologist(self, radiologist_subject: str) -> list[RadiologistCasePayout]:
        key = radiologist_subject.lower()
        return sorted(
            [p for p in self._by_id.values() if p.radiologist_subject.lower() == key],
            key=lambda p: p.approved_at,
            reverse=True,
        )

    def get_settings(self) -> RadiologistPayoutSettings:
        return self._settings

    def save_settings(self, settings: RadiologistPayoutSettings) -> RadiologistPayoutSettings:
        self._settings = settings
        return settings


class SqliteRadiologistPayoutStore:
    def __init__(self, db_path: Path | str) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=DELETE;")
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS radiologist_payouts (
                payout_id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL UNIQUE,
                radiologist_subject TEXT NOT NULL,
                approved_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_rpay_radiologist
                ON radiologist_payouts(radiologist_subject);
            CREATE INDEX IF NOT EXISTS idx_rpay_case
                ON radiologist_payouts(case_id);
            CREATE TABLE IF NOT EXISTS radiologist_payout_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload TEXT NOT NULL
            );
            """
        )
        self._conn.commit()
        if self._conn.execute("SELECT 1 FROM radiologist_payout_settings WHERE id=1").fetchone() is None:
            default = RadiologistPayoutSettings(fee_per_case=RADIOLOGIST_CASE_FEE)
            self._conn.execute(
                "INSERT INTO radiologist_payout_settings (id, payload) VALUES (1, ?)",
                (default.model_dump_json(),),
            )
            self._conn.commit()

    def save_payout(self, payout: RadiologistCasePayout) -> RadiologistCasePayout:
        self._conn.execute(
            """
            INSERT INTO radiologist_payouts
                (payout_id, case_id, radiologist_subject, approved_at, payload)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(payout_id) DO UPDATE SET
                case_id=excluded.case_id,
                radiologist_subject=excluded.radiologist_subject,
                approved_at=excluded.approved_at,
                payload=excluded.payload
            """,
            (
                payout.payout_id,
                payout.case_id,
                payout.radiologist_subject,
                payout.approved_at.isoformat(),
                payout.model_dump_json(),
            ),
        )
        self._conn.commit()
        return payout

    def get_payout(self, payout_id: str) -> Optional[RadiologistCasePayout]:
        row = self._conn.execute(
            "SELECT payload FROM radiologist_payouts WHERE payout_id=?", (payout_id,)
        ).fetchone()
        return RadiologistCasePayout.model_validate_json(row["payload"]) if row else None

    def get_by_case(self, case_id: str) -> Optional[RadiologistCasePayout]:
        row = self._conn.execute(
            "SELECT payload FROM radiologist_payouts WHERE case_id=?", (case_id,)
        ).fetchone()
        return RadiologistCasePayout.model_validate_json(row["payload"]) if row else None

    def list_payouts(self) -> list[RadiologistCasePayout]:
        rows = self._conn.execute(
            "SELECT payload FROM radiologist_payouts ORDER BY approved_at DESC"
        ).fetchall()
        return [RadiologistCasePayout.model_validate_json(r["payload"]) for r in rows]

    def list_by_radiologist(self, radiologist_subject: str) -> list[RadiologistCasePayout]:
        rows = self._conn.execute(
            """
            SELECT payload FROM radiologist_payouts
            WHERE lower(radiologist_subject)=lower(?)
            ORDER BY approved_at DESC
            """,
            (radiologist_subject,),
        ).fetchall()
        return [RadiologistCasePayout.model_validate_json(r["payload"]) for r in rows]

    def get_settings(self) -> RadiologistPayoutSettings:
        row = self._conn.execute(
            "SELECT payload FROM radiologist_payout_settings WHERE id=1"
        ).fetchone()
        if row is None:
            return RadiologistPayoutSettings(fee_per_case=RADIOLOGIST_CASE_FEE)
        return RadiologistPayoutSettings.model_validate_json(row["payload"])

    def save_settings(self, settings: RadiologistPayoutSettings) -> RadiologistPayoutSettings:
        self._conn.execute(
            """
            INSERT INTO radiologist_payout_settings (id, payload)
            VALUES (1, ?)
            ON CONFLICT(id) DO UPDATE SET payload=excluded.payload
            """,
            (settings.model_dump_json(),),
        )
        self._conn.commit()
        return settings


def build_radiologist_payout_store(settings) -> RadiologistPayoutStore:
    if settings.storage_backend == "memory":
        return InMemoryRadiologistPayoutStore()
    path = Path(settings.sqlite_path).with_name("vetmind_radiologist_payouts.sqlite3")
    return SqliteRadiologistPayoutStore(path)
