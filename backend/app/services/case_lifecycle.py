"""Assignment, review SLA warnings, load / cancel / hide / delete (part of CaseService)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.auth.rbac import CAP_CASE_WRITE
from app.auth.tenancy import assert_case_access
from app.http_errors import api_error
from app.review_sla import (
    OPEN_REVIEW_STATUSES,
    WARN_WITHIN_HOURS,
    apply_review_sla,
    clear_review_sla,
    remaining_seconds,
    sla_hours_for,
)
from app.schemas.case import (
    CaseAssignmentUpdate,
    CaseRecord,
)
from app.schemas.enums import (
    CaseLifecycleStatus,
)
from app.services.activity import append_activity
from app.services.case_ids import canonicalize_case_id


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CaseLifecycleMixin:
    """Lifecycle operations for CaseService."""

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
