from __future__ import annotations

import threading
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.auth.tenancy import assert_case_access, bind_reviewer_id, can_access_owned
from app.models.model_input_builder import build_imaging_model_input
from app.orchestration.orchestrator import AIOrchestrator
from app.schemas.case import CaseCreate, CaseRecord, CaseSummary, ReviewFeedback
from app.schemas.enums import CaseLifecycleStatus, ExpertReviewStatus, JobStatus, ReportStatus, ReviewAction
from app.schemas.findings import StructuredFindings
from app.schemas.jobs import AnalysisJob, PipelineResult
from app.schemas.model_input import ImagingModelInput
from app.schemas.report import DraftReport, ReportVersionSnapshot, ReportVersionSummary
from app.security.audit import AuditLogger, AuditOutcome
from app.services.report_versioning import (
    apply_reject_or_revision,
    assert_mutable_for_edit,
    attach_pipeline_draft,
    freeze_approved,
    get_version,
    list_version_summaries,
)
from app.services.repository import CaseRepository
from app.validation.report_validator import ReportValidator
from app.workers.job_backend import JobBackend, ThreadJobBackend


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CaseService:
    def __init__(
        self,
        repo: CaseRepository,
        orchestrator: AIOrchestrator,
        validator: ReportValidator | None = None,
        *,
        async_delay_ms: int = 0,
        job_backend: JobBackend | None = None,
        tenant_isolation: bool = False,
        audit: AuditLogger | None = None,
        max_concurrent_analyze: int = 8,
    ) -> None:
        self._repo = repo
        self._orchestrator = orchestrator
        self._validator = validator or orchestrator.validator
        self._async_delay_ms = max(0, async_delay_ms)
        self._lock = threading.Lock()
        self._jobs = job_backend or ThreadJobBackend(delay_ms=self._async_delay_ms)
        self._tenant_isolation = tenant_isolation
        self._audit_log = audit
        self._max_concurrent_analyze = max(1, max_concurrent_analyze)
        self._analyze_inflight = 0
        self._analyze_gate = threading.Semaphore(self._max_concurrent_analyze)

    def _emit_audit(
        self,
        event_type: str,
        *,
        principal: AuthPrincipal | None,
        resource: str,
        outcome: AuditOutcome = AuditOutcome.SUCCESS,
        detail: str | None = None,
    ) -> None:
        if self._audit_log is None:
            return
        self._audit_log.record(
            event_type=event_type,
            actor=principal.subject if principal else "system",
            resource=resource,
            outcome=outcome,
            detail=detail,
            clinic_id=principal.clinic_id if principal else None,
        )

    def create_case(self, payload: CaseCreate, *, principal: AuthPrincipal | None = None) -> CaseRecord:
        case = CaseRecord(
            case_id=f"case-{uuid4().hex[:12]}",
            patient_name=payload.patient_name.strip(),
            species=payload.species,
            breed=payload.breed,
            modality=payload.modality,
            anatomical_region=payload.anatomical_region,
            clinical_history=payload.clinical_history,
            scenario=payload.scenario,
            study=payload.study,
            referring_clinic=payload.referring_clinic,
            owner_subject=principal.subject if principal and principal.via != "disabled" else None,
            clinic_id=principal.clinic_id if principal and principal.via != "disabled" else None,
            status=CaseLifecycleStatus.CREATED,
        )
        caps = self._orchestrator._router.list_capabilities()  # noqa: SLF001 — live caps for F4
        case.model_input = build_imaging_model_input(case, capabilities=caps)
        saved = self._repo.save_case(case)
        self._emit_audit("case.create", principal=principal, resource=saved.case_id)
        return saved

    def prepare_model_input(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> ImagingModelInput:
        """Build/refresh the AI-facing ImagingModelInput package for a case."""
        case = self.get_case(case_id, principal=principal)
        caps = self._orchestrator._router.list_capabilities()  # noqa: SLF001
        case.model_input = build_imaging_model_input(case, capabilities=caps)
        case.updated_at = _now()
        self._repo.save_case(case)
        return case.model_input

    def list_cases(self, *, principal: AuthPrincipal | None = None) -> list[CaseSummary]:
        summaries: list[CaseSummary] = []
        for c in self._repo.list_cases():
            if principal is not None and not can_access_owned(
                principal, c, isolation=self._tenant_isolation
            ):
                continue
            summaries.append(
                CaseSummary(
                    case_id=c.case_id,
                    patient_name=c.patient_name,
                    species=c.species,
                    breed=c.breed,
                    modality=c.modality,
                    anatomical_region=c.anatomical_region,
                    status=c.status,
                    scenario=c.scenario,
                    created_at=c.created_at,
                    latest_job_id=c.latest_job_id,
                    classification_confirmed=c.classification_confirmed,
                    study_instance_uid=c.study.study_instance_uid
                    or (c.dicom_study.study_instance_uid if c.dicom_study else None),
                    series_count=c.study.series_count
                    if c.study.series_count is not None
                    else (c.dicom_study.series_count if c.dicom_study else None),
                    instance_count=c.study.instance_count
                    if c.study.instance_count is not None
                    else (c.dicom_study.instance_count if c.dicom_study else None),
                    owner_subject=c.owner_subject,
                    clinic_id=c.clinic_id,
                )
            )
        return summaries

    def get_case(self, case_id: str, *, principal: AuthPrincipal | None = None) -> CaseRecord:
        case = self._repo.get_case(case_id)
        if case is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")
        if principal is not None:
            assert_case_access(principal, case, isolation=self._tenant_isolation)
            self._emit_audit("case.read", principal=principal, resource=case_id)
        return case

    def _assert_analyzable(self, case: CaseRecord) -> None:
        if case.status == CaseLifecycleStatus.AWAITING_CLASSIFICATION_CONFIRMATION:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot analyze until DICOM metadata classification is confirmed.",
            )
        if not case.classification_confirmed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot analyze: classification_confirmed is false.",
            )
        if case.status == CaseLifecycleStatus.APPROVED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Cannot re-analyze an approved case. "
                    "Request revision first so a new mutable report version can be created."
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
                    detail="Analysis already in progress for this case.",
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
        acquired = self._analyze_gate.acquire(blocking=False)
        if not acquired:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many concurrent analyses (max {self._max_concurrent_analyze}).",
            )
        try:
            result = self._orchestrator.run(case, job)
        finally:
            self._analyze_gate.release()
        with self._lock:
            self._apply_report_versioning(case, result)
            self._repo.save_job(result.job)
            self._repo.save_case(case)
        self._emit_audit("analysis.run", principal=principal, resource=case_id)
        return result

    def _apply_report_versioning(self, case: CaseRecord, result: PipelineResult) -> None:
        """Attach version metadata when the pipeline produced a draft report."""
        if result.report is None:
            return
        # Reload versions from the in-memory case object mutated by the orchestrator.
        attach_pipeline_draft(case, result.report)
        result.report = case.draft_report

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
        """
        with self._lock:
            case = self.get_case(case_id, principal=principal)
            key = (idempotency_key or "").strip() or None
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
            with self._lock:
                current = self._repo.get_case(case_id)
                queued = self._repo.get_job(job.job_id)
                if current is None or queued is None:
                    return
                # Reload cancel flag if set while queued.
                if queued.cancel_requested:
                    queued.status = JobStatus.CANCELLED
                    queued.outcome = None
                    queued.error_message = "Cancelled while queued."
                    queued.completed_at = _now()
                    current.status = CaseLifecycleStatus.FAILED
                    current.updated_at = _now()
                    self._repo.save_job(queued)
                    self._repo.save_case(current)
                    return
            result = self._orchestrator.run(current, queued)
            with self._lock:
                # Re-load under lock: keep history from disk, apply pipeline outputs + versioning.
                latest = self._repo.get_case(case_id) or current
                latest.structured_findings = current.structured_findings
                latest.status = current.status
                latest.latest_job_id = current.latest_job_id
                latest.updated_at = current.updated_at
                latest.model_input = current.model_input
                if result.report is not None:
                    attach_pipeline_draft(latest, result.report)
                    result.report = latest.draft_report
                else:
                    latest.draft_report = current.draft_report
                self._repo.save_job(result.job)
                self._repo.save_case(latest)

        self._jobs.enqueue_analyze(case_id, job.job_id, _worker)
        return job

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
                job.error_message = "Cancelled while queued."
                job.completed_at = _now()
                case = self._repo.get_case(job.case_id)
                if case is not None and case.latest_job_id == job.job_id:
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

    def get_report(
        self, case_id: str, *, version: int | None = None, principal: AuthPrincipal | None = None
    ) -> DraftReport:
        case = self.get_case(case_id, principal=principal)
        if version is not None:
            snap = get_version(case, version)
            if snap is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Report version {version} not found for this case.",
                )
            return snap.content
        if case.draft_report is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Draft report is not available (failed/unsupported cases do not produce an AI draft).",
            )
        return case.draft_report

    def list_report_versions(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[ReportVersionSummary]:
        case = self.get_case(case_id, principal=principal)
        return list_version_summaries(case)

    def get_report_version(
        self, case_id: str, version: int, *, principal: AuthPrincipal | None = None
    ) -> ReportVersionSnapshot:
        case = self.get_case(case_id, principal=principal)
        snap = get_version(case, version)
        if snap is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Report version {version} not found for this case.",
            )
        return snap

    def submit_review(
        self,
        case_id: str,
        feedback: ReviewFeedback,
        *,
        principal: AuthPrincipal | None = None,
    ) -> CaseRecord:
        """Apply expert review under lock (atomic version numbering vs concurrent analyzes)."""
        with self._lock:
            case = self.get_case(case_id, principal=principal)
            if principal is not None:
                bound = bind_reviewer_id(principal, feedback.reviewer_id)
                feedback = feedback.model_copy(update={"reviewer_id": bound})

            if feedback.action == ReviewAction.APPROVE:
                result = self._approve_ai_draft(case, feedback)
                self._emit_audit("review.approve", principal=principal, resource=case_id)
                return result

            if case.draft_report is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Cannot reject/revise without an AI draft. "
                        "Failed and unsupported cases have no approvable AI draft; use manual workflow outside AI approval."
                    ),
                )
            if case.status == CaseLifecycleStatus.FAILED:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot review a failed analysis as an AI draft.",
                )
            if case.status == CaseLifecycleStatus.MANUAL_REVIEW:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Unsupported case is for manual review only; AI draft reject/revision does not apply.",
                )

            report = case.draft_report.model_copy(deep=True)
            try:
                if report.immutable or report.status == ReportStatus.APPROVED:
                    # Fork handled inside apply_reject_or_revision after edits.
                    pass
                else:
                    assert_mutable_for_edit(report)
            except PermissionError as exc:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

            self._apply_edits(report, feedback)
            report.reviewer_comment = feedback.comment
            report = apply_reject_or_revision(
                case,
                report,
                reviewer_id=feedback.reviewer_id,
                notes=feedback.comment,
                reject=feedback.action == ReviewAction.REJECT,
            )
            if feedback.action == ReviewAction.REJECT:
                case.status = CaseLifecycleStatus.REJECTED
            else:
                case.status = CaseLifecycleStatus.REVISION_REQUESTED

            case.review_history.append(feedback)
            case.updated_at = _now()
            saved = self._repo.save_case(case)
            event = "review.reject" if feedback.action == ReviewAction.REJECT else "review.revision"
            self._emit_audit(event, principal=principal, resource=case_id)
            return saved

    def _approve_ai_draft(self, case: CaseRecord, feedback: ReviewFeedback) -> CaseRecord:
        if case.status == CaseLifecycleStatus.FAILED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot approve: analysis failed and produced no AI draft.",
            )
        if case.status == CaseLifecycleStatus.MANUAL_REVIEW:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Cannot approve an AI draft for an unsupported case. "
                    "This case requires manual radiologist review, which is distinct from AI draft approval."
                ),
            )
        if case.draft_report is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot approve: there is no AI-generated draft report.",
            )

        report = case.draft_report.model_copy(deep=True)
        if report.immutable or report.status == ReportStatus.APPROVED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot approve: this report version is already approved and immutable.",
            )
        if case.status == CaseLifecycleStatus.APPROVED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Case already has an approved report. Request revision to open a new version.",
            )

        self._apply_edits(report, feedback)
        report.reviewer_comment = feedback.comment

        validation = self._validator.validate(report, case.structured_findings)
        if not validation.ok or report.status == ReportStatus.VALIDATION_FAILED:
            case.updated_at = _now()
            self._repo.save_case(case)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "message": "Cannot approve: draft failed structural revalidation.",
                    "errors": validation.errors,
                    "warnings": validation.warnings,
                },
            )

        if report.status not in {
            ReportStatus.AWAITING_REVIEW,
            ReportStatus.DRAFT,
            ReportStatus.REVISION_REQUESTED,
        }:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot approve draft in status '{report.status.value}'.",
            )

        freeze_approved(
            case,
            report,
            reviewer_id=feedback.reviewer_id,
            notes=feedback.comment,
        )
        case.status = CaseLifecycleStatus.APPROVED
        case.review_history.append(feedback)
        case.updated_at = _now()
        return self._repo.save_case(case)

    @staticmethod
    def _apply_edits(report: DraftReport, feedback: ReviewFeedback) -> None:
        if feedback.edited_technique is not None:
            report.technique.text = feedback.edited_technique
        if feedback.edited_findings is not None:
            report.findings.text = feedback.edited_findings
        if feedback.edited_impression is not None:
            report.impression.text = feedback.edited_impression
        if feedback.edited_recommendations is not None:
            report.recommendations.text = feedback.edited_recommendations
