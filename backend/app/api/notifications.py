"""Phase 17 notification APIs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_actor, require_auth
from app.container import AppContainer
from app.schemas.notifications import AppNotification, NotificationListResponse

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"], dependencies=[Depends(require_auth)])


def _svc(container: AppContainer = Depends(get_container)):
    return container.notifications


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    unread_only: bool = Query(default=False),
    principal: AuthPrincipal = Depends(require_actor),
    service=Depends(_svc),
    container: AppContainer = Depends(get_container),
) -> NotificationListResponse:
    # Polling the bell also refreshes expert SLA clocks and warning notifications.
    try:
        container.cases.backfill_and_emit_sla_warnings()
    except Exception:  # noqa: BLE001 — never block the inbox on SLA scan
        pass
    return service.list_mine(principal=principal, unread_only=unread_only)


@router.post("/{notification_id}/read", response_model=AppNotification)
def mark_read(
    notification_id: str,
    principal: AuthPrincipal = Depends(require_actor),
    service=Depends(_svc),
) -> AppNotification:
    return service.mark_read(notification_id, principal=principal)


@router.post("/read-all")
def mark_all_read(
    principal: AuthPrincipal = Depends(require_actor),
    service=Depends(_svc),
) -> dict[str, int]:
    return service.mark_all_read(principal=principal)


@router.post("/clear-all")
def clear_all(
    principal: AuthPrincipal = Depends(require_actor),
    service=Depends(_svc),
) -> dict[str, int]:
    return service.delete_all(principal=principal)


@router.post("/{notification_id}/delete")
def delete_notification(
    notification_id: str,
    principal: AuthPrincipal = Depends(require_actor),
    service=Depends(_svc),
) -> dict[str, bool]:
    return service.delete(notification_id, principal=principal)
