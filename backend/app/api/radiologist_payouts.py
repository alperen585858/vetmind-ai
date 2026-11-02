"""Admin radiologist payout ledger API (editable fixed fee per approved case)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_ADMIN
from app.container import AppContainer
from app.schemas.radiologist_payout import (
    MarkRadiologistPaidRequest,
    RadiologistPayoutDetail,
    RadiologistPayoutLedger,
    RadiologistPayoutSettings,
    RadiologistPayoutSettingsUpdate,
)

router = APIRouter(
    prefix="/api/v1/admin/radiologist-payouts",
    tags=["radiologist-payouts"],
    dependencies=[Depends(require_auth), Depends(require_capability(CAP_ADMIN))],
)


def _svc(container: AppContainer = Depends(get_container)):
    return container.radiologist_payouts


@router.get("", response_model=RadiologistPayoutLedger)
def list_radiologist_payouts(
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> RadiologistPayoutLedger:
    """Per-radiologist unpaid case count and amount owed (fee × unpaid cases)."""
    return service.get_ledger(principal=principal)


@router.get("/settings", response_model=RadiologistPayoutSettings)
def get_radiologist_payout_settings(
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> RadiologistPayoutSettings:
    return service.get_settings(principal=principal)


@router.put("/settings", response_model=RadiologistPayoutSettings)
def update_radiologist_payout_settings(
    payload: RadiologistPayoutSettingsUpdate,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> RadiologistPayoutSettings:
    """Update fee per approved case. By default rewrites unpaid row amounts."""
    return service.update_settings(payload, principal=principal)


@router.get("/{email}", response_model=RadiologistPayoutDetail)
def get_radiologist_payout_detail(
    email: str,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> RadiologistPayoutDetail:
    return service.get_detail(email, principal=principal)


@router.post("/{email}/mark-paid", response_model=RadiologistPayoutDetail)
def mark_radiologist_paid(
    email: str,
    payload: MarkRadiologistPaidRequest,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> RadiologistPayoutDetail:
    """Mark owed case fees as paid for this radiologist."""
    return service.mark_paid(email, payload, principal=principal)
