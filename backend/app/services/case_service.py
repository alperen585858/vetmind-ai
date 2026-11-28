from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.feedback.store import FeedbackStore
from app.llm.comparison import build_comparison, comparison_warnings
from app.models.model_input_builder import build_imaging_model_input
from app.orchestration.orchestrator import AIOrchestrator
from app.schemas.case import (
    AiChatAsk,
    AiChatResponse,
    AiChatTurn,
    CaseActivityEvent,
    CaseCreate,
    CaseMessageCreate,
    CaseMessageView,
    CaseOwnerUpdate,
    CaseRecord,
    ReportDraftUpdate,
    ReviewFeedback,
)
from app.schemas.enums import (
    CaseLifecycleStatus,
)
from app.schemas.findings import StructuredFindings
from app.schemas.jobs import AnalysisJob, PipelineResult
from app.schemas.model_input import ImagingModelInput
from app.schemas.report import (
    DraftReport,
    ReportVersionSnapshot,
    ReportVersionSummary,
)
from app.schemas.workflow import (
    CaseDocumentAttach,
    CaseNoteCreate,
    InfoRequestCreate,
    InfoRequestReply,
)
from app.security.audit import AuditLogger, AuditOutcome
from app.services.activity import append_activity
from app.services.case_evidence import CaseEvidenceMixin
from app.services.case_lifecycle import CaseLifecycleMixin
from app.services.case_listing import CaseListingMixin
from app.services.host_bound import HostBound
from app.services.owner_contact import clean_owner_name
from app.services.ports import OwnerDelivery, OwnerDeliveryPort, PayoutPort
from app.services.repository import CaseRepository
from app.settings import Settings
from app.validation.report_validator import ReportValidator
from app.workers.analyze_gate import AnalyzeGate, build_analyze_gate
from app.workers.job_backend import JobBackend, ThreadJobBackend


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CaseService(CaseListingMixin, CaseLifecycleMixin, CaseEvidenceMixin):
    """Case records, assignment, and lifecycle.

    Analysis, reporting, and collaboration live on dedicated services.
    Methods here delegate so existing ``cases.*`` callers keep working.
    """

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
        feedback: FeedbackStore | None = None,
        max_concurrent_analyze: int = 8,
        analyze_gate_path: Path | None = None,
        notifications: object | None = None,
        user_settings: object | None = None,
        default_report_language: str = "tr",
        evidence_store: object | None = None,
        radiologist_payouts: PayoutPort | None = None,
        owner_delivery: OwnerDeliveryPort | None = None,
        analysis: object | None = None,
        reports: object | None = None,
        collaboration: object | None = None,
    ) -> None:
        self._repo = repo
        self._orchestrator = orchestrator
        self._validator = validator or orchestrator.validator
        self._async_delay_ms = max(0, async_delay_ms)
        self._lock = threading.Lock()
        self._jobs = job_backend or ThreadJobBackend(delay_ms=self._async_delay_ms)
        self._tenant_isolation = tenant_isolation
        self._audit_log = audit
        self._radiologist_payouts = radiologist_payouts
        self._patients = None  # issue #108, set by bind_patients
        self._feedback = feedback
        self._evidence_store = evidence_store
        self._notifications = notifications
        self._user_settings = user_settings
        lang = (default_report_language or "tr").strip().lower() or "tr"
        self._default_report_language = lang if lang in {"tr", "en"} else "tr"
        self._max_concurrent_analyze = max(1, max_concurrent_analyze)
        # Durable gate shared by sync + async (thread/RQ on same host).
        self._analyze_gate: AnalyzeGate = build_analyze_gate(
            max_concurrent=self._max_concurrent_analyze,
            path=analyze_gate_path,
        )
        self._mailer: object | None = None
        self._report_view_tokens: object | None = None
        self._auth_users: dict | None = None
        self._workflow_store: object | None = None
        self._smtp_configured = False
        self._public_base_url = "http://127.0.0.1:5173"
        self._owner_delivery: OwnerDeliveryPort | None = None
        if owner_delivery is not None:
            self.bind_owner_delivery(
                mailer=owner_delivery.mailer,
                report_view_tokens=owner_delivery.report_view_tokens,
                auth_users=owner_delivery.auth_users,
                workflow_store=owner_delivery.workflow_store,
                smtp_configured=bool(owner_delivery.smtp_configured),
                public_base_url=owner_delivery.public_base_url,
            )
        self._wire_contexts(analysis=analysis, reports=reports, collaboration=collaboration)

    def _wire_contexts(
        self,
        *,
        analysis: object | None,
        reports: object | None,
        collaboration: object | None,
    ) -> None:
        from app.services.analysis_application import AnalysisApplication
        from app.services.case_collaboration import CaseCollaborationService
        from app.services.report_application import ReportApplication

        self.analysis = analysis if analysis is not None else AnalysisApplication(self)
        self.reports = reports if reports is not None else ReportApplication(self)
        self.collaboration = (
            collaboration if collaboration is not None else CaseCollaborationService(self)
        )

    def bind_patients(self, service) -> None:
        """Issue #108: patient records (validate the patient chosen for a new case)."""
        self._patients = service

    def _attach_comparison(
        self, case: CaseRecord, draft: DraftReport, *, principal: AuthPrincipal | None = None
    ) -> None:
        """Issue #108: fill the "change since the prior study" section of a new AI draft.

        Cases without a patient record keep ``comparison=None`` (unchanged behaviour). A
        failure here never blocks the report; it only leaves the section out.
        """
        if self._patients is None or not case.patient_id:
            return
        try:
            prior = self._patients.prior_for_report(case)
            language = self._resolve_report_language(case, principal=principal)
            draft.comparison = build_comparison(case, draft, prior, language=language)
            draft.validation_warnings.extend(comparison_warnings(draft))
        except Exception:  # noqa: BLE001 — comparison is optional context, never fatal
            draft.comparison = None

    def bind_radiologist_payouts(self, service: PayoutPort | None) -> None:
        """Optional ledger for admin radiologist fee tracking (fixed per approved case)."""
        self._radiologist_payouts = service

    def bind_owner_delivery(
        self,
        *,
        mailer: object | None,
        report_view_tokens: object | None,
        auth_users: dict | None,
        workflow_store: object | None,
        smtp_configured: bool,
        public_base_url: str,
    ) -> None:
        """Wire SMTP + magic-link delivery for non-member pet owners."""
        self._owner_delivery = OwnerDelivery(
            mailer=mailer,
            report_view_tokens=report_view_tokens,
            auth_users=auth_users,
            workflow_store=workflow_store,
            smtp_configured=bool(smtp_configured),
            public_base_url=public_base_url,
        )
        self._mailer = mailer
        self._report_view_tokens = report_view_tokens
        self._auth_users = auth_users
        self._workflow_store = workflow_store
        self._smtp_configured = bool(smtp_configured)
        self._public_base_url = (public_base_url or "http://127.0.0.1:5173").rstrip("/")

    def _record_radiologist_payout(self, case: CaseRecord, reviewer_id: str) -> None:
        svc = self._radiologist_payouts
        if svc is None:
            return
        try:
            svc.record_approval(  # type: ignore[attr-defined]
                case_id=case.case_id,
                radiologist_subject=reviewer_id,
                approved_at=case.report_available_at or case.updated_at,
            )
        except Exception:
            # Payout ledger must not block clinical approval.
            pass

    def _resolve_report_language(
        self,
        case: CaseRecord,
        *,
        principal: AuthPrincipal | None = None,
    ) -> str:
        """Prefer actor / case owner UserSettings.language; else env default."""
        subjects: list[str] = []
        if principal is not None and principal.subject and principal.subject != "anonymous":
            subjects.append(principal.subject)
        if case.owner_subject:
            subjects.append(case.owner_subject)
        if self._user_settings is not None:
            for subject in subjects:
                try:
                    # Stored settings only: get() returns defaults ("tr") for users who never
                    # saved any, which hid both the env default and the case owner's choice.
                    lookup = getattr(self._user_settings, "get_stored", None)
                    settings = lookup(subject) if lookup else None
                    lang = getattr(settings, "language", None)
                    if lang in {"tr", "en"}:
                        return lang
                except Exception:  # noqa: BLE001 — settings must never block analysis
                    continue
        return self._default_report_language

    def _acquire_analyze_slot(self) -> None:
        return self.analysis._acquire_analyze_slot()

    def _release_analyze_slot(self) -> None:
        return self.analysis._release_analyze_slot()

    def _emit_feedback(self, case: CaseRecord, feedback: ReviewFeedback) -> None:
        """Append training-signal event (PHI-free). Separate from security audit."""
        if self._feedback is None or case.demo_seed:
            return
        findings = case.structured_findings
        model_ids: list[str] = []
        finding_ids: list[str] = []
        source_kind: str | None = None
        rag_ids: list[str] = []
        report_version: str | None = None
        if findings is not None:
            model_ids = list(findings.contributing_model_ids or [])
            finding_ids = [f.finding_id for f in findings.findings]
            source_kind = (
                findings.source_kind.value
                if hasattr(findings.source_kind, "value")
                else str(findings.source_kind)
            )
        draft = case.draft_report
        if draft is not None:
            report_version = f"v{draft.version}"
            for cite in draft.rag_citations or []:
                pid = getattr(cite, "source_id", None)
                if pid:
                    rag_ids.append(str(pid))
        decision = (
            feedback.action.value
            if hasattr(feedback.action, "value")
            else str(feedback.action)
        )
        self._feedback.record(
            case_id=case.case_id,
            decision=decision,
            actor=feedback.reviewer_id,
            clinic_id=case.clinic_id,
            report_version_id=report_version,
            reason_codes=feedback.reason_codes,
            free_text=feedback.comment,
            model_ids=model_ids,
            finding_ids=finding_ids,
            source_kind=source_kind,
            rag_passage_ids=rag_ids,
        )

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

    @staticmethod
    def _apply_owner_contact(case: CaseRecord, *, owner_name: str | None) -> CaseRecord:
        """Store the optional owner name. Owners get no account link and no email (B2B)."""
        name = clean_owner_name(owner_name)
        if name is not None:
            case.owner_contact_name = name
        return case

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
                f"Radyoloğa sorular:\n{structured.radiologist_questions}" if structured.radiologist_questions else None,
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
        self._apply_owner_contact(case, owner_name=payload.owner_name)
        if payload.patient_id and self._patients is not None:
            case.patient_id = self._patients.resolve_for_new_case(payload.patient_id, principal=principal).patient_id
        caps = self._orchestrator._router.list_capabilities()  # noqa: SLF001 — live caps for F4
        case.model_input = build_imaging_model_input(case, capabilities=caps)
        saved = self._repo.save_case(case)
        self._emit_audit("case.create", principal=principal, resource=saved.case_id)
        return saved

    def update_owner_contact(
        self,
        case_id: str,
        payload: CaseOwnerUpdate,
        *,
        principal: AuthPrincipal | None = None,
    ) -> CaseRecord:
        """Set or clear the optional owner name on an existing case (legacy rows included)."""
        if principal is not None and principal.role not in {
            "vet",
            "clinic_owner",
            "admin",
            "expert",
            "demo",
            "service",
        } and principal.via != "disabled":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
        case = self.get_case(case_id, principal=principal)
        case.owner_contact_name = clean_owner_name(payload.owner_name)
        case.updated_at = _now()
        append_activity(case, kind="owner_contact_updated", actor_subject=principal.subject if principal else "system")
        return self._repo.save_case(case)

    def prepare_model_input(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> ImagingModelInput:
        """Build/refresh the AI-facing ImagingModelInput package for a case."""
        from app.models.dicom_study_merge import merge_case_dicom_attachments

        case = self.get_case(case_id, principal=principal)
        # Phase 20: merge Phase 19 multi-ingest study metadata before packaging.
        case = merge_case_dicom_attachments(case, self._repo)
        caps = self._orchestrator._router.list_capabilities()  # noqa: SLF001
        case.model_input = build_imaging_model_input(case, capabilities=caps)
        case.updated_at = _now()
        self._repo.save_case(case)
        return case.model_input

    def list_messages(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[CaseMessageView]:
        return self.collaboration.list_messages(case_id, principal=principal)

    def post_message(
        self,
        case_id: str,
        payload: CaseMessageCreate,
        *,
        principal: AuthPrincipal | None = None,
    ) -> CaseMessageView:
        return self.collaboration.post_message(case_id, payload, principal=principal)

    def mark_messages_read(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[CaseMessageView]:
        return self.collaboration.mark_messages_read(case_id, principal=principal)

    def list_ai_chat(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[AiChatTurn]:
        return self.collaboration.list_ai_chat(case_id, principal=principal)

    def ask_ai_chat(
        self,
        case_id: str,
        payload: AiChatAsk,
        *,
        settings: Settings,
        principal: AuthPrincipal | None = None,
    ) -> AiChatResponse:
        return self.collaboration.ask_ai_chat(case_id, payload, settings=settings, principal=principal)

    def clear_ai_chat(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[AiChatTurn]:
        return self.collaboration.clear_ai_chat(case_id, principal=principal)

    def mark_report_delivered(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> CaseRecord:
        return self.reports.mark_report_delivered(case_id, principal=principal)

    def mark_report_viewed(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> CaseRecord:
        return self.reports.mark_report_viewed(case_id, principal=principal)

    def init_manual_report(
        self,
        case_id: str,
        *,
        principal: AuthPrincipal | None = None,
        editor_id: str | None = None,
    ) -> DraftReport:
        return self.reports.init_manual_report(case_id, principal=principal, editor_id=editor_id)

    def save_draft_report(
        self,
        case_id: str,
        payload: ReportDraftUpdate,
        *,
        principal: AuthPrincipal | None = None,
    ) -> DraftReport:
        return self.reports.save_draft_report(case_id, payload, principal=principal)

    def _assert_analyzable(self, case: CaseRecord) -> None:
        return self.analysis._assert_analyzable(case)

    def analyze(self, case_id: str, *, principal: AuthPrincipal | None = None) -> PipelineResult:
        return self.analysis.analyze(case_id, principal=principal)

    def _persist_job_progress(self, job: AnalysisJob) -> None:
        return self.analysis._persist_job_progress(job)

    def _job_cancel_requested(self, job_id: str) -> bool:
        return self.analysis._job_cancel_requested(job_id)

    def _persist_pipeline_result(
        self, case_id: str, working: CaseRecord, result: PipelineResult
    ) -> PipelineResult:
        return self.analysis._persist_pipeline_result(case_id, working, result)

    def run_queued_analyze(self, case_id: str, job_id: str, *, hold_slot: bool = False) -> None:
        return self.analysis.run_queued_analyze(case_id, job_id, hold_slot=hold_slot)

    def enqueue_analyze(
        self,
        case_id: str,
        *,
        idempotency_key: str | None = None,
        principal: AuthPrincipal | None = None,
    ) -> AnalysisJob:
        return self.analysis.enqueue_analyze(case_id, idempotency_key=idempotency_key, principal=principal)

    def request_cancel_job(
        self, job_id: str, *, principal: AuthPrincipal | None = None
    ) -> AnalysisJob:
        return self.analysis.request_cancel_job(job_id, principal=principal)

    def get_job(self, job_id: str, *, principal: AuthPrincipal | None = None) -> AnalysisJob:
        return self.analysis.get_job(job_id, principal=principal)

    def get_findings(self, case_id: str, *, principal: AuthPrincipal | None = None) -> StructuredFindings:
        return self.analysis.get_findings(case_id, principal=principal)

    def get_report(
        self, case_id: str, *, version: int | None = None, principal: AuthPrincipal | None = None
    ) -> DraftReport:
        return self.reports.get_report(case_id, version=version, principal=principal)

    def list_report_versions(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[ReportVersionSummary]:
        return self.reports.list_report_versions(case_id, principal=principal)

    def get_report_version(
        self, case_id: str, version: int, *, principal: AuthPrincipal | None = None
    ) -> ReportVersionSnapshot:
        return self.reports.get_report_version(case_id, version, principal=principal)

    def submit_review(
        self,
        case_id: str,
        feedback: ReviewFeedback,
        *,
        principal: AuthPrincipal | None = None,
    ) -> CaseRecord:
        return self.reports.submit_review(case_id, feedback, principal=principal)

    REGENERATABLE_STATUSES = {CaseLifecycleStatus.AWAITING_REVIEW, CaseLifecycleStatus.REVISION_REQUESTED}

    def regenerate_report(
        self,
        case_id: str,
        expert_note: str,
        reviewer_id: str,
        *,
        principal: AuthPrincipal | None = None,
    ) -> CaseRecord:
        return self.reports.regenerate_report(case_id, expert_note, reviewer_id, principal=principal)

    def _approve_ai_draft(self, case: CaseRecord, feedback: ReviewFeedback) -> CaseRecord:
        return self.reports._approve_ai_draft(case, feedback)

    def _deliver_owner_report_email(self, case: CaseRecord, *, report_version: int) -> None:
        return self.reports._deliver_owner_report_email(case, report_version=report_version)

    def revoke_report_view_links(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> CaseRecord:
        return self.reports.revoke_report_view_links(case_id, principal=principal)

    def _notify(self, **kwargs) -> None:
        nsvc = self._notifications
        if nsvc is None:
            return
        nsvc.notify(**kwargs)  # type: ignore[union-attr]

    def list_activity(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[CaseActivityEvent]:
        return self.reports.list_activity(case_id, principal=principal)

    def append_clinical_note(
        self, case_id: str, payload: CaseNoteCreate, *, principal: AuthPrincipal
    ) -> CaseRecord:
        return self.collaboration.append_clinical_note(case_id, payload, principal=principal)

    def append_internal_note(
        self, case_id: str, payload: CaseNoteCreate, *, principal: AuthPrincipal
    ) -> CaseRecord:
        return self.collaboration.append_internal_note(case_id, payload, principal=principal)

    def create_info_request(
        self, case_id: str, payload: InfoRequestCreate, *, principal: AuthPrincipal
    ) -> CaseRecord:
        return self.collaboration.create_info_request(case_id, payload, principal=principal)

    def reply_info_request(
        self,
        case_id: str,
        request_id: str,
        payload: InfoRequestReply,
        *,
        principal: AuthPrincipal,
    ) -> CaseRecord:
        return self.collaboration.reply_info_request(case_id, request_id, payload, principal=principal)

    def close_info_request(
        self, case_id: str, request_id: str, *, principal: AuthPrincipal
    ) -> CaseRecord:
        return self.collaboration.close_info_request(case_id, request_id, principal=principal)

    def attach_document_ingest(
        self,
        case_id: str,
        payload: CaseDocumentAttach,
        *,
        principal: AuthPrincipal,
        documents_svc: object | None = None,
    ) -> CaseRecord:
        return self.collaboration.attach_document_ingest(case_id, payload, principal=principal, documents_svc=documents_svc)

    @staticmethod
    def _apply_edits(report: DraftReport, feedback: ReviewFeedback) -> None:
        from app.services.report_application import ReportApplication
        return ReportApplication._apply_edits(report, feedback)

    def __getattr__(self, name: str) -> object:
        """Forward helpers that live only on a bounded-context service."""
        if name.startswith("__"):
            raise AttributeError(name)
        for key in ("analysis", "reports", "collaboration"):
            svc = self.__dict__.get(key)
            if svc is None:
                continue
            for cls in type(svc).__mro__:
                if cls is HostBound or cls is object:
                    continue
                if name in cls.__dict__:
                    return getattr(svc, name)
        raise AttributeError(f"{type(self).__name__}.{name}")
