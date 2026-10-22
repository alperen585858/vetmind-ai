from typing import Optional, Protocol

from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomIngestionRecord
from app.schemas.jobs import AnalysisJob
from app.settings import Settings, load_settings


class CaseRepository(Protocol):
    """Storage interface. In-memory, SQLite, or future PostgreSQL implement the same contract."""

    def save_case(self, case: CaseRecord) -> CaseRecord: ...

    def get_case(self, case_id: str) -> Optional[CaseRecord]: ...

    def list_cases(self) -> list[CaseRecord]: ...

    def save_job(self, job: AnalysisJob) -> AnalysisJob: ...

    def get_job(self, job_id: str) -> Optional[AnalysisJob]: ...

    def save_ingestion(self, record: DicomIngestionRecord) -> DicomIngestionRecord: ...

    def get_ingestion(self, ingest_id: str) -> Optional[DicomIngestionRecord]: ...


class InMemoryCaseRepository:
    def __init__(self) -> None:
        self._cases: dict[str, CaseRecord] = {}
        self._jobs: dict[str, AnalysisJob] = {}
        self._ingestions: dict[str, DicomIngestionRecord] = {}

    def save_case(self, case: CaseRecord) -> CaseRecord:
        self._cases[case.case_id] = case
        return case

    def get_case(self, case_id: str) -> Optional[CaseRecord]:
        return self._cases.get(case_id)

    def list_cases(self) -> list[CaseRecord]:
        return sorted(self._cases.values(), key=lambda c: c.created_at, reverse=True)

    def save_job(self, job: AnalysisJob) -> AnalysisJob:
        self._jobs[job.job_id] = job
        return job

    def get_job(self, job_id: str) -> Optional[AnalysisJob]:
        return self._jobs.get(job_id)

    def save_ingestion(self, record: DicomIngestionRecord) -> DicomIngestionRecord:
        self._ingestions[record.ingest_id] = record
        return record

    def get_ingestion(self, ingest_id: str) -> Optional[DicomIngestionRecord]:
        return self._ingestions.get(ingest_id)


def build_repository(settings: Settings | None = None) -> CaseRepository:
    """Factory: memory for tests / CI; sqlite for local demo durability."""
    cfg = settings or load_settings()
    if cfg.storage_backend == "memory":
        return InMemoryCaseRepository()
    from app.services.sqlite_repository import SqliteCaseRepository

    return SqliteCaseRepository(cfg.sqlite_path)
