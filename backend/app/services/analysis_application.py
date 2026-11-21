from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.auth.rbac import CAP_ADMIN, CAP_CASE_WRITE
from app.auth.tenancy import assert_case_access, bind_reviewer_id, can_access_owned
from app.models.model_input_builder import build_imaging_model_input
from app.orchestration.orchestrator import AIOrchestrator
from app.orchestration.progress import apply_pipeline_progress
from app.schemas.case import (
    AiChatAsk,
    AiChatResponse,
    AiChatTurn,
    CaseActivityEvent,
    CaseAssignmentUpdate,
    CaseCreate,
    CaseMessage,
    CaseMessageCreate,
    CaseMessageView,
    CaseOwnerUpdate,
    CaseRecord,
    CaseSummary,
    ClinicDashboardStats,
    ReportDraftUpdate,
    ReviewFeedback,
)
from app.settings import Settings
from app.schemas.documents import CaseDocumentContext
from app.schemas.workflow import (
    AttachmentRef,
    CaseDocumentAttach,
    CaseNoteCreate,
    ClinicalNoteEntry,
    InfoRequest,
    InfoRequestCreate,
    InfoRequestReply,
)
from app.llm.interfaces import LLMProviderError
from app.services.activity import append_activity
from app.review_sla import (
    OPEN_REVIEW_STATUSES,
    WARN_WITHIN_HOURS,
    apply_review_sla,
    clear_review_sla,
    remaining_seconds,
    sla_hours_for,
)
from app.schemas.enums import (
    CaseLifecycleStatus,
    ExpertReviewStatus,
    JobStatus,
    PipelineOutcome,
    ReportStatus,
    ReviewAction,
    SourceKind,
)
from app.schemas.findings import StructuredFindings
from app.schemas.jobs import AnalysisJob, PipelineResult
from app.schemas.model_input import ImagingModelInput
from app.schemas.report import (
    DraftReport,
    GenerationMetadata,
    ReportSection,
    ReportVersionSnapshot,
    ReportVersionSummary,
)
from app.auth.mailer import OutgoingMail
from app.feedback.store import FeedbackStore
from app.http_errors import api_error
from app.security.audit import AuditLogger, AuditOutcome
from app.services.owner_contact import resolve_owner_account, validate_owner_contact
from app.services.report_versioning import (
    apply_reject_or_revision,
    assert_mutable_for_edit,
    attach_pipeline_draft,
    freeze_approved,
    get_version,
    list_version_summaries,
    snapshot_from_draft,
    upsert_version_snapshot,
)
from app.services.case_ids import canonicalize_case_id
from app.services.repository import CaseRepository
from app.validation.report_validator import ReportValidator
from app.workers.analyze_gate import AnalyzeGate, build_analyze_gate
from app.workers.job_backend import JobBackend, ThreadJobBackend

from app.services.host_bound import HostBound


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AnalysisApplication(HostBound):
    """Synchronous and queued analysis, job control, and findings reads."""

    def _acquire_analyze_slot(self) -> None:
        if not self._analyze_gate.try_acquire():
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=api_error(
                    "concurrent_analyze_limit",
                    f"Too many concurrent analyses (max {self._max_concurrent_analyze}).",
                    max=self._max_concurrent_analyze,
                ),
            )

    def _release_analyze_slot(self) -> None:
        self._analyze_gate.release()

    def _assert_analyzable(self, case: CaseRecord) -> None:
        if getattr(case, "vet_verified", True) is False:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=api_error(
                    "needs_vet_verification",
                    "Owner submissions require veterinary verification before analysis.",
                ),
            )
        if case.status == CaseLifecycleStatus.AWAITING_CLASSIFICATION_CONFIRMATION:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=api_error(
                    "classification_unconfirmed",
                    "Cannot analyze until DICOM metadata classification is confirmed.",
                ),
            )
        if not case.classification_confirmed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=api_error(
                    "classification_unconfirmed",
                    "Cannot analyze: classification_confirmed is false.",
                ),
            )
        if case.status == CaseLifecycleStatus.APPROVED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=api_error(
                    "approved_needs_revision",
                    "Cannot re-analyze an approved case. "
                    "Request revision first so a new mutable report version can be created.",
                ),
            )
        if case.status == CaseLifecycleStatus.ANALYZING and case.latest_job_id:
            active = self._repo.get_job(case.latest_job_id)
            if active is not None and active.status in {
                JobStatus.QUEUED,
                JobStatus.RUNNING,
                JobStatus.CANCEL_REQUESTED,
            }:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=api_error(
                        "analysis_in_progress",
                        "Analysis already in progress for this case.",
                    ),
                )

    def analyze(self, case_id: str, *, principal: AuthPrincipal | None = None) -> PipelineResult:
        """Run the pipeline synchronously and return the completed job result."""
        with self._lock:
            case = self.get_case(case_id, principal=principal)
            self._assert_analyzable(case)
            job = AIOrchestrator.new_job(case.case_id)
            case.latest_job_id = job.job_id
            case.status = CaseLifecycleStatus.ANALYZING
            case.updated_at = _now()
            self._repo.save_case(case)
            self._repo.save_job(job)
        self._acquire_analyze_slot()
        try:
            # Deep copy so orchestrator cannot mutate the repository's live case object
            # (InMemoryCaseRepository returns the same reference — approve-race safety).
            working = case.model_copy(deep=True)
            report_language = self._resolve_report_language(working, principal=principal)
            result = self._orchestrator.run(
                working,
                job,
                cancel_probe=lambda: self._job_cancel_requested(job.job_id),
                on_progress=self._persist_job_progress,
                report_language=report_language,
            )
        finally:
            self._release_analyze_slot()
        result = self._persist_pipeline_result(case_id, working, result)
        self._emit_audit("analysis.run", principal=principal, resource=case_id)
        return result

    def _persist_job_progress(self, job: AnalysisJob) -> None:
        """Persist checkpoint progress without clobbering cooperative cancel flags."""
        with self._lock:
            stored = self._repo.get_job(job.job_id)
            if stored is None:
                return
            if stored.status in {
                JobStatus.COMPLETED,
                JobStatus.FAILED,
                JobStatus.CANCELLED,
                JobStatus.TIMED_OUT,
            }:
                return
            if stored.cancel_requested or stored.status == JobStatus.CANCEL_REQUESTED:
                job.cancel_requested = True
                if job.status == JobStatus.RUNNING:
                    job.status = JobStatus.CANCEL_REQUESTED
            self._repo.save_job(job)

    def _job_cancel_requested(self, job_id: str) -> bool:
        """Reload cancel flag from durable storage (SQLite/Postgres workers hold copies)."""
        stored = self._repo.get_job(job_id)
        return bool(
            stored is not None
            and (
                stored.cancel_requested
                or stored.status
                in {JobStatus.CANCEL_REQUESTED, JobStatus.CANCELLED}
            )
        )

    def _persist_pipeline_result(
        self, case_id: str, working: CaseRecord, result: PipelineResult
    ) -> PipelineResult:
        """Merge pipeline outputs under lock; never clobber an approved immutable report."""
        with self._lock:
            latest = self._repo.get_case(case_id)
            if latest is None:
                self._repo.save_job(result.job)
                return result
            approved = latest.status == CaseLifecycleStatus.APPROVED or (
                latest.draft_report is not None and latest.draft_report.immutable
            )
            has_immutable_history = any(v.immutable for v in (latest.report_versions or []))
            if (approved or has_immutable_history) and latest.status == CaseLifecycleStatus.APPROVED:
                # Never mutate an approved case / immutable snapshots from any analyze path.
                if result.job.status not in {
                    JobStatus.CANCELLED,
                    JobStatus.FAILED,
                    JobStatus.TIMED_OUT,
                }:
                    result.job.status = JobStatus.FAILED
                    result.job.outcome = PipelineOutcome.FAILED
                    result.job.error_message = (
                        "Analysis discarded: case was approved while analysis was in flight. "
                        "Approved immutable report was preserved."
                    )
                    result.job.completed_at = _now()
                self._repo.save_job(result.job)
                return result

            # Failed/cancelled re-analyze must not wipe a prior approvable draft.
            terminal_fail = result.job.status in {
                JobStatus.CANCELLED,
                JobStatus.FAILED,
                JobStatus.TIMED_OUT,
            }
            prior_draft = latest.draft_report
            latest.structured_findings = working.structured_findings or latest.structured_findings
            latest.latest_job_id = working.latest_job_id
            latest.updated_at = working.updated_at
            latest.model_input = working.model_input or latest.model_input
            if result.report is not None:
                attach_pipeline_draft(latest, result.report)
                result.report = latest.draft_report
                latest.status = working.status
            elif terminal_fail:
                # Preserve previous draft when pipeline produced no new report.
                latest.draft_report = prior_draft
                if prior_draft is not None and prior_draft.status in {
                    ReportStatus.AWAITING_REVIEW,
                    ReportStatus.DRAFT,
                }:
                    latest.status = CaseLifecycleStatus.AWAITING_REVIEW
                    apply_review_sla(latest)
                else:
                    latest.status = working.status
            else:
                latest.draft_report = working.draft_report
                latest.status = working.status
                if latest.status in OPEN_REVIEW_STATUSES:
                    apply_review_sla(latest)
            self._repo.save_job(result.job)
            self._repo.save_case(latest)
            return result

    def run_queued_analyze(self, case_id: str, job_id: str, *, hold_slot: bool = False) -> None:
        """Thread/RQ worker entry: cancel-while-queued, cancel probe, approve-race guard.

        When ``hold_slot`` is False (RQ / direct call), acquires the durable gate here.
        Thread enqueue acquires the slot before scheduling and passes ``hold_slot=True``.
        """
        owns_slot = False
        if not hold_slot:
            if not self._analyze_gate.try_acquire():
                with self._lock:
                    queued = self._repo.get_job(job_id)
                    case = self._repo.get_case(case_id)
                    if queued is not None:
                        queued.status = JobStatus.FAILED
                        queued.outcome = PipelineOutcome.FAILED
                        queued.error_message = (
                            f"Too many concurrent analyses (max {self._max_concurrent_analyze})."
                        )
                        queued.completed_at = _now()
                        self._repo.save_job(queued)
                    if (
                        case is not None
                        and case.status == CaseLifecycleStatus.ANALYZING
                        and case.latest_job_id == job_id
                    ):
                        case.status = CaseLifecycleStatus.FAILED
                        case.updated_at = _now()
                        self._repo.save_case(case)
                return
            owns_slot = True
        try:
            with self._lock:
                current = self._repo.get_case(case_id)
                queued = self._repo.get_job(job_id)
                if current is None or queued is None:
                    return
                if queued.cancel_requested or queued.status == JobStatus.CANCELLED:
                    queued.status = JobStatus.CANCELLED
                    queued.outcome = PipelineOutcome.FAILED
                    queued.error_message = queued.error_message or "Cancelled while queued."
                    queued.completed_at = queued.completed_at or _now()
                    if current.status == CaseLifecycleStatus.ANALYZING and current.latest_job_id == job_id:
                        # Restore prior draft path via persist rules — mark failed job only.
                        if current.draft_report is not None:
                            current.status = CaseLifecycleStatus.AWAITING_REVIEW
                            apply_review_sla(current)
                        else:
                            current.status = CaseLifecycleStatus.FAILED
                        current.updated_at = _now()
                        self._repo.save_case(current)
                    self._repo.save_job(queued)
                    return
                # Approved while queued (or before worker start): discard without mutating case.
                if current.status == CaseLifecycleStatus.APPROVED or (
                    current.draft_report is not None and current.draft_report.immutable
                ):
                    queued.status = JobStatus.FAILED
                    queued.outcome = PipelineOutcome.FAILED
                    queued.error_message = (
                        "Analysis discarded: case was approved while analysis was in flight. "
                        "Approved immutable report was preserved."
                    )
                    queued.completed_at = _now()
                    self._repo.save_job(queued)
                    return
                working = current.model_copy(deep=True)
                job_working = queued.model_copy(deep=True)
                # Expose running + 0–stage progress before the long orchestrator body.
                if job_working.status == JobStatus.QUEUED:
                    job_working.status = JobStatus.RUNNING
                    job_working.started_at = job_working.started_at or _now()
                    apply_pipeline_progress(job_working, "prep_metadata")
                    self._repo.save_job(job_working)
            report_language = self._resolve_report_language(working)
            result = self._orchestrator.run(
                working,
                job_working,
                cancel_probe=lambda: self._job_cancel_requested(job_id),
                on_progress=self._persist_job_progress,
                report_language=report_language,
            )
            # Preserve job_id identity for persistence (copy may diverge on cancel flags).
            result.job.job_id = job_id
            self._persist_pipeline_result(case_id, working, result)
        finally:
            if owns_slot or hold_slot:
                self._release_analyze_slot()

    def enqueue_analyze(
        self,
        case_id: str,
        *,
        idempotency_key: str | None = None,
        principal: AuthPrincipal | None = None,
    ) -> AnalysisJob:
        """Queue analysis via job backend (thread default, optional RQ).

        Idempotent while a job is queued/running for the case: returns the active job.
        Poll GET /jobs/{job_id}. Cancel via POST /jobs/{job_id}/cancel (cooperative).
        Shares the same durable concurrency gate as sync analyze.
        """
        key = (idempotency_key or "").strip() or None
        with self._lock:
            case = self.get_case(case_id, principal=principal)
            # Duplicate submission: return in-flight job instead of starting another.
            if case.status == CaseLifecycleStatus.ANALYZING and case.latest_job_id:
                existing = self._repo.get_job(case.latest_job_id)
                if existing is not None and existing.status in {
                    JobStatus.QUEUED,
                    JobStatus.RUNNING,
                    JobStatus.CANCEL_REQUESTED,
                }:
                    return existing
            # Same Idempotency-Key on latest job → return that job (completed or not).
            if key and case.latest_job_id:
                prior = self._repo.get_job(case.latest_job_id)
                if prior is not None and prior.idempotency_key == key:
                    return prior
            self._assert_analyzable(case)
            if getattr(self._jobs, "name", "") == "rq":
                from app.services.repository import InMemoryCaseRepository

                if isinstance(self._repo, InMemoryCaseRepository):
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="RQ job backend requires durable storage (sqlite/postgres), not memory.",
                    )

        # Fail-fast concurrency (same policy as sync). Slot held until worker finishes.
        is_rq = getattr(self._jobs, "name", "") == "rq"
        if not is_rq:
            self._acquire_analyze_slot()
        try:
            with self._lock:
                case = self.get_case(case_id, principal=principal)
                self._assert_analyzable(case)
                job = AIOrchestrator.new_job(case.case_id)
                job.status = JobStatus.QUEUED
                if key:
                    job.idempotency_key = key
                case.latest_job_id = job.job_id
                case.status = CaseLifecycleStatus.ANALYZING
                case.updated_at = _now()
                self._repo.save_case(case)
                self._repo.save_job(job)

            def _worker() -> None:
                # Thread path already holds the slot; RQ acquires inside run_queued_analyze.
                self.run_queued_analyze(case_id, job.job_id, hold_slot=not is_rq)

            self._jobs.enqueue_analyze(case_id, job.job_id, _worker)
            return job
        except Exception:
            if not is_rq:
                self._release_analyze_slot()
            raise

    def request_cancel_job(
        self, job_id: str, *, principal: AuthPrincipal | None = None
    ) -> AnalysisJob:
        """Cooperative cancel request. Does not kill threads; orchestrator checks the flag."""
        with self._lock:
            job = self.get_job(job_id, principal=principal)
            if job.status in {
                JobStatus.COMPLETED,
                JobStatus.FAILED,
                JobStatus.CANCELLED,
                JobStatus.TIMED_OUT,
            }:
                return job
            job.cancel_requested = True
            if job.status == JobStatus.QUEUED:
                job.status = JobStatus.CANCELLED
                job.outcome = PipelineOutcome.FAILED
                job.error_message = "Cancelled while queued."
                job.completed_at = _now()
                case = self._repo.get_case(job.case_id)
                if case is not None and case.latest_job_id == job.job_id:
                    # Do not wipe a prior approvable draft when cancelling a queued re-analyze.
                    if case.draft_report is not None and not case.draft_report.immutable:
                        case.status = CaseLifecycleStatus.AWAITING_REVIEW
                        apply_review_sla(case)
                    else:
                        case.status = CaseLifecycleStatus.FAILED
                    case.updated_at = _now()
                    self._repo.save_case(case)
            else:
                job.status = JobStatus.CANCEL_REQUESTED
            self._repo.save_job(job)
            return job

    def get_job(self, job_id: str, *, principal: AuthPrincipal | None = None) -> AnalysisJob:
        job = self._repo.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
        # Enforce case-level access for job status (prevents cross-tenant job polling).
        self.get_case(job.case_id, principal=principal)
        return job

    def get_findings(self, case_id: str, *, principal: AuthPrincipal | None = None) -> StructuredFindings:
        case = self.get_case(case_id, principal=principal)
        if case.structured_findings is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Structured findings are not available yet.")
        return case.structured_findings

