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


class ReportApplication(HostBound):
    """Draft, review, delivery, figures, activity, and report regeneration."""

    REGENERATABLE_STATUSES = {
        CaseLifecycleStatus.AWAITING_REVIEW,
        CaseLifecycleStatus.REVISION_REQUESTED,
    }

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

    def init_manual_report(
        self,
        case_id: str,
        *,
        principal: AuthPrincipal | None = None,
        editor_id: str | None = None,
    ) -> DraftReport:
        """Bootstrap a blank radiologist draft for failed/unsupported cases (no AI draft).

        Moves the case to awaiting_review so normal save/approve apply. Provenance is
        ``source_kind=manual`` — never claim mock/real model output.
        """
        case = self.get_case(case_id, principal=principal)
        if case.draft_report is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Case already has a draft report; edit it instead of re-initializing.",
            )
        if case.status not in {
            CaseLifecycleStatus.MANUAL_REVIEW,
            CaseLifecycleStatus.FAILED,
        }:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Manual report init is only for failed or unsupported (manual_review) cases "
                    f"(current status={case.status.value})."
                ),
            )
        author = editor_id or (principal.subject if principal else "manual-radiologist")
        if principal is not None:
            author = bind_reviewer_id(principal, author)
        now = _now()
        placeholder = (
            "[Manuel taslak — radyolog doldurur. AI çıktısı değildir; klinik sertifikasyon iddiası yoktur.]"
        )
        report = DraftReport(
            report_id=f"rpt-manual-{uuid4().hex[:12]}",
            case_id=case.case_id,
            status=ReportStatus.DRAFT,
            generation=GenerationMetadata(
                provider_id="manual-radiologist",
                model_id="manual",
                model_version="1.0.0",
                source_kind=SourceKind.MANUAL,
                generated_at=now,
                synthetic=True,
                clinically_validated=False,
            ),
            technique=ReportSection(text=placeholder),
            findings=ReportSection(text=placeholder),
            impression=ReportSection(text=placeholder),
            recommendations=ReportSection(text=placeholder),
            validation_warnings=[
                "Manuel radyolog taslağı — AI draft değildir.",
                "Yapısal doğrulama klinik doğruluğu kanıtlamaz.",
            ],
            expert_review_status=ExpertReviewStatus.PENDING,
            synthetic=True,
            clinically_validated=False,
            rag_note=(
                "Bu taslak manuel başlatıldı; RAG alıntısı yoktur. "
                "Onay, AI model doğrulaması anlamına gelmez."
            ),
            ai_sections={},
            version=1,
            created_at=now,
            updated_at=now,
            revision_notes="manual-init",
        )
        case.draft_report = report
        case.status = CaseLifecycleStatus.AWAITING_REVIEW
        apply_review_sla(case)
        upsert_version_snapshot(
            case,
            snapshot_from_draft(
                case,
                report,
                author_or_source=author,
                revision_notes="manual-init",
                immutable=False,
            ),
        )
        append_activity(
            case,
            kind="manual_report_init",
            actor_subject=author,
            detail="Manuel taslak başlatıldı (AI draft yok)",
        )
        case.updated_at = now
        self._repo.save_case(case)
        self._emit_audit("report.manual_init", principal=principal, resource=case_id)
        return report

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
                detail=api_error("no_draft", "No draft report to save."),
            )
        report = case.draft_report.model_copy(deep=True)
        try:
            assert_mutable_for_edit(report)
        except (PermissionError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=api_error("report_immutable", str(exc)),
            ) from exc
        if report.status == ReportStatus.APPROVED or report.immutable:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=api_error(
                    "report_immutable",
                    "Approved reports are immutable and cannot be edited in place.",
                ),
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

    def append_report_figures(
        self,
        case_id: str,
        evidence_ids: list[str],
        *,
        principal: AuthPrincipal,
    ) -> CaseRecord:
        """Add selected evidence overlays to an approved report package (figures only).

        Does not rewrite report text. Marks evidence accepted + include_in_report, renders
        overlays when missing, then copies into the immutable report package.
        """
        from app.models.evidence_store import EvidenceArtifactStore
        from app.services.report_evidence_snapshot import append_evidence_figures

        ids = [str(x).strip() for x in evidence_ids if str(x).strip()]
        if not ids:
            raise HTTPException(status_code=400, detail="evidence_ids required")
        if not isinstance(self._evidence_store, EvidenceArtifactStore):
            raise HTTPException(status_code=503, detail="Evidence store unavailable.")

        with self._lock:
            case = self.get_case(case_id, principal=principal)
            draft = case.draft_report
            if (
                case.status != CaseLifecycleStatus.APPROVED
                or draft is None
                or not draft.immutable
                or draft.status != ReportStatus.APPROVED
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Figures can only be appended to an approved immutable report.",
                )
            sf = case.structured_findings
            if sf is None:
                raise HTTPException(status_code=404, detail="No findings on case.")

            by_id = {
                ev.evidence_id: ev
                for finding in sf.findings
                for ev in finding.evidence_references
            }
            missing = [eid for eid in ids if eid not in by_id]
            if missing:
                raise HTTPException(
                    status_code=404,
                    detail=f"Unknown evidence_id(s): {', '.join(missing[:5])}",
                )
            for eid in ids:
                ev = by_id[eid]
                ev.review_status = "accepted"
                ev.include_in_report = True
                if ev.reviewed_by is None:
                    ev.reviewed_by = principal.subject

            sf = self._render_missing_overlays(case, sf)
            before = {f.evidence_id for f in (draft.evidence_figures or [])}
            draft = append_evidence_figures(
                case,
                draft.model_copy(deep=True),
                store=self._evidence_store,
                evidence_ids=ids,
                findings=sf,
            )
            case.draft_report = draft
            # Additive patch on immutable snapshot figures only (text stays frozen).
            now = _now()
            for idx, existing in enumerate(case.report_versions):
                if existing.version != int(draft.version):
                    continue
                content = existing.content.model_copy(deep=True)
                content.evidence_figures = list(draft.evidence_figures)
                case.report_versions[idx] = existing.model_copy(
                    update={"content": content, "updated_at": now}
                )
                break
            added = len({f.evidence_id for f in (draft.evidence_figures or [])} - before)
            append_activity(
                case,
                kind="report_figures_appended",
                actor_subject=principal.subject,
                detail=f"v{draft.version} +{added}",
            )
            case.updated_at = now
            saved = self._repo.save_case(case)
        self._emit_audit("report.figures.append", principal=principal, resource=case_id)
        return saved

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
                self._emit_feedback(result, feedback)
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
            clear_review_sla(case)

            case.review_history.append(feedback)
            case.updated_at = _now()
            saved = self._repo.save_case(case)
            self._emit_feedback(saved, feedback)
            event = "review.reject" if feedback.action == ReviewAction.REJECT else "review.revision"
            self._emit_audit(event, principal=principal, resource=case_id)
            if feedback.action == ReviewAction.REQUEST_REVISION:
                # Revision is radiologist <-> referring vet workflow; pet owners only see approved
                # reports (owner-submitted cases have owner_subject == pet_owner_subject).
                for recipient in {saved.owner_subject, "vet@demo.local"}:
                    if not recipient or recipient == feedback.reviewer_id or recipient == saved.pet_owner_subject:
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

    def regenerate_report(
        self,
        case_id: str,
        expert_note: str,
        reviewer_id: str,
        *,
        principal: AuthPrincipal | None = None,
    ) -> CaseRecord:
        """Rewrite the AI draft with the expert's revision request (LLM only, imaging not re-run).

        The new draft becomes a new report version awaiting review; the reviewed version stays
        in history. On provider failure the current draft is left untouched.
        """
        with self._lock:
            case = self.get_case(case_id, principal=principal)
            if principal is not None:
                reviewer_id = bind_reviewer_id(principal, reviewer_id)
            if case.status not in self.REGENERATABLE_STATUSES or case.draft_report is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="AI rewrite needs a draft awaiting review or with a revision request.",
                )
            if case.structured_findings is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="Case has no imaging findings to rewrite from."
                )
            base_version = case.draft_report.version
            working = case.model_copy(deep=True)

        try:
            report_language = self._resolve_report_language(working, principal=principal)
            report = self._orchestrator.regenerate_report(
                working, expert_note, report_language=report_language
            )
        except LLMProviderError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"LLM rewrite failed ({exc.kind.value}); the current draft is unchanged.",
            ) from exc

        with self._lock:
            latest = self.get_case(case_id, principal=principal)
            if (
                latest.status not in self.REGENERATABLE_STATUSES
                or latest.draft_report is None
                or latest.draft_report.version != base_version
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="The draft changed while the rewrite was running; reload and try again.",
                )
            attach_pipeline_draft(latest, report, notes=f"Uzman revizyon talebiyle yeniden üretildi: {expert_note}")
            latest.status = CaseLifecycleStatus.AWAITING_REVIEW
            apply_review_sla(latest)
            append_activity(latest, kind="ai_regenerated", actor_subject=reviewer_id, detail=expert_note)
            latest.updated_at = _now()
            saved = self._repo.save_case(latest)
        self._emit_audit("report.regenerate", principal=principal, resource=case_id)
        return saved

    def _approve_ai_draft(self, case: CaseRecord, feedback: ReviewFeedback) -> CaseRecord:
        if case.status == CaseLifecycleStatus.FAILED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Cannot approve: analysis failed and produced no AI draft. "
                    "Use POST .../report/manual-init then edit and approve the manual draft."
                ),
            )
        if case.status == CaseLifecycleStatus.MANUAL_REVIEW:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Cannot approve an AI draft for an unsupported case. "
                    "Use POST .../report/manual-init for a radiologist-authored draft, then approve."
                ),
            )
        if case.draft_report is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Cannot approve: there is no draft report. "
                    "For failed/unsupported cases call POST .../report/manual-init first."
                ),
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

        if self._evidence_store is not None:
            try:
                from app.models.evidence_store import EvidenceArtifactStore
                from app.services.report_evidence_snapshot import freeze_evidence_into_report

                if isinstance(self._evidence_store, EvidenceArtifactStore):
                    freeze_evidence_into_report(
                        case,
                        report,
                        store=self._evidence_store,
                        findings=case.structured_findings,
                    )
            except Exception:
                # Approval must not fail solely on evidence copy; PDF may omit figures.
                report.validation_warnings = list(report.validation_warnings) + [
                    "Evidence snapshot incomplete; PDF may omit AI evidence figures."
                ]
        freeze_approved(
            case,
            report,
            reviewer_id=feedback.reviewer_id,
            notes=feedback.comment,
        )
        case.status = CaseLifecycleStatus.APPROVED
        # Keep assignee in sync so post-approve vet→expert questions notify the reviewer.
        if not case.assigned_reviewer_id and feedback.reviewer_id:
            case.assigned_reviewer_id = feedback.reviewer_id
        clear_review_sla(case)
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
        self._deliver_owner_report_email(case, report_version=report.version)
        saved = self._repo.save_case(case)
        self._record_radiologist_payout(saved, feedback.reviewer_id)
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
        # Surface SMTP failure to the referring vet (never silent).
        if saved.owner_email_delivery_status == "failed_smtp" and saved.owner_subject:
            self._notify(
                recipient_subject=saved.owner_subject,
                kind="owner_email_failed",
                title="Sahibe e-posta gönderilemedi",
                body=saved.owner_email_delivery_detail
                or "SMTP yapılandırılmamış veya gönderim başarısız. Raporu kendiniz iletin.",
                link_path=f"/raporlar/{saved.case_id}",
                dedupe_key=f"owner_email_failed:{saved.case_id}:v{report.version}",
                case_id=saved.case_id,
                clinic_id=saved.clinic_id,
            )
        return saved

    def _deliver_owner_report_email(self, case: CaseRecord, *, report_version: int) -> None:
        """Email non-member owners a single-use report link when KVKK consent is set."""
        email = (case.owner_contact_email or "").strip().lower()
        if case.pet_owner_subject:
            # Linked account gets in-app notification; skip outbound email by default.
            case.owner_email_delivery_status = "skipped_linked"
            case.owner_email_delivery_detail = "Owner has an account; in-app notification used."
            return
        if not email:
            case.owner_email_delivery_status = "skipped_no_email"
            case.owner_email_delivery_detail = "No owner email on case."
            return
        if not case.owner_email_consent:
            case.owner_email_delivery_status = "skipped_no_consent"
            case.owner_email_delivery_detail = "Owner email consent (KVKK) was not recorded."
            return
        if self._mailer is None or self._report_view_tokens is None:
            case.owner_email_delivery_status = "failed_smtp"
            case.owner_email_delivery_detail = "Mailer or report-view tokens are not configured."
            return
        if not self._smtp_configured:
            case.owner_email_delivery_status = "failed_smtp"
            case.owner_email_delivery_detail = (
                "SMTP is not configured (VETMIND_SMTP_HOST). Report email was not sent."
            )
            return
        try:
            raw = self._report_view_tokens.issue(  # type: ignore[attr-defined]
                case_id=case.case_id,
                report_version=report_version,
            )
            minutes = max(1, int(getattr(self._report_view_tokens, "ttl_seconds", 72 * 3600)) // 60)
            link = f"{self._public_base_url}/rapor-baglanti?token={raw}"
            name = case.owner_contact_name or "Sayın sahip"
            body = (
                f"Merhaba {name},\n\n"
                f"{case.patient_name} için veteriner radyoloji raporu hazır.\n\n"
                f"Raporu görüntülemek için bu bağlantıyı {minutes} dakika içinde açın "
                f"(tek kullanımlık):\n{link}\n\n"
                "Bağlantıda sağlık verisi eki yoktur; yalnızca güvenli görüntüleme sunulur.\n"
                "İsterseniz VetMind'e üye olarak raporlarınıza hesabınızdan ulaşabilirsiniz.\n\n"
                f"Hello {name},\n"
                f"The radiology report for {case.patient_name} is ready. "
                f"Open the single-use link above within {minutes} minutes.\n"
            )
            self._mailer.send(  # type: ignore[attr-defined]
                OutgoingMail(
                    to=email,
                    subject=f"VetMind rapor hazır · {case.patient_name}",
                    body=body,
                )
            )
            case.owner_email_delivery_status = "sent"
            case.owner_email_delivery_detail = f"Report view link emailed to {email}."
            append_activity(
                case,
                kind="owner_report_email_sent",
                actor_subject="system",
                detail=email,
            )
        except Exception as exc:  # noqa: BLE001 — never fail approval solely on mail
            case.owner_email_delivery_status = "failed_smtp"
            case.owner_email_delivery_detail = f"Email send failed: {exc}"

    def revoke_report_view_links(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> CaseRecord:
        case = self.get_case(case_id, principal=principal)
        if principal is not None and principal.role not in {
            "vet",
            "clinic_owner",
            "admin",
            "expert",
            "demo",
            "service",
        } and principal.via != "disabled":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
        n = 0
        if self._report_view_tokens is not None:
            n = int(self._report_view_tokens.revoke_case(case_id))  # type: ignore[attr-defined]
        append_activity(
            case,
            kind="report_view_links_revoked",
            actor_subject=principal.subject if principal else "system",
            detail=str(n),
        )
        case.updated_at = _now()
        return self._repo.save_case(case)

    def list_activity(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[CaseActivityEvent]:
        case = self.get_case(case_id, principal=principal)
        return list(case.activity)

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

