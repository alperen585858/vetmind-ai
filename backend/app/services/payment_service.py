"""Demo payment authorization for imaging submissions (simulated only)."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.schemas.payment import (
    DEMO_CARD_CVC,
    DEMO_CARD_EXPIRY,
    DEMO_CARD_NUMBER,
    DEMO_DECLINE_CARD_NUMBER,
    DEMO_IMAGING_AMOUNT,
    DemoPayment,
    DemoPaymentConfirmRequest,
    DemoPaymentConfirmResponse,
    DemoPaymentIntentCreate,
    utcnow,
)
from app.security.audit import AuditLogger, AuditOutcome
from app.services.payment_store import PaymentStore

if TYPE_CHECKING:
    from app.services.workflow_service import WorkflowService


def _digits_only(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _normalize_expiry(value: str) -> str:
    raw = (value or "").strip().replace(" ", "")
    if re.fullmatch(r"\d{2}/\d{2}", raw):
        return raw
    if re.fullmatch(r"\d{4}", raw):
        return f"{raw[:2]}/{raw[2:]}"
    return raw


class PaymentService:
    def __init__(
        self,
        store: PaymentStore,
        *,
        workflow: WorkflowService | None = None,
        audit: AuditLogger | None = None,
        tenant_isolation: bool = False,
    ) -> None:
        self._store = store
        self._workflow = workflow
        self._audit = audit
        self._tenant_isolation = tenant_isolation

    def bind_workflow(self, workflow: WorkflowService) -> None:
        self._workflow = workflow

    def _audit_event(
        self,
        *,
        event_type: str,
        actor: str,
        resource: str,
        outcome: AuditOutcome | str,
        detail: str | None = None,
        clinic_id: str | None = None,
    ) -> None:
        if self._audit is None:
            return
        self._audit.record(
            event_type=event_type,
            actor=actor,
            resource=resource,
            outcome=outcome,
            detail=detail,
            clinic_id=clinic_id,
        )

    def _assert_payment_access(self, payment: DemoPayment, *, principal: AuthPrincipal) -> None:
        if principal.via == "disabled":
            return
        if principal.role in {"admin", "demo", "service"}:
            return
        if principal.role == "owner":
            if payment.owner_subject != principal.subject:
                raise HTTPException(status_code=404, detail="Payment not found.")
            return
        if principal.role in {"vet", "clinic_owner", "expert"}:
            if self._tenant_isolation and payment.clinic_id and principal.clinic_id:
                if payment.clinic_id != principal.clinic_id:
                    raise HTTPException(status_code=404, detail="Payment not found.")
            return
        raise HTTPException(status_code=404, detail="Payment not found.")

    def create_intent(
        self, payload: DemoPaymentIntentCreate, *, principal: AuthPrincipal
    ) -> DemoPayment:
        if self._workflow is None:
            raise HTTPException(status_code=500, detail="Payment service not wired.")
        sub = self._workflow.get_submission(payload.submission_id, principal=principal)
        if principal.via == "jwt" and principal.role == "owner":
            if sub.pet_owner_subject != principal.subject:
                raise HTTPException(status_code=404, detail="Submission not found.")
        if sub.status not in {"draft", "pending_verification"}:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot create payment for submission in status '{sub.status}'.",
            )

        existing = self._store.get_by_submission(sub.submission_id)
        if existing is not None:
            self._assert_payment_access(existing, principal=principal)
            return existing

        owner = sub.pet_owner_subject
        payment = DemoPayment(
            submission_id=sub.submission_id,
            amount=DEMO_IMAGING_AMOUNT,
            currency="EUR",
            mode="demo",
            status="requires_confirmation",
            owner_subject=owner,
            clinic_id=sub.clinic_id,
        )
        saved = self._store.save_payment(payment)
        # Link on submission without elevating status.
        self._workflow.link_payment(
            sub.submission_id,
            payment_id=saved.payment_id,
            payment_status=saved.status,
            principal=principal,
        )
        self._audit_event(
            event_type="payment.intent_created",
            actor=principal.subject,
            resource=saved.payment_id,
            outcome=AuditOutcome.SUCCESS,
            detail=f"submission={sub.submission_id};mode=demo;amount={saved.amount}{saved.currency}",
            clinic_id=saved.clinic_id,
        )
        return saved

    def get_payment(self, payment_id: str, *, principal: AuthPrincipal) -> DemoPayment:
        payment = self._store.get_payment(payment_id)
        if payment is None:
            raise HTTPException(status_code=404, detail="Payment not found.")
        self._assert_payment_access(payment, principal=principal)
        return payment

    def get_by_submission(self, submission_id: str, *, principal: AuthPrincipal) -> DemoPayment:
        if self._workflow is None:
            raise HTTPException(status_code=500, detail="Payment service not wired.")
        # Enforce submission ACL first (404 on cross-tenant).
        self._workflow.get_submission(submission_id, principal=principal)
        payment = self._store.get_by_submission(submission_id)
        if payment is None:
            raise HTTPException(status_code=404, detail="Payment not found.")
        self._assert_payment_access(payment, principal=principal)
        return payment

    def confirm_demo(
        self, payment_id: str, payload: DemoPaymentConfirmRequest, *, principal: AuthPrincipal
    ) -> DemoPaymentConfirmResponse:
        """Simulate card validation. Card fields are never stored or audited."""
        payment = self.get_payment(payment_id, principal=principal)
        if principal.via == "jwt" and principal.role == "owner":
            if payment.owner_subject != principal.subject:
                raise HTTPException(status_code=404, detail="Payment not found.")
        if principal.via == "jwt" and principal.role not in {
            "owner",
            "admin",
            "demo",
            "service",
        }:
            raise HTTPException(status_code=403, detail="Only the payer can confirm demo payment.")

        # Idempotent success path — refresh-safe.
        if payment.status == "approved":
            finalized = False
            sub_status = None
            if self._workflow is not None:
                sub = self._workflow.finalize_submission(
                    payment.submission_id, principal=principal, payment_id=payment.payment_id
                )
                finalized = sub.status != "draft"
                sub_status = sub.status
            return DemoPaymentConfirmResponse(
                payment=payment,
                message="Demo Payment Approved",
                submission_finalized=finalized,
                submission_id=payment.submission_id,
                submission_status=sub_status,
            )

        card = _digits_only(payload.card_number)
        expiry = _normalize_expiry(payload.expiry)
        cvc = (payload.cvc or "").strip()

        # Validate against predefined demo values only — discard immediately after.
        approved = (
            card == DEMO_CARD_NUMBER
            and expiry == DEMO_CARD_EXPIRY
            and cvc == DEMO_CARD_CVC
        )
        declined = card == DEMO_DECLINE_CARD_NUMBER

        # Explicitly drop sensitive locals from further use after branch decision.
        del card, expiry, cvc, payload

        now = utcnow()
        if declined or not approved:
            failed = payment.model_copy(
                update={"status": "failed", "updated_at": now, "approved_at": None}
            )
            saved = self._store.save_payment(failed)
            if self._workflow is not None:
                self._workflow.link_payment(
                    saved.submission_id,
                    payment_id=saved.payment_id,
                    payment_status=saved.status,
                    principal=principal,
                )
            self._audit_event(
                event_type="payment.demo_failed",
                actor=principal.subject,
                resource=saved.payment_id,
                outcome=AuditOutcome.DENIED,
                detail="demo_validation_failed",
                clinic_id=saved.clinic_id,
            )
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Demo payment declined. Use the predefined test card (no real charge).",
            )

        approved_payment = payment.model_copy(
            update={"status": "approved", "updated_at": now, "approved_at": now}
        )
        saved = self._store.save_payment(approved_payment)
        finalized = False
        sub_status = None
        if self._workflow is not None:
            self._workflow.link_payment(
                saved.submission_id,
                payment_id=saved.payment_id,
                payment_status=saved.status,
                principal=principal,
            )
            sub = self._workflow.finalize_submission(
                saved.submission_id, principal=principal, payment_id=saved.payment_id
            )
            finalized = sub.status != "draft"
            sub_status = sub.status

        self._audit_event(
            event_type="payment.demo_approved",
            actor=principal.subject,
            resource=saved.payment_id,
            outcome=AuditOutcome.SUCCESS,
            detail=f"submission={saved.submission_id};mode=demo",
            clinic_id=saved.clinic_id,
        )
        return DemoPaymentConfirmResponse(
            payment=saved,
            message="Demo Payment Approved",
            submission_finalized=finalized,
            submission_id=saved.submission_id,
            submission_status=sub_status,
        )

    def assert_approved_for_submission(self, submission_id: str) -> DemoPayment:
        payment = self._store.get_by_submission(submission_id)
        if payment is None or payment.status != "approved":
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Demo payment approval required before finalizing the imaging submission.",
            )
        return payment
