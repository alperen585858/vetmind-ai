"""PostgreSQL CaseRepository — same Protocol as SQLite/memory (JSONB document store).

Requires ``psycopg`` and ``VETMIND_DATABASE_URL`` (or ``DATABASE_URL``).
Not a full clinical relational schema; payloads remain versioned JSON documents.
"""

from __future__ import annotations

from typing import Optional

from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomIngestionRecord
from app.schemas.documents import DocumentIngestionRecord
from app.schemas.jobs import AnalysisJob


class PostgresCaseRepository:
    def __init__(self, database_url: str) -> None:
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "PostgreSQL backend requires psycopg. Install with: pip install 'psycopg[binary]'"
            ) from exc

        from psycopg.types.json import Jsonb

        self._Jsonb = Jsonb
        self._conn = psycopg.connect(database_url, row_factory=dict_row, autocommit=False)
        self._init_schema()

    def _init_schema(self) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS cases (
                    case_id TEXT PRIMARY KEY,
                    created_at TIMESTAMPTZ NOT NULL,
                    payload JSONB NOT NULL
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL,
                    payload JSONB NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ingestions (
                    ingest_id TEXT PRIMARY KEY,
                    created_at TIMESTAMPTZ NOT NULL,
                    payload JSONB NOT NULL
                );
                CREATE TABLE IF NOT EXISTS document_ingestions (
                    ingest_id TEXT PRIMARY KEY,
                    created_at TIMESTAMPTZ NOT NULL,
                    payload JSONB NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_jobs_case_id ON jobs(case_id);
                """
            )
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def save_case(self, case: CaseRecord) -> CaseRecord:
        payload = case.model_dump(mode="json")
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO cases (case_id, created_at, payload)
                VALUES (%s, %s, %s::jsonb)
                ON CONFLICT (case_id) DO UPDATE SET
                    created_at = EXCLUDED.created_at,
                    payload = EXCLUDED.payload
                """,
                (case.case_id, case.created_at, self._Jsonb(payload)),
            )
        self._conn.commit()
        return case

    def get_case(self, case_id: str) -> Optional[CaseRecord]:
        with self._conn.cursor() as cur:
            cur.execute("SELECT payload FROM cases WHERE case_id = %s", (case_id,))
            row = cur.fetchone()
        if row is None:
            return None
        return CaseRecord.model_validate(row["payload"])

    def list_cases(self) -> list[CaseRecord]:
        with self._conn.cursor() as cur:
            cur.execute("SELECT payload FROM cases ORDER BY created_at DESC")
            rows = cur.fetchall()
        return [CaseRecord.model_validate(r["payload"]) for r in rows]

    def save_job(self, job: AnalysisJob) -> AnalysisJob:
        payload = job.model_dump(mode="json")
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO jobs (job_id, case_id, payload)
                VALUES (%s, %s, %s::jsonb)
                ON CONFLICT (job_id) DO UPDATE SET
                    case_id = EXCLUDED.case_id,
                    payload = EXCLUDED.payload
                """,
                (job.job_id, job.case_id, self._Jsonb(payload)),
            )
        self._conn.commit()
        return job

    def get_job(self, job_id: str) -> Optional[AnalysisJob]:
        with self._conn.cursor() as cur:
            cur.execute("SELECT payload FROM jobs WHERE job_id = %s", (job_id,))
            row = cur.fetchone()
        if row is None:
            return None
        return AnalysisJob.model_validate(row["payload"])

    def save_ingestion(self, record: DicomIngestionRecord) -> DicomIngestionRecord:
        payload = record.model_dump(mode="json")
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ingestions (ingest_id, created_at, payload)
                VALUES (%s, %s, %s::jsonb)
                ON CONFLICT (ingest_id) DO UPDATE SET
                    created_at = EXCLUDED.created_at,
                    payload = EXCLUDED.payload
                """,
                (record.ingest_id, record.created_at, self._Jsonb(payload)),
            )
        self._conn.commit()
        return record

    def get_ingestion(self, ingest_id: str) -> Optional[DicomIngestionRecord]:
        with self._conn.cursor() as cur:
            cur.execute("SELECT payload FROM ingestions WHERE ingest_id = %s", (ingest_id,))
            row = cur.fetchone()
        if row is None:
            return None
        return DicomIngestionRecord.model_validate(row["payload"])

    def save_document_ingestion(self, record: DocumentIngestionRecord) -> DocumentIngestionRecord:
        payload = record.model_dump(mode="json")
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO document_ingestions (ingest_id, created_at, payload)
                VALUES (%s, %s, %s::jsonb)
                ON CONFLICT (ingest_id) DO UPDATE SET
                    created_at = EXCLUDED.created_at,
                    payload = EXCLUDED.payload
                """,
                (record.ingest_id, record.created_at, self._Jsonb(payload)),
            )
        self._conn.commit()
        return record

    def get_document_ingestion(self, ingest_id: str) -> Optional[DocumentIngestionRecord]:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT payload FROM document_ingestions WHERE ingest_id = %s",
                (ingest_id,),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return DocumentIngestionRecord.model_validate(row["payload"])

    def delete_case(self, case_id: str) -> bool:
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM cases WHERE case_id = %s", (case_id,))
            existed = cur.rowcount > 0
            cur.execute("DELETE FROM jobs WHERE case_id = %s", (case_id,))
        self._conn.commit()
        return existed

    def delete_ingestion(self, ingest_id: str) -> None:
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM ingestions WHERE ingest_id = %s", (ingest_id,))
            cur.execute("DELETE FROM document_ingestions WHERE ingest_id = %s", (ingest_id,))
        self._conn.commit()
