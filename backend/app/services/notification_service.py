"""Create and query persistent in-app notifications."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.schemas.notifications import AppNotification, NotificationKind, NotificationListResponse
from app.services.notification_store import NotificationStore


def _now() -> datetime:
    return datetime.now(timezone.utc)


class NotificationService:
    def __init__(self, store: NotificationStore) -> None:
        self._store = store

    def notify(
        self,
        *,
        recipient_subject: str | None,
        kind: NotificationKind,
        title: str,
        body: str,
        link_path: str,
        dedupe_key: str,
        case_id: str | None = None,
        submission_id: str | None = None,
        clinic_id: str | None = None,
    ) -> AppNotification | None:
        if not recipient_subject:
            return None
        n = AppNotification(
            recipient_subject=recipient_subject,
            kind=kind,
            title=title,
            body=body,
            link_path=link_path,
            dedupe_key=dedupe_key,
            case_id=case_id,
            submission_id=submission_id,
            clinic_id=clinic_id,
        )
        return self._store.upsert(n)

    def list_mine(
        self, *, principal: AuthPrincipal, unread_only: bool = False
    ) -> NotificationListResponse:
        subject = principal.subject
        items = self._store.list_for(subject, unread_only=unread_only)
        unread = sum(1 for n in self._store.list_for(subject) if n.read_at is None)
        return NotificationListResponse(items=items, unread_count=unread)

    def mark_read(self, notification_id: str, *, principal: AuthPrincipal) -> AppNotification:
        n = self._store.get(notification_id)
        if n is None or n.recipient_subject != principal.subject:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")
        if n.read_at is None:
            n = n.model_copy(update={"read_at": _now()})
            self._store.save(n)
        return n

    def mark_all_read(self, *, principal: AuthPrincipal) -> dict[str, int]:
        return {"marked": self._store.mark_all_read(principal.subject)}

    def delete(self, notification_id: str, *, principal: AuthPrincipal) -> dict[str, bool]:
        n = self._store.get(notification_id)
        if n is None or n.recipient_subject != principal.subject:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")
        self._store.delete(notification_id)
        return {"deleted": True}

    def delete_all(self, *, principal: AuthPrincipal) -> dict[str, int]:
        return {"deleted": self._store.delete_all_for(principal.subject)}
