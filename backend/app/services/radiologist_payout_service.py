"""Fixed-fee radiologist payout tracking for system admins."""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.auth.rbac import CAP_ADMIN
from app.schemas.enums import CaseLifecycleStatus
from app.schemas.radiologist_payout import (
    RADIOLOGIST_CASE_CURRENCY,
    RADIOLOGIST_CASE_FEE,
    MarkRadiologistPaidRequest,
    RadiologistCasePayout,
    RadiologistPayoutDetail,
    RadiologistPayoutLedger,
    RadiologistPayoutSummary,
    utcnow,
)
from app.security.audit import AuditLogger, AuditOutcome
from app.services.radiologist_payout_store import RadiologistPayoutStore

if TYPE_CHECKING:
    from app.services.repository import CaseRepository
    from app.services.workflow_service import WorkflowService


class RadiologistPayoutService:
    def __init__(
        self,
        store: RadiologistPayoutStore,
        *,
        fee_per_case: int = RADIOLOGIST_CASE_FEE,
        audit: AuditLogger | None = None,
        cases_repo: "CaseRepository | None" = None,
        workflow: "WorkflowService | None" = None,
    ) -> None:
        self._store = store
        self._fee = max(1, int(fee_per_case))
        self._audit = audit
        self._cases_repo = cases_repo
        self._workflow = workflow

    def bind_workflow(self, workflow: "WorkflowService") -> None:
        self._workflow = workflow

    def bind_cases_repo(self, repo: "CaseRepository") -> None:
        self._cases_repo = repo

    def _require_admin(self, principal: AuthPrincipal) -> None:
        if principal.via == "disabled":
            return
        if not principal.can(CAP_ADMIN) and principal.role not in {"admin", "demo", "service"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only.")

    def _audit_event(
        self,
        *,
        event_type: str,
        actor: str,
        resource: str,
        outcome: AuditOutcome | str = AuditOutcome.SUCCESS,
        detail: str | None = None,
    ) -> None:
        if self._audit is None:
            return
        self._audit.record(
            event_type=event_type,
            actor=actor,
            resource=resource,
            outcome=outcome,
            detail=detail,
        )

    def record_approval(
        self,
        *,
        case_id: str,
        radiologist_subject: str,
        approved_at=None,
    ) -> RadiologistCasePayout:
        """Idempotent: one payout row per approved case."""
        existing = self._store.get_by_case(case_id)
        if existing is not None:
            return existing
        subject = (radiologist_subject or "").strip()
        if not subject:
            subject = "unknown-radiologist"
        now = approved_at or utcnow()
        payout = RadiologistCasePayout(
            case_id=case_id,
            radiologist_subject=subject,
            amount=self._fee,
            currency="EUR",
            status="owed",
            approved_at=now,
            created_at=now,
            updated_at=now,
        )
        saved = self._store.save_payout(payout)
        self._audit_event(
            event_type="radiologist_payout.accrued",
            actor=subject,
            resource=case_id,
            detail=f"{self._fee} {RADIOLOGIST_CASE_CURRENCY}",
        )
        return saved

    def sync_from_cases(self) -> int:
        """Backfill missing payout rows from already-approved cases. Returns new row count."""
        if self._cases_repo is None:
            return 0
        created = 0
        for case in self._cases_repo.list_cases():
            if case.status != CaseLifecycleStatus.APPROVED:
                continue
            if self._store.get_by_case(case.case_id) is not None:
                continue
            reviewer = None
            if case.draft_report is not None and case.draft_report.reviewed_by:
                reviewer = case.draft_report.reviewed_by
            elif case.assigned_reviewer_id:
                reviewer = case.assigned_reviewer_id
            if not reviewer:
                from app.schemas.enums import ReviewAction

                for fb in reversed(case.review_history or []):
                    if fb.action == ReviewAction.APPROVE:
                        reviewer = fb.reviewer_id
                        break
            if not reviewer:
                continue
            approved_at = case.report_available_at or case.updated_at
            self.record_approval(
                case_id=case.case_id,
                radiologist_subject=reviewer,
                approved_at=approved_at,
            )
            created += 1
        return created

    def _expert_directory(self) -> list[tuple[str, Optional[str], bool]]:
        """Return (email, display_name, active) for expert role users."""
        seen: dict[str, tuple[str, Optional[str], bool]] = {}
        if self._workflow is not None:
            try:
                for u in self._workflow._store.list_users():  # noqa: SLF001 — admin directory
                    if u.role != "expert":
                        continue
                    seen[u.email.lower()] = (u.email, u.display_name, bool(u.active))
            except Exception:
                pass
        try:
            from app.auth.security import DEMO_USERS

            for email, rec in DEMO_USERS.items():
                if rec.role != "expert":
                    continue
                key = email.lower()
                if key not in seen:
                    seen[key] = (email, email.split("@")[0], True)
        except Exception:
            pass
        # Always include radiologists that already have payouts.
        for p in self._store.list_payouts():
            key = p.radiologist_subject.lower()
            if key not in seen:
                seen[key] = (p.radiologist_subject, None, True)
        return list(seen.values())

    def _summarize(self, subject: str, display_name: Optional[str], active: bool) -> RadiologistPayoutSummary:
        rows = self._store.list_by_radiologist(subject)
        unpaid = [r for r in rows if r.status == "owed"]
        paid = [r for r in rows if r.status == "paid"]
        return RadiologistPayoutSummary(
            radiologist_subject=subject,
            display_name=display_name,
            active=active,
            approved_cases=len(rows),
            unpaid_cases=len(unpaid),
            paid_cases=len(paid),
            amount_owed=sum(r.amount for r in unpaid),
            amount_paid=sum(r.amount for r in paid),
            fee_per_case=self._fee,
            currency="EUR",
        )

    def get_ledger(self, *, principal: AuthPrincipal) -> RadiologistPayoutLedger:
        self._require_admin(principal)
        self.sync_from_cases()
        radiologists = [
            self._summarize(email, display, active)
            for email, display, active in self._expert_directory()
        ]
        radiologists.sort(key=lambda r: (-r.unpaid_cases, -r.amount_owed, r.radiologist_subject))
        return RadiologistPayoutLedger(
            fee_per_case=self._fee,
            currency="EUR",
            radiologists=radiologists,
            total_unpaid_cases=sum(r.unpaid_cases for r in radiologists),
            total_amount_owed=sum(r.amount_owed for r in radiologists),
        )

    def get_detail(self, email: str, *, principal: AuthPrincipal) -> RadiologistPayoutDetail:
        self._require_admin(principal)
        self.sync_from_cases()
        subject = email.strip()
        display = None
        active = True
        for e, d, a in self._expert_directory():
            if e.lower() == subject.lower():
                subject, display, active = e, d, a
                break
        summary = self._summarize(subject, display, active)
        payouts = self._store.list_by_radiologist(subject)
        return RadiologistPayoutDetail(summary=summary, payouts=payouts)

    def mark_paid(
        self,
        email: str,
        payload: MarkRadiologistPaidRequest,
        *,
        principal: AuthPrincipal,
    ) -> RadiologistPayoutDetail:
        self._require_admin(principal)
        subject = email.strip()
        rows = self._store.list_by_radiologist(subject)
        if not rows and not any(e.lower() == subject.lower() for e, _, _ in self._expert_directory()):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Radiologist not found.")

        wanted = None
        if payload.case_ids is not None:
            wanted = {c.strip() for c in payload.case_ids if c and c.strip()}

        now = utcnow()
        marked = 0
        for row in rows:
            if row.status != "owed":
                continue
            if wanted is not None and row.case_id not in wanted:
                continue
            updated = row.model_copy(
                update={
                    "status": "paid",
                    "paid_at": now,
                    "marked_paid_by": principal.subject,
                    "updated_at": now,
                }
            )
            self._store.save_payout(updated)
            marked += 1

        self._audit_event(
            event_type="radiologist_payout.marked_paid",
            actor=principal.subject,
            resource=subject,
            detail=f"marked={marked}",
        )
        return self.get_detail(subject, principal=principal)
