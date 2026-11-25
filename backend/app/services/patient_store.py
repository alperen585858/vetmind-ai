"""Patient records (issue #108): memory for tests, the shared SQL database otherwise."""

from __future__ import annotations

import threading
from typing import Protocol

from app.schemas.patient import PatientRecord
from app.storage.sql import SqlConnection, connect_from_settings


class PatientStore(Protocol):
    def save(self, patient: PatientRecord) -> PatientRecord: ...

    def get(self, patient_id: str) -> PatientRecord | None: ...

    def list(self) -> list[PatientRecord]: ...


class InMemoryPatientStore:
    def __init__(self) -> None:
        self._rows: dict[str, PatientRecord] = {}
        self._lock = threading.RLock()

    def save(self, patient: PatientRecord) -> PatientRecord:
        with self._lock:
            self._rows[patient.patient_id] = patient
        return patient

    def get(self, patient_id: str) -> PatientRecord | None:
        with self._lock:
            return self._rows.get(patient_id)

    def list(self) -> list[PatientRecord]:
        with self._lock:
            return sorted(self._rows.values(), key=lambda p: p.created_at)


class SqlPatientStore:
    """Rows in the shared VetMind database (Postgres, or SQLite for local dev); schema from
    Alembic migration 0003."""

    def __init__(self, conn: SqlConnection) -> None:
        self._conn = conn
        # One connection shared by FastAPI's threadpool: serialize every use of it (#36).
        self._lock = threading.RLock()

    def save(self, patient: PatientRecord) -> PatientRecord:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO patients (patient_id, clinic_id, created_at, payload)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(patient_id) DO UPDATE SET
                    clinic_id=excluded.clinic_id, payload=excluded.payload
                """,
                (patient.patient_id, patient.clinic_id, patient.created_at.isoformat(), patient.model_dump_json()),
            )
            self._conn.commit()
        return patient

    def get(self, patient_id: str) -> PatientRecord | None:
        with self._lock:
            row = self._conn.execute("SELECT payload FROM patients WHERE patient_id=?", (patient_id,)).fetchone()
        return PatientRecord.model_validate_json(row["payload"]) if row else None

    def list(self) -> list[PatientRecord]:
        with self._lock:
            rows = self._conn.execute("SELECT payload FROM patients ORDER BY created_at").fetchall()
        return [PatientRecord.model_validate_json(r["payload"]) for r in rows]


def build_patient_store(settings) -> PatientStore:
    if settings.storage_backend == "memory":
        return InMemoryPatientStore()
    return SqlPatientStore(connect_from_settings(settings))
