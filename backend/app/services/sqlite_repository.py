"""SQLite-backed CaseRepository using versioned JSON document payloads.

This is a persistence foundation for demos (survives process restart).
It is not a full relational clinical schema and not PostgreSQL — that can
implement the same CaseRepository Protocol later (e.g. JSONB columns).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional

from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomIngestionRecord
from app.schemas.jobs import AnalysisJob


class SqliteCaseRepository:
    def __init__(self, db_path: Path | str) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA foreign_keys=ON;")
        self._init_schema()

    def _init_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS cases (
                case_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                case_id TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ingestions (
                ingest_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at);
            CREATE INDEX IF NOT EXISTS idx_jobs_case_id ON jobs(case_id);
            """
        )
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def save_case(self, case: CaseRecord) -> CaseRecord:
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
        row = self._conn.execute(
            "SELECT payload FROM cases WHERE case_id = ?",
            (case_id,),
        ).fetchone()
        if row is None:
            return None
        return CaseRecord.model_validate_json(row["payload"])

    def list_cases(self) -> list[CaseRecord]:
        rows = self._conn.execute(
            "SELECT payload FROM cases ORDER BY created_at DESC"
        ).fetchall()
        return [CaseRecord.model_validate_json(r["payload"]) for r in rows]

    def save_job(self, job: AnalysisJob) -> AnalysisJob:
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
        row = self._conn.execute(
            "SELECT payload FROM jobs WHERE job_id = ?",
            (job_id,),
        ).fetchone()
        if row is None:
            return None
        return AnalysisJob.model_validate_json(row["payload"])

    def save_ingestion(self, record: DicomIngestionRecord) -> DicomIngestionRecord:
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
        row = self._conn.execute(
            "SELECT payload FROM ingestions WHERE ingest_id = ?",
            (ingest_id,),
        ).fetchone()
        if row is None:
            return None
        return DicomIngestionRecord.model_validate_json(row["payload"])
