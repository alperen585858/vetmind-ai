from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.auth.tenancy import assert_case_access, bind_reviewer_id, can_access_owned
from app.models.model_input_builder import build_imaging_model_input
from app.orchestration.orchestrator import AIOrchestrator
from app.schemas.case import (
    CaseActivityEvent,
    CaseAssignmentUpdate,
    CaseCreate,
    CaseMessage,
    CaseMessageCreate,
    CaseMessageView,
    CaseRecord,
    CaseSummary,
    ClinicDashboardStats,
    ReportDraftUpdate,
    ReviewFeedback,
)
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
from app.services.activity import append_activity
from app.schemas.enums import (
    CaseLifecycleStatus,
    ExpertReviewStatus,
    JobStatus,
    PipelineOutcome,
    ReportStatus,
    ReviewAction,
)
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
    snapshot_from_draft,
    upsert_version_snapshot,
)
from app.services.repository import CaseRepository
from app.validation.report_validator import ReportValidator
from app.workers.analyze_gate import AnalyzeGate, build_analyze_gate
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
        analyze_gate_path: Path | None = None,
        notifications: object | None = None,
    ) -> None:
        self._repo = repo
        self._orchestrator = orchestrator
        self._validator = validator or orchestrator.validator
        self._async_delay_ms = max(0, async_delay_ms)
        self._lock = threading.Lock()
        self._jobs = job_backend or ThreadJobBackend(delay_ms=self._async_delay_ms)
        self._tenant_isolation = tenant_isolation
        self._audit_log = audit
        self._notifications = notifications
        self._max_concurrent_analyze = max(1, max_concurrent_analyze)
        # Durable gate shared by sync + async (thread/RQ on same host).
        self._analyze_gate: AnalyzeGate = build_analyze_gate(
            max_concurrent=self._max_concurrent_analyze,
            path=analyze_gate_path,
        )

    def _acquire_analyze_slot(self) -> None:
        if not self._analyze_gate.try_acquire():
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many concurrent analyses (max {self._max_concurrent_analyze}).",
            )

    def _release_analyze_slot(self) -> None:
        self._analyze_gate.release()

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
        history = payload.clinical_history
        structured = payload.clinical_history_structured
        if structured is not None and not history:
            parts = [
                structured.complaint,
                structured.onset,
                structured.course,
                structured.medications,
                structured.relevant_history,
                structured.handoff_notes,
            ]
            history = "\n".join(p for p in parts if p) or None
        case = CaseRecord(
            case_id=f"case-{uuid4().hex[:12]}",
            patient_name=payload.patient_name.strip(),
            species=payload.species,
            breed=payload.breed,
            patient_age_years=payload.patient_age_years,
            modality=payload.modality,
            anatomical_region=payload.anatomical_region,
            clinical_history=history,
            clinical_history_structured=structured,
            priority=payload.priority or "normal",
            assigned_reviewer_id=payload.assigned_reviewer_id,
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

    def _unread_for(self, case: CaseRecord, principal: AuthPrincipal | None) -> int:
        if principal is None or principal.via == "disabled":
            return 0
        subject = principal.subject
        return sum(1 for m in case.messages if subject not in m.read_by and m.author_id != subject)

    def _to_summary(self, c: CaseRecord, *, principal: AuthPrincipal | None = None) -> CaseSummary:
        return CaseSummary(
            case_id=c.case_id,
            patient_name=c.patient_name,
            species=c.species,
            breed=c.breed,
            patient_age_years=c.patient_age_years,
            modality=c.modality,
            anatomical_region=c.anatomical_region,
            status=c.status,
            priority=getattr(c, "priority", None) or "normal",
            assigned_reviewer_id=c.assigned_reviewer_id,
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
            referring_clinic=c.referring_clinic,
            unread_messages=self._unread_for(c, principal),
            report_available_at=getattr(c, "report_available_at", None),
            report_delivered_at=getattr(c, "report_delivered_at", None),
            report_viewed_at=getattr(c, "report_viewed_at", None),
            pet_id=getattr(c, "pet_id", None),
            pet_owner_subject=getattr(c, "pet_owner_subject", None),
            submission_id=getattr(c, "submission_id", None),
            vet_verified=bool(getattr(c, "vet_verified", True)),
        )

    def list_cases(self, *, principal: AuthPrincipal | None = None) -> list[CaseSummary]:
        summaries: list[CaseSummary] = []
        for c in self._repo.list_cases():
            if principal is not None and not can_access_owned(
                principal, c, isolation=self._tenant_isolation
            ):
                continue
            # Pet owners only see finalized (approved) cases linked to them.
            if (
                principal is not None
                and principal.role == "owner"
                and principal.via == "jwt"
                and c.status != CaseLifecycleStatus.APPROVED
            ):
                continue
            summaries.append(self._to_summary(c, principal=principal))
        return summaries

    def list_worklist(
        self,
        *,
        principal: AuthPrincipal | None = None,
        status: str | None = None,
        modality: str | None = None,
        priority: str | None = None,
        assigned_to: str | None = None,
        q: str | None = None,
    ) -> list[CaseSummary]:
        """Radiologist worklist: tenant-filtered summaries with optional filters."""
        rows = self.list_cases(principal=principal)
        status_l = (status or "").strip().lower()
        modality_l = (modality or "").strip().upper()
        priority_l = (priority or "").strip().lower()
        assigned = (assigned_to or "").strip()
        query = (q or "").strip().lower()

        def _match(s: CaseSummary) -> bool:
            if status_l and s.status.value != status_l:
                return False
            if modality_l and s.modality.value != modality_l:
                return False
            if priority_l and (s.priority or "normal") != priority_l:
                return False
            if assigned == "unassigned":
                if s.assigned_reviewer_id:
                    return False
            elif assigned and (s.assigned_reviewer_id or "") != assigned:
                return False
            if query:
                hay = " ".join(
                    [
                        s.case_id,
                        s.patient_name,
                        s.breed or "",
                        s.referring_clinic or "",
                        s.clinic_id or "",
                    ]
                ).lower()
                if query not in hay:
                    return False
            return True

        # STAT > URGENT > high (legacy) > NORMAL
        priority_rank = {"stat": 0, "urgent": 1, "high": 2, "normal": 3}
        matched = [s for s in rows if _match(s)]
        matched.sort(
            key=lambda s: (
                priority_rank.get(s.priority or "normal", 9),
                s.created_at,
            )
        )
        return matched

    def clinic_dashboard(
        self,
        *,
        principal: AuthPrincipal | None = None,
        q: str | None = None,
        status: str | None = None,
    ) -> ClinicDashboardStats:
        """Clinic board counters — reuses list_cases tenancy; no duplicate assignment logic."""
        rows = self.list_worklist(principal=principal, status=status, q=q)
        terminal = {
            CaseLifecycleStatus.APPROVED,
            CaseLifecycleStatus.REJECTED,
        }
        active = sum(1 for s in rows if s.status not in terminal)
        awaiting = sum(1 for s in rows if s.status == CaseLifecycleStatus.AWAITING_REVIEW)
        urgent = sum(1 for s in rows if (s.priority or "normal") in {"urgent", "stat"})
        completed = sum(1 for s in rows if s.status == CaseLifecycleStatus.APPROVED)
        unread = sum(s.unread_messages for s in rows)
        return ClinicDashboardStats(
            active_cases=active,
            awaiting_review=awaiting,
            urgent_cases=urgent,
            completed_reports=completed,
            unread_messages=unread,
        )

    def list_messages(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[CaseMessageView]:
        case = self.get_case(case_id, principal=principal)
        subject = principal.subject if principal and principal.via != "disabled" else ""
        views: list[CaseMessageView] = []
        for m in case.messages:
            unread = bool(subject and subject not in m.read_by and m.author_id != subject)
            views.append(
                CaseMessageView(
                    message_id=m.message_id,
                    case_id=m.case_id or case.case_id,
                    author_id=m.author_id,
                    author_role=m.author_role,
                    body=m.body,
                    created_at=m.created_at,
                    unread=unread,
                )
            )
        return views

    def post_message(
        self,
        case_id: str,
        payload: CaseMessageCreate,
        *,
        principal: AuthPrincipal | None = None,
    ) -> CaseMessageView:
        case = self.get_case(case_id, principal=principal)
        author_id = principal.subject if principal and principal.via != "disabled" else "demo"
        author_role = principal.role if principal else "demo"
        msg = CaseMessage(
            case_id=case.case_id,
            author_id=author_id,
            author_role=author_role,
            body=payload.body.strip(),
            read_by=[author_id],
        )
        case.messages.append(msg)
        append_activity(case, kind="case_message", actor_subject=author_id, detail=msg.message_id)
        case.updated_at = _now()
        self._repo.save_case(case)
        self._emit_audit("case.message", principal=principal, resource=case_id)
        # Notify other authorized participants (not the author).
        recipients = {
            case.pet_owner_subject,
            case.owner_subject,
            case.assigned_reviewer_id,
        }
        # Clinic vets are notified via assigned/owner; also notify known vet subject if distinct.
        for recipient in recipients:
            if not recipient or recipient == author_id:
                continue
            self._notify(
                recipient_subject=recipient,
                kind="case_message",
                title="Yeni vaka mesajı",
                body=msg.body[:160],
                link_path=f"/vakalar/{case.case_id}",
                dedupe_key=f"case_message:{case.case_id}:{msg.message_id}:{recipient}",
                case_id=case.case_id,
                clinic_id=case.clinic_id,
            )
        return CaseMessageView(
            message_id=msg.message_id,
            case_id=msg.case_id,
            author_id=msg.author_id,
            author_role=msg.author_role,
            body=msg.body,
            created_at=msg.created_at,
            unread=False,
        )

    def mark_messages_read(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[CaseMessageView]:
        case = self.get_case(case_id, principal=principal)
        if principal is None or principal.via == "disabled":
            return self.list_messages(case_id, principal=principal)
        subject = principal.subject
        changed = False
        for m in case.messages:
            if m.author_id != subject and subject not in m.read_by:
                m.read_by.append(subject)
                changed = True
        if changed:
            case.updated_at = _now()
            self._repo.save_case(case)
        return self.list_messages(case_id, principal=principal)

    def mark_report_delivered(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> CaseRecord:
        case = self.get_case(case_id, principal=principal)
        if case.status != CaseLifecycleStatus.APPROVED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Report can only be marked delivered after approval.",
            )
        if case.report_available_at is None:
            case.report_available_at = _now()
        if case.report_delivered_at is None:
            case.report_delivered_at = _now()
            actor = principal.subject if principal else "system"
            append_activity(case, kind="report_delivered", actor_subject=actor)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        self._emit_audit("report.delivered", principal=principal, resource=case_id)
        return saved

    def mark_report_viewed(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> CaseRecord:
        case = self.get_case(case_id, principal=principal)
        if case.status != CaseLifecycleStatus.APPROVED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Report can only be marked viewed after approval.",
            )
        # Never mutates approved report content — only delivery metadata on the case.
        if case.report_available_at is None:
            case.report_available_at = _now()
        if case.report_delivered_at is None:
            case.report_delivered_at = _now()
        if case.report_viewed_at is None:
            case.report_viewed_at = _now()
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        self._emit_audit("report.viewed", principal=principal, resource=case_id)
        return saved

    def update_assignment(
        self,
        case_id: str,
        payload: CaseAssignmentUpdate,
        *,
        principal: AuthPrincipal | None = None,
    ) -> CaseRecord:
        case = self.get_case(case_id, principal=principal)
        prev_assignee = case.assigned_reviewer_id
        if payload.assigned_reviewer_id is not None:
            text = payload.assigned_reviewer_id.strip()
            case.assigned_reviewer_id = text or None
        if payload.priority is not None:
            case.priority = payload.priority
        actor = principal.subject if principal else "system"
        if case.assigned_reviewer_id and case.assigned_reviewer_id != prev_assignee:
            append_activity(
                case,
                kind="radiologist_assigned",
                actor_subject=actor,
                detail=case.assigned_reviewer_id,
            )
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        self._emit_audit("case.assign", principal=principal, resource=case_id)
        if saved.assigned_reviewer_id and saved.assigned_reviewer_id != prev_assignee:
            urgent = saved.priority in {"urgent", "stat"}
            self._notify(
                recipient_subject=saved.assigned_reviewer_id,
                kind="urgent_assignment" if urgent else "radiologist_assigned",
                title="STAT atama" if saved.priority == "stat" else ("Acil atama" if urgent else "Radyolog ataması"),
                body=f"{saved.patient_name} · {saved.case_id}",
                link_path=f"/vakalar/{saved.case_id}/calisma",
                dedupe_key=f"radiologist_assigned:{saved.case_id}:{saved.assigned_reviewer_id}",
                case_id=saved.case_id,
                clinic_id=saved.clinic_id,
            )
        return saved

    def save_draft_report(
        self,
        case_id: str,
        payload: ReportDraftUpdate,
        *,
        principal: AuthPrincipal | None = None,
    ) -> DraftReport:
        """Persist editable draft sections. Refuses immutable/approved reports."""
        case = self.get_case(case_id, principal=principal)
        if case.draft_report is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No draft report to save.",
            )
        report = case.draft_report.model_copy(deep=True)
        try:
            assert_mutable_for_edit(report)
        except (PermissionError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        if report.status == ReportStatus.APPROVED or report.immutable:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Approved reports are immutable and cannot be edited in place.",
            )
        if payload.technique is not None:
            report.technique.text = payload.technique
        if payload.findings is not None:
            report.findings.text = payload.findings
        if payload.impression is not None:
            report.impression.text = payload.impression
        if payload.recommendations is not None:
            report.recommendations.text = payload.recommendations
        if payload.note:
            report.revision_notes = payload.note
        report.updated_at = _now()
        case.draft_report = report
        try:
            upsert_version_snapshot(
                case,
                snapshot_from_draft(
                    case,
                    report,
                    author_or_source=payload.editor_id,
                    revision_notes=payload.note,
                    immutable=False,
                ),
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        case.updated_at = _now()
        self._repo.save_case(case)
        self._emit_audit("report.draft_save", principal=principal, resource=case_id)
        return report

    def get_case(self, case_id: str, *, principal: AuthPrincipal | None = None) -> CaseRecord:
        case = self._repo.get_case(case_id)
        if case is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")
        if principal is not None:
            assert_case_access(principal, case, isolation=self._tenant_isolation)
            if (
                principal.role == "owner"
                and principal.via == "jwt"
                and case.status != CaseLifecycleStatus.APPROVED
            ):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")
            self._emit_audit("case.read", principal=principal, resource=case_id)
            # Internal radiologist notes are not visible to owners/vets.
            if principal.via == "jwt" and principal.role not in {"expert", "admin", "demo", "service"}:
                case = case.model_copy(update={"internal_notes": []})
        return case

    def _assert_analyzable(self, case: CaseRecord) -> None:
        if getattr(case, "vet_verified", True) is False:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Owner submissions require veterinary verification before analysis.",
            )
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
        self._acquire_analyze_slot()
        try:
            # Deep copy so orchestrator cannot mutate the repository's live case object
            # (InMemoryCaseRepository returns the same reference — approve-race safety).
            working = case.model_copy(deep=True)
            result = self._orchestrator.run(
                working, job, cancel_probe=lambda: self._job_cancel_requested(job.job_id)
            )
        finally:
            self._release_analyze_slot()
        result = self._persist_pipeline_result(case_id, working, result)
        self._emit_audit("analysis.run", principal=principal, resource=case_id)
        return result

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
                else:
                    latest.status = working.status
            else:
                latest.draft_report = working.draft_report
                latest.status = working.status
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
            result = self._orchestrator.run(
                working,
                job_working,
                cancel_probe=lambda: self._job_cancel_requested(job_id),
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
                append_activity(
                    case,
                    kind="revision_requested",
                    actor_subject=feedback.reviewer_id,
                    detail=feedback.comment,
                )

            case.review_history.append(feedback)
            case.updated_at = _now()
            saved = self._repo.save_case(case)
            event = "review.reject" if feedback.action == ReviewAction.REJECT else "review.revision"
            self._emit_audit(event, principal=principal, resource=case_id)
            if feedback.action == ReviewAction.REQUEST_REVISION:
                for recipient in {saved.owner_subject, saved.pet_owner_subject, "vet@demo.local"}:
                    if not recipient or recipient == feedback.reviewer_id:
                        continue
                    self._notify(
                        recipient_subject=recipient,
                        kind="revision_requested",
                        title="Revizyon istendi",
                        body=feedback.comment or f"Vaka {saved.case_id}",
                        link_path=f"/vakalar/{saved.case_id}",
                        dedupe_key=f"revision_requested:{saved.case_id}:{saved.updated_at.isoformat()}:{recipient}",
                        case_id=saved.case_id,
                        clinic_id=saved.clinic_id,
                    )
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
        if case.report_available_at is None:
            case.report_available_at = _now()
        append_activity(
            case,
            kind="report_approved",
            actor_subject=feedback.reviewer_id,
            detail=f"v{report.version}",
        )
        case.review_history.append(feedback)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        for recipient in {saved.pet_owner_subject, saved.owner_subject, "vet@demo.local"}:
            if not recipient or recipient == feedback.reviewer_id:
                continue
            self._notify(
                recipient_subject=recipient,
                kind="report_approved",
                title="Rapor onaylandı",
                body=f"{saved.patient_name} · {saved.case_id}",
                link_path=f"/raporlar/{saved.case_id}",
                dedupe_key=f"report_approved:{saved.case_id}:v{report.version}:{recipient}",
                case_id=saved.case_id,
                clinic_id=saved.clinic_id,
            )
        return saved

    def _notify(self, **kwargs) -> None:
        nsvc = self._notifications
        if nsvc is None:
            return
        nsvc.notify(**kwargs)  # type: ignore[union-attr]

    def list_activity(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[CaseActivityEvent]:
        case = self.get_case(case_id, principal=principal)
        return list(case.activity)

    def append_clinical_note(
        self, case_id: str, payload: CaseNoteCreate, *, principal: AuthPrincipal
    ) -> CaseRecord:
        if principal.role not in {"vet", "clinic_owner", "admin", "demo", "service", "expert"} and principal.via != "disabled":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
        case = self.get_case(case_id, principal=principal)
        entry = ClinicalNoteEntry(
            body=payload.body.strip(),
            author_subject=principal.subject,
            author_role=principal.role,
            kind="clinical",
        )
        case.clinical_notes_log = [*case.clinical_notes_log, entry]
        # Append to free-text history without losing prior content.
        prior = (case.clinical_history or "").rstrip()
        stamp = f"[{entry.created_at.isoformat()} · {principal.subject}] {entry.body}"
        case.clinical_history = f"{prior}\n\n{stamp}".strip() if prior else stamp
        append_activity(case, kind="clinical_note", actor_subject=principal.subject, detail=entry.note_id)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        recipients = {r for r in [saved.assigned_reviewer_id, saved.owner_subject] if r}
        for recipient in recipients:
            if recipient == principal.subject:
                continue
            self._notify(
                recipient_subject=recipient,
                kind="clinical_history_updated",
                title="Klinik not eklendi",
                body=entry.body[:200],
                link_path=f"/vakalar/{saved.case_id}",
                dedupe_key=f"clinical_history_updated:{saved.case_id}:{entry.note_id}:{recipient}",
                case_id=saved.case_id,
                clinic_id=saved.clinic_id,
            )
        return saved

    def append_internal_note(
        self, case_id: str, payload: CaseNoteCreate, *, principal: AuthPrincipal
    ) -> CaseRecord:
        if principal.role not in {"expert", "admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Internal notes are for radiologists.")
        case = self.get_case(case_id, principal=principal)
        entry = ClinicalNoteEntry(
            body=payload.body.strip(),
            author_subject=principal.subject,
            author_role=principal.role,
            kind="internal",
        )
        case.internal_notes = [*case.internal_notes, entry]
        append_activity(case, kind="internal_note", actor_subject=principal.subject, detail=entry.note_id)
        case.updated_at = _now()
        return self._repo.save_case(case)

    def create_info_request(
        self, case_id: str, payload: InfoRequestCreate, *, principal: AuthPrincipal
    ) -> CaseRecord:
        if principal.role not in {"expert", "vet", "clinic_owner", "admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
        case = self.get_case(case_id, principal=principal)
        to_role = payload.to_role
        irq = InfoRequest(
            status="OPEN",
            from_role=principal.role,
            from_subject=principal.subject,
            to_role=to_role,
            body=payload.body.strip(),
        )
        case.info_requests = [*case.info_requests, irq]
        append_activity(case, kind="info_request_opened", actor_subject=principal.subject, detail=irq.request_id)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        recipients: set[str] = set()
        if to_role == "vet":
            if saved.owner_subject and saved.owner_subject != saved.pet_owner_subject:
                recipients.add(saved.owner_subject)
            recipients.add("vet@demo.local")
        elif to_role == "owner":
            if saved.pet_owner_subject:
                recipients.add(saved.pet_owner_subject)
            elif saved.owner_subject:
                recipients.add(saved.owner_subject)
        elif to_role == "expert" and saved.assigned_reviewer_id:
            recipients.add(saved.assigned_reviewer_id)
        for recipient in recipients:
            if recipient == principal.subject:
                continue
            self._notify(
                recipient_subject=recipient,
                kind="info_request_opened",
                title="Bilgi isteği",
                body=irq.body[:200],
                link_path=f"/vakalar/{saved.case_id}",
                dedupe_key=f"info_request_opened:{saved.case_id}:{irq.request_id}:{recipient}",
                case_id=saved.case_id,
                clinic_id=saved.clinic_id,
            )
        return saved

    def reply_info_request(
        self,
        case_id: str,
        request_id: str,
        payload: InfoRequestReply,
        *,
        principal: AuthPrincipal,
    ) -> CaseRecord:
        case = self.get_case(case_id, principal=principal)
        found = False
        updated: list[InfoRequest] = []
        for irq in case.info_requests:
            if irq.request_id == request_id:
                if irq.status == "CLOSED":
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Info request is closed.")
                found = True
                updated.append(
                    irq.model_copy(
                        update={
                            "status": "ANSWERED",
                            "reply": payload.reply.strip(),
                            "answered_at": _now(),
                        }
                    )
                )
            else:
                updated.append(irq)
        if not found:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Info request not found.")
        case.info_requests = updated
        append_activity(case, kind="info_request_answered", actor_subject=principal.subject, detail=request_id)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        # Notify original requester
        for irq in saved.info_requests:
            if irq.request_id == request_id:
                self._notify(
                    recipient_subject=irq.from_subject,
                    kind="info_request_answered",
                    title="Bilgi isteği yanıtlandı",
                    body=payload.reply[:200],
                    link_path=f"/vakalar/{saved.case_id}",
                    dedupe_key=f"info_request_answered:{saved.case_id}:{request_id}",
                    case_id=saved.case_id,
                    clinic_id=saved.clinic_id,
                )
                break
        return saved

    def close_info_request(
        self, case_id: str, request_id: str, *, principal: AuthPrincipal
    ) -> CaseRecord:
        if principal.role not in {"vet", "expert", "clinic_owner", "admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
        case = self.get_case(case_id, principal=principal)
        found = False
        updated: list[InfoRequest] = []
        target_from: str | None = None
        for irq in case.info_requests:
            if irq.request_id == request_id:
                found = True
                target_from = irq.from_subject
                updated.append(irq.model_copy(update={"status": "CLOSED", "closed_at": _now()}))
            else:
                updated.append(irq)
        if not found:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Info request not found.")
        case.info_requests = updated
        append_activity(case, kind="info_request_closed", actor_subject=principal.subject, detail=request_id)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        if target_from:
            self._notify(
                recipient_subject=target_from,
                kind="info_request_closed",
                title="Bilgi isteği kapatıldı",
                body=f"Vaka {saved.case_id}",
                link_path=f"/vakalar/{saved.case_id}",
                dedupe_key=f"info_request_closed:{saved.case_id}:{request_id}",
                case_id=saved.case_id,
                clinic_id=saved.clinic_id,
            )
        return saved

    def attach_document_ingest(
        self,
        case_id: str,
        payload: CaseDocumentAttach,
        *,
        principal: AuthPrincipal,
        documents_svc: object | None = None,
    ) -> CaseRecord:
        """Bind a quarantined document ingest to an existing case (never creates a new case)."""
        if principal.role not in {"vet", "clinic_owner", "admin", "demo", "service", "expert"} and principal.via != "disabled":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
        case = self.get_case(case_id, principal=principal)
        if documents_svc is None:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Document service unavailable.")
        record = documents_svc.get_ingestion(payload.ingest_id, principal=principal)  # type: ignore[attr-defined]
        if record.blocked:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=record.block_reason or "Blocked ingest.")
        if record.accepted and record.case_id and record.case_id != case_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Document already linked to case {record.case_id}.",
            )
        # Merge into document_context without creating a case.
        new_docs = list(record.documents)
        if case.document_context is None:
            combined_parts = [
                f"--- {d.filename} ({d.content_kind.value}) ---\n{(d.extracted_text or '').strip()}"
                for d in new_docs
            ]
            combined = "\n\n".join(p for p in combined_parts if p.strip())
            case.document_context = CaseDocumentContext(
                document_ingest_id=record.ingest_id,
                documents=new_docs,
                combined_text_preview=(combined[:4000] + ("…[truncated]" if len(combined) > 4000 else "")) or None,
            )
        else:
            ctx = case.document_context
            if record.ingest_id != ctx.document_ingest_id and record.ingest_id not in ctx.additional_ingest_ids:
                ctx.additional_ingest_ids = [*ctx.additional_ingest_ids, record.ingest_id]
            # Deduplicate by filename+path
            existing_paths = {d.quarantine_relative_path for d in ctx.documents}
            for d in new_docs:
                if d.quarantine_relative_path not in existing_paths:
                    ctx.documents.append(d)
            combined_parts = [
                f"--- {d.filename} ({d.content_kind.value}) ---\n{(d.extracted_text or '').strip()}"
                for d in ctx.documents
            ]
            combined = "\n\n".join(p for p in combined_parts if p.strip())
            ctx.combined_text_preview = (combined[:4000] + ("…[truncated]" if len(combined) > 4000 else "")) or None
            case.document_context = ctx
        att = AttachmentRef(
            kind="document",
            ingest_id=record.ingest_id,
            uploaded_by=principal.subject,
        )
        if att.ingest_id not in {a.ingest_id for a in case.attachment_refs}:
            case.attachment_refs = [*case.attachment_refs, att]
        record.accepted = True
        record.case_id = case.case_id
        documents_svc._repo.save_document_ingestion(record)  # type: ignore[attr-defined]  # noqa: SLF001
        append_activity(case, kind="document_attached", actor_subject=principal.subject, detail=record.ingest_id)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        self._notify(
            recipient_subject=saved.assigned_reviewer_id,
            kind="attachment_added",
            title="Belge eklendi",
            body=f"Vaka {saved.case_id}",
            link_path=f"/vakalar/{saved.case_id}",
            dedupe_key=f"attachment_added:{saved.case_id}:{record.ingest_id}",
            case_id=saved.case_id,
            clinic_id=saved.clinic_id,
        )
        return saved

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
