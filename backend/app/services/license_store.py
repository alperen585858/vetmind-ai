"""Persist licensed clinics (JSON document store)."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Protocol

from app.schemas.license import LicensedClinic


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


SEED_CLINICS: tuple[LicensedClinic, ...] = (
    LicensedClinic(
        clinic_id="clinic-demo-a",
        name="Demo Klinik A",
        status="active",
        created_by="seed",
    ),
    LicensedClinic(
        clinic_id="clinic-demo-b",
        name="Demo Klinik B",
        status="active",
        created_by="seed",
    ),
)


class LicenseStore(Protocol):
    def save_clinic(self, clinic: LicensedClinic) -> LicensedClinic: ...

    def get_clinic(self, clinic_id: str) -> Optional[LicensedClinic]: ...

    def list_clinics(self) -> list[LicensedClinic]: ...


class InMemoryLicenseStore:
    def __init__(self, *, seed: bool = True) -> None:
        self._by_id: dict[str, LicensedClinic] = {}
        if seed:
            for c in SEED_CLINICS:
                self._by_id[c.clinic_id] = c

    def save_clinic(self, clinic: LicensedClinic) -> LicensedClinic:
        self._by_id[clinic.clinic_id] = clinic
        return clinic

    def get_clinic(self, clinic_id: str) -> Optional[LicensedClinic]:
        return self._by_id.get(clinic_id)

    def list_clinics(self) -> list[LicensedClinic]:
        return sorted(self._by_id.values(), key=lambda c: c.name.lower())


class SqliteLicenseStore:
    def __init__(self, db_path: Path | str, *, seed: bool = True) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=DELETE;")
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS licensed_clinics (
                clinic_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
            """
        )
        self._conn.commit()
        if seed and self._conn.execute("SELECT 1 FROM licensed_clinics LIMIT 1").fetchone() is None:
            for c in SEED_CLINICS:
                self.save_clinic(c)

    def save_clinic(self, clinic: LicensedClinic) -> LicensedClinic:
        self._conn.execute(
            """
            INSERT INTO licensed_clinics (clinic_id, payload) VALUES (?, ?)
            ON CONFLICT(clinic_id) DO UPDATE SET payload=excluded.payload
            """,
            (clinic.clinic_id, clinic.model_dump_json()),
        )
        self._conn.commit()
        return clinic

    def get_clinic(self, clinic_id: str) -> Optional[LicensedClinic]:
        row = self._conn.execute(
            "SELECT payload FROM licensed_clinics WHERE clinic_id=?",
            (clinic_id,),
        ).fetchone()
        return LicensedClinic.model_validate_json(row["payload"]) if row else None

    def list_clinics(self) -> list[LicensedClinic]:
        rows = self._conn.execute("SELECT payload FROM licensed_clinics").fetchall()
        clinics = [LicensedClinic.model_validate_json(r["payload"]) for r in rows]
        return sorted(clinics, key=lambda c: c.name.lower())


def build_license_store(settings) -> LicenseStore:
    if settings.storage_backend == "memory":
        return InMemoryLicenseStore()
    path = Path(settings.sqlite_path).with_name("vetmind_licenses.sqlite3")
    return SqliteLicenseStore(path)
