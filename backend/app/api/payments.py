"""Demo payment API — simulated authorization only (no real gateway)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_SUBMISSIONS
from app.container import AppContainer
from app.schemas.payment import (
    DemoPayment,
    DemoPaymentConfirmRequest,
    DemoPaymentConfirmResponse,
    DemoPaymentIntentCreate,
)

router = APIRouter(prefix="/api/v1/payments", tags=["payments"], dependencies=[Depends(require_auth)])


def _payments(container: AppContainer = Depends(get_container)):
    return container.payments


@router.post("/intents", response_model=DemoPayment, status_code=status.HTTP_201_CREATED)
def create_payment_intent(
    payload: DemoPaymentIntentCreate,
    principal: AuthPrincipal = Depends(require_capability(CAP_SUBMISSIONS)),
    service=Depends(_payments),
) -> DemoPayment:
    """Create (or return existing) demo payment intent for a draft submission."""
    return service.create_intent(payload, principal=principal)


@router.get("/intents/{payment_id}", response_model=DemoPayment)
def get_payment_intent(
    payment_id: str,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_payments),
) -> DemoPayment:
    return service.get_payment(payment_id, principal=principal)


@router.get("/by-submission/{submission_id}", response_model=DemoPayment)
def get_payment_by_submission(
    submission_id: str,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_payments),
) -> DemoPayment:
    return service.get_by_submission(submission_id, principal=principal)


@router.post(
    "/intents/{payment_id}/confirm-demo",
    response_model=DemoPaymentConfirmResponse,
)
def confirm_demo_payment(
    payment_id: str,
    payload: DemoPaymentConfirmRequest,
    principal: AuthPrincipal = Depends(require_capability(CAP_SUBMISSIONS)),
    service=Depends(_payments),
) -> DemoPaymentConfirmResponse:
    """Simulate demo card validation. Card data is never stored or logged."""
    return service.confirm_demo(payment_id, payload, principal=principal)
