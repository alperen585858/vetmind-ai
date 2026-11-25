"""SQL CaseRepository (Postgres by default, SQLite for local dev) using versioned JSON
document payloads. Not a full relational clinical schema."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Optional

from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomIngestionRecord
from app.schemas.documents import DocumentIngestionRecord
from app.schemas.jobs import AnalysisJob
from app.storage.sql import Database, SqlConnection


class SqlCaseRepository:
    """Cases, jobs and ingestions in the shared VetMind database (Postgres, or SQLite for local
    dev). Versioned JSON documents (JSONB on Postgres); schema from Alembic migrations (#102)."""

    def __init__(self, conn: SqlConnection) -> None:
        self._conn = conn
        # One connection is shared by FastAPI's threadpool: serialize every use of it.
        # Without this, parallel requests (the workspace fires several at once) raised
        # sqlite3.InterfaceError or read back None for existing rows.
        self._lock = threading.RLock()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def save_case(self, case: CaseRecord) -> CaseRecord:
        with self._lock:
            payload = case.model_dump_json()
            created = case.created_at.isoformat()
            self._conn.execute(
                """
                INSERT INTO cases (case_id, created_at, payload)
                VALUES (?, ?, ?)
                ON CONFLICT(case_id) DO UPDATE SET
                    created_at = excluded.created_at,
                    payload = excluded.payload
                """,
                (case.case_id, created, payload),
            )
            self._conn.commit()
            return case

    def get_case(self, case_id: str) -> Optional[CaseRecord]:
        with self._lock:
            row = self._conn.execute(
                "SELECT payload FROM cases WHERE case_id = ?",
                (case_id,),
            ).fetchone()
            if row is None:
                return None
            return CaseRecord.model_validate_json(row["payload"])

    def list_cases(self) -> list[CaseRecord]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT payload FROM cases ORDER BY created_at DESC"
            ).fetchall()
            return [CaseRecord.model_validate_json(r["payload"]) for r in rows]

    def save_job(self, job: AnalysisJob) -> AnalysisJob:
        with self._lock:
            payload = job.model_dump_json()
            self._conn.execute(
                """
                INSERT INTO jobs (job_id, case_id, payload)
                VALUES (?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET
                    case_id = excluded.case_id,
                    payload = excluded.payload
                """,
                (job.job_id, job.case_id, payload),
            )
            self._conn.commit()
            return job

    def get_job(self, job_id: str) -> Optional[AnalysisJob]:
        with self._lock:
            row = self._conn.execute(
                "SELECT payload FROM jobs WHERE job_id = ?",
                (job_id,),
            ).fetchone()
            if row is None:
                return None
            return AnalysisJob.model_validate_json(row["payload"])

    def save_ingestion(self, record: DicomIngestionRecord) -> DicomIngestionRecord:
        with self._lock:
            payload = record.model_dump_json()
            created = record.created_at.isoformat()
            self._conn.execute(
                """
                INSERT INTO ingestions (ingest_id, created_at, payload)
                VALUES (?, ?, ?)
                ON CONFLICT(ingest_id) DO UPDATE SET
                    created_at = excluded.created_at,
                    payload = excluded.payload
                """,
                (record.ingest_id, created, payload),
            )
            self._conn.commit()
            return record

    def get_ingestion(self, ingest_id: str) -> Optional[DicomIngestionRecord]:
        with self._lock:
            row = self._conn.execute(
                "SELECT payload FROM ingestions WHERE ingest_id = ?",
                (ingest_id,),
            ).fetchone()
            if row is None:
                return None
            return DicomIngestionRecord.model_validate_json(row["payload"])

    def save_document_ingestion(self, record: DocumentIngestionRecord) -> DocumentIngestionRecord:
        with self._lock:
            payload = record.model_dump_json()
            created = record.created_at.isoformat()
            self._conn.execute(
                """
                INSERT INTO document_ingestions (ingest_id, created_at, payload)
                VALUES (?, ?, ?)
                ON CONFLICT(ingest_id) DO UPDATE SET
                    created_at = excluded.created_at,
                    payload = excluded.payload
                """,
                (record.ingest_id, created, payload),
            )
            self._conn.commit()
            return record

    def get_document_ingestion(self, ingest_id: str) -> Optional[DocumentIngestionRecord]:
        with self._lock:
            row = self._conn.execute(
                "SELECT payload FROM document_ingestions WHERE ingest_id = ?",
                (ingest_id,),
            ).fetchone()
            if row is None:
                return None
            return DocumentIngestionRecord.model_validate_json(row["payload"])

    def delete_case(self, case_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM cases WHERE case_id = ?", (case_id,))
            self._conn.execute("DELETE FROM jobs WHERE case_id = ?", (case_id,))
            self._conn.commit()
            return cur.rowcount > 0

    def delete_ingestion(self, ingest_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM ingestions WHERE ingest_id = ?", (ingest_id,))
            self._conn.execute("DELETE FROM document_ingestions WHERE ingest_id = ?", (ingest_id,))
            self._conn.commit()


class SqliteCaseRepository(SqlCaseRepository):
    """Same repository on one SQLite file (tests, local dev, old-data migration)."""

    def __init__(self, db_path: Path | str) -> None:
        super().__init__(Database.sqlite(db_path).connect())
