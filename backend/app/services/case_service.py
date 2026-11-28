from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.auth.rbac import CAP_CASE_WRITE
from app.auth.tenancy import assert_case_access, can_access_owned
from app.feedback.store import FeedbackStore
from app.http_errors import api_error
from app.llm.comparison import build_comparison, comparison_warnings
from app.models.model_input_builder import build_imaging_model_input
from app.orchestration.orchestrator import AIOrchestrator
from app.review_sla import (
    OPEN_REVIEW_STATUSES,
    WARN_WITHIN_HOURS,
    apply_review_sla,
    clear_review_sla,
    remaining_seconds,
    sla_hours_for,
)
from app.schemas.case import (
    AiChatAsk,
    AiChatResponse,
    AiChatTurn,
    CaseActivityEvent,
    CaseAssignmentUpdate,
    CaseCreate,
    CaseMessageCreate,
    CaseMessageView,
    CaseOwnerUpdate,
    CaseRecord,
    CaseSummary,
    ClinicDashboardStats,
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
from app.services.case_ids import canonicalize_case_id
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


class CaseService:
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

    def _unread_for(self, case: CaseRecord, principal: AuthPrincipal | None) -> int:
        if principal is None or principal.via == "disabled":
            return 0
        subject = principal.subject
        return sum(1 for m in case.messages if subject not in m.read_by and m.author_id != subject)

    def _reviewer_name(self, subject: str | None, cache: dict[str, str | None] | None = None) -> str | None:
        """Display name of the assigned expert (#77); cached per listing call."""
        if not subject:
            return None
        if cache is not None and subject in cache:
            return cache[subject]
        name = self._note_author_name(subject)
        if cache is not None:
            cache[subject] = name
        return name

    def _to_summary(
        self,
        c: CaseRecord,
        *,
        principal: AuthPrincipal | None = None,
        name_cache: dict[str, str | None] | None = None,
    ) -> CaseSummary:
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
            assigned_reviewer_name=self._reviewer_name(c.assigned_reviewer_id, name_cache),
            awaiting_review_since=getattr(c, "awaiting_review_since", None),
            review_due_at=getattr(c, "review_due_at", None),
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
            complaint=c.clinical_history_structured.complaint if c.clinical_history_structured else None,
            unread_messages=self._unread_for(c, principal),
            report_available_at=getattr(c, "report_available_at", None),
            report_delivered_at=getattr(c, "report_delivered_at", None),
            report_viewed_at=getattr(c, "report_viewed_at", None),
            pet_id=getattr(c, "pet_id", None),
            patient_id=c.patient_id,
            pet_owner_subject=getattr(c, "pet_owner_subject", None),
            owner_contact_name=getattr(c, "owner_contact_name", None),
            owner_contact_email=getattr(c, "owner_contact_email", None),
            owner_email_consent=bool(getattr(c, "owner_email_consent", False)),
            owner_email_delivery_status=getattr(c, "owner_email_delivery_status", None),
            vet_email_delivery_status=getattr(c, "vet_email_delivery_status", None),
            submission_id=getattr(c, "submission_id", None),
            vet_verified=bool(getattr(c, "vet_verified", True)),
            current_report_version=getattr(c, "current_report_version", None)
            or (c.draft_report.version if c.draft_report is not None else None),
            report_version_count=len(getattr(c, "report_versions", None) or [])
            or (1 if c.draft_report is not None else 0),
        )

    def list_cases(self, *, principal: AuthPrincipal | None = None) -> list[CaseSummary]:
        summaries: list[CaseSummary] = []
        names: dict[str, str | None] = {}
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
            if principal is not None and principal.subject.strip().lower() in c.hidden_for:
                continue
            summaries.append(self._to_summary(c, principal=principal, name_cache=names))
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
        self.backfill_and_emit_sla_warnings()
        rows = self.list_cases(principal=principal)
        status_l = (status or "").strip().lower()
        modality_l = (modality or "").strip().upper()
        priority_l = (priority or "").strip().lower()
        assigned = (assigned_to or "").strip()
        query = (q or "").strip().lower()

        def _match(s: CaseSummary) -> bool:
            if status_l and s.status.value != status_l:
                return False
            # Cancelled drafts never belong on a worklist unless asked for explicitly.
            if not status_l and s.status == CaseLifecycleStatus.CANCELLED:
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

    def update_assignment(
        self,
        case_id: str,
        payload: CaseAssignmentUpdate,
        *,
        principal: AuthPrincipal | None = None,
    ) -> CaseRecord:
        case = self.get_case(case_id, principal=principal)
        prev_assignee = case.assigned_reviewer_id
        prev_priority = case.priority
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
        if case.status in OPEN_REVIEW_STATUSES or prev_priority != case.priority:
            apply_review_sla(case)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        self._emit_audit("case.assign", principal=principal, resource=case_id)
        if saved.assigned_reviewer_id and saved.assigned_reviewer_id != prev_assignee:
            urgent = saved.priority in {"urgent", "stat"}
            hours = sla_hours_for(saved.priority)
            due_hint = (
                f" · yanıt süresi {hours} saat"
                if saved.review_due_at
                else ""
            )
            self._notify(
                recipient_subject=saved.assigned_reviewer_id,
                kind="urgent_assignment" if urgent else "radiologist_assigned",
                title="STAT atama" if saved.priority == "stat" else ("Acil atama" if urgent else "Radyolog ataması"),
                body=f"{saved.patient_name} · {saved.case_id}{due_hint}",
                link_path=f"/vakalar/{saved.case_id}/calisma",
                dedupe_key=f"radiologist_assigned:{saved.case_id}:{saved.assigned_reviewer_id}",
                case_id=saved.case_id,
                clinic_id=saved.clinic_id,
            )
        return saved

    def backfill_and_emit_sla_warnings(self) -> int:
        """Backfill missing review_due_at and notify assignees when time is low/overdue."""
        emitted = 0
        now = _now()
        for case in self._repo.list_cases():
            if case.status not in OPEN_REVIEW_STATUSES:
                if clear_review_sla(case):
                    case.updated_at = now
                    self._repo.save_case(case)
                continue

            if apply_review_sla(case):
                case.updated_at = now
                self._repo.save_case(case)

            rem = remaining_seconds(case, now=now)
            if rem is None:
                continue
            recipient = case.assigned_reviewer_id
            if not recipient:
                continue
            hours = sla_hours_for(case.priority)
            link = f"/vakalar/{case.case_id}/calisma"
            if rem <= 0:
                overdue_h = max(1, int(abs(rem) // 3600))
                self._notify(
                    recipient_subject=recipient,
                    kind="sla_overdue",
                    title="Yanıt süresi doldu",
                    body=(
                        f"{case.patient_name}: {hours} saatlik uzman yanıt süresi aşıldı "
                        f"(~{overdue_h} sa gecikme). Acil yanıt bekleniyor."
                    ),
                    link_path=link,
                    dedupe_key=f"sla_overdue:{case.case_id}",
                    case_id=case.case_id,
                    clinic_id=case.clinic_id,
                )
                emitted += 1
            elif rem <= WARN_WITHIN_HOURS * 3600:
                left_h = max(1, int(rem // 3600))
                left_m = max(1, int(rem // 60))
                left_label = f"{left_h} saat" if rem >= 3600 else f"{left_m} dk"
                self._notify(
                    recipient_subject=recipient,
                    kind="sla_warning",
                    title="Yanıt süresi azalıyor",
                    body=(
                        f"{case.patient_name}: uzman yanıtına {left_label} kaldı "
                        f"({hours}s SLA · {case.priority})."
                    ),
                    link_path=link,
                    dedupe_key=f"sla_warning:{case.case_id}:{case.review_due_at.isoformat() if case.review_due_at else 'x'}",
                    case_id=case.case_id,
                    clinic_id=case.clinic_id,
                )
                emitted += 1
        return emitted

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

    def get_case(self, case_id: str, *, principal: AuthPrincipal | None = None) -> CaseRecord:
        case_id = canonicalize_case_id(case_id)
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
            # Radiologist-only fields are filtered on the response (app.auth.visibility),
            # never here: services save what get_case returns.
        return case

    # Drafts that have not reached a radiologist yet (#78).
    CANCELLABLE_STATUSES = frozenset(
        {
            CaseLifecycleStatus.CREATED,
            CaseLifecycleStatus.AWAITING_CLASSIFICATION_CONFIRMATION,
            CaseLifecycleStatus.FAILED,
        }
    )

    def _load_for_change(self, case_id: str, principal: AuthPrincipal) -> CaseRecord:
        case_id = canonicalize_case_id(case_id)
        case = self._repo.get_case(case_id)
        if case is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")
        assert_case_access(principal, case, isolation=self._tenant_isolation)
        return case

    @classmethod
    def is_cancellable(cls, case: CaseRecord) -> bool:
        if case.status not in cls.CANCELLABLE_STATUSES:
            return False
        # A failed case a radiologist already picked up is in their hands.
        return not case.assigned_reviewer_id and case.draft_report is None

    def cancel_case(self, case_id: str, reason: str, *, principal: AuthPrincipal) -> CaseRecord:
        """Mark a draft case as cancelled (kept, audited). Sent-to-radiologist cases are refused."""
        case = self._load_for_change(case_id, principal)
        if not (principal.can(CAP_CASE_WRITE) or principal.role == "admin"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=api_error("case_cancel_forbidden", "Only the clinic can cancel a case."),
            )
        if case.status == CaseLifecycleStatus.CANCELLED:
            return case
        if not self.is_cancellable(case):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=api_error(
                    "case_not_cancellable",
                    "Only draft cases that have not been sent to a radiologist can be cancelled.",
                ),
            )
        clean = " ".join(reason.split())
        with self._lock:
            latest = self._repo.get_case(case.case_id) or case
            latest.status = CaseLifecycleStatus.CANCELLED
            latest.cancelled_at = _now()
            latest.cancelled_by = principal.subject
            latest.cancel_reason = clean
            latest.updated_at = latest.cancelled_at
            append_activity(latest, kind="case_cancelled", actor_subject=principal.subject, detail=clean)
            saved = self._repo.save_case(latest)
        self._emit_audit("case.cancel", principal=principal, resource=saved.case_id, detail=clean)
        return saved

    def hide_case(self, case_id: str, *, principal: AuthPrincipal) -> None:
        """"Listemden gizle": remove the case from this user's own lists; the record is kept."""
        case = self._load_for_change(case_id, principal)
        subject = principal.subject.strip().lower()
        with self._lock:
            latest = self._repo.get_case(case.case_id) or case
            if subject not in latest.hidden_for:
                latest.hidden_for = [*latest.hidden_for, subject]
                latest.updated_at = _now()
                self._repo.save_case(latest)
        self._emit_audit("case.hide", principal=principal, resource=case.case_id)

    def delete_case(self, case_id: str, *, principal: AuthPrincipal, reason: str | None = None) -> None:
        """Permanent delete — administrators only, with a reason (e.g. a KVKK erasure request)."""
        case = self._load_for_change(case_id, principal)
        if principal.role not in {"admin", "service"}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=api_error(
                    "case_delete_admin_only",
                    "Only an administrator can permanently delete a case. Cancel the draft instead.",
                ),
            )
        clean = " ".join((reason or "").split())
        if len(clean) < 3:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=api_error("case_delete_reason_required", "A reason is required for permanent deletion."),
            )
        case_id = case.case_id
        self._repo.delete_case(case_id)
        store = self._evidence_store
        if store is not None and hasattr(store, "delete_case_artifacts"):
            try:
                store.delete_case_artifacts(case_id)  # type: ignore[union-attr]
            except Exception:  # noqa: BLE001 — leftover files must not block the delete
                pass
        self._emit_audit("case.delete", principal=principal, resource=case_id, detail=clean)

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

    def review_case_evidence(
        self,
        case_id: str,
        evidence_id: str,
        *,
        action: str,
        principal: AuthPrincipal,
        include_in_report: bool | None = None,
        vet_note: str | None = None,
        bbox: object | None = None,
    ) -> StructuredFindings:
        from app.auth.rbac import CAP_TRAINING_VERIFY
        from app.schemas.findings import BoundingBoxEvidence
        from app.services.evidence_review import review_evidence

        if action in {"verify", "unverify"} and principal.via != "disabled":
            if not principal.can(CAP_TRAINING_VERIFY):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Expert verification requires training:verify capability.",
                )

        with self._lock:
            case = self.get_case(case_id, principal=principal)
            self._assert_evidence_editable(case)
            sf = review_evidence(
                case,
                evidence_id,
                action=action,  # type: ignore[arg-type]
                reviewer_id=principal.subject,
                include_in_report=include_in_report,
                vet_note=vet_note,
                bbox=bbox if isinstance(bbox, BoundingBoxEvidence) else None,
            )
            sf = self._render_missing_overlays(case, sf)
            append_activity(
                case,
                kind=f"evidence_{action}",
                actor_subject=principal.subject,
                detail=evidence_id,
            )
            case.updated_at = _now()
            self._repo.save_case(case)
        self._emit_audit(f"evidence.review.{action}", principal=principal, resource=f"{case_id}/{evidence_id}")
        return sf

    def add_case_manual_evidence(
        self,
        case_id: str,
        *,
        finding_id: str,
        principal: AuthPrincipal,
        bbox: object,
        sop_instance_uid: str | None = None,
        frame_index: int | None = None,
        description: str = "Radiologist manual mark",
        include_in_report: bool = True,
    ) -> StructuredFindings:
        from app.schemas.findings import BoundingBoxEvidence
        from app.services.evidence_review import add_manual_evidence

        if not isinstance(bbox, BoundingBoxEvidence):
            raise HTTPException(status_code=400, detail="bbox required")
        with self._lock:
            case = self.get_case(case_id, principal=principal)
            self._assert_evidence_editable(case)
            sf = add_manual_evidence(
                case,
                finding_id=finding_id,
                reviewer_id=principal.subject,
                bbox=bbox,
                sop_instance_uid=sop_instance_uid,
                frame_index=frame_index,
                description=description,
                include_in_report=include_in_report,
            )
            sf = self._render_missing_overlays(case, sf)
            append_activity(
                case,
                kind="evidence_manual_add",
                actor_subject=principal.subject,
                detail=finding_id,
            )
            case.updated_at = _now()
            self._repo.save_case(case)
        self._emit_audit("evidence.manual_add", principal=principal, resource=f"{case_id}/{finding_id}")
        return sf

    def _render_missing_overlays(self, case: CaseRecord, sf: StructuredFindings) -> StructuredFindings:
        """Edited / manual marks need an overlay image, or the approved PDF silently drops them."""
        from app.models.evidence_attach import attach_rendered_evidence
        from app.models.evidence_store import EvidenceArtifactStore

        if not isinstance(self._evidence_store, EvidenceArtifactStore):
            return sf
        try:
            rendered = attach_rendered_evidence(case, sf, store=self._evidence_store)
        except Exception as exc:  # noqa: BLE001 — rendering must not block the review action
            sf.warnings.append(f"Evidence overlay render skipped: {type(exc).__name__}.")
            return sf
        case.structured_findings = rendered
        return rendered

    def append_report_figures(
        self,
        case_id: str,
        evidence_ids: list[str],
        *,
        principal: AuthPrincipal,
    ) -> CaseRecord:
        return self.reports.append_report_figures(case_id, evidence_ids, principal=principal)

    @staticmethod
    def _assert_evidence_editable(case: CaseRecord) -> None:
        """Approved reports are frozen with their evidence; changing it needs a revision first."""
        draft = case.draft_report
        if case.status == CaseLifecycleStatus.APPROVED or (draft is not None and draft.immutable):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Evidence of an approved report cannot change; request a revision first.",
            )

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
