"""Support messaging: pet owner ↔ radiologist (expert) and owner ↔ admin."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.auth.security import DEMO_USERS, DemoUserRecord
from app.schemas.messaging import (
    SupportMessage,
    SupportMessageCreate,
    SupportMessageView,
    SupportThread,
    SupportThreadCreate,
    SupportThreadDetail,
    SupportThreadSummary,
    utcnow,
)
from app.services.messaging_store import MessagingStore
from app.services.notification_service import NotificationService


def _now() -> datetime:
    return datetime.now(timezone.utc)


class MessagingService:
    def __init__(
        self,
        store: MessagingStore,
        *,
        notifications: NotificationService | None = None,
        auth_users: dict[str, DemoUserRecord] | None = None,
        tenant_isolation: bool = False,
    ) -> None:
        self._store = store
        self._notifications = notifications
        self._auth_users = auth_users if auth_users is not None else dict(DEMO_USERS)
        self._tenant_isolation = tenant_isolation

    def _subjects_for_role(self, role: str, *, clinic_id: str | None) -> list[str]:
        out: list[str] = []
        for email, rec in self._auth_users.items():
            if rec.role != role:
                continue
            if role == "admin":
                out.append(email)
                continue
            if self._tenant_isolation and clinic_id and rec.clinic_id and rec.clinic_id != clinic_id:
                continue
            out.append(email)
        return out

    def _can_access(self, thread: SupportThread, *, principal: AuthPrincipal) -> bool:
        if principal.via == "disabled" or principal.role in {"admin", "demo", "service"}:
            return True
        if principal.role == "owner":
            return thread.owner_subject == principal.subject
        if principal.role == "expert" and thread.channel == "radiologist":
            if self._tenant_isolation and thread.clinic_id and principal.clinic_id:
                return thread.clinic_id == principal.clinic_id
            return True
        if principal.role == "admin" and thread.channel == "admin":
            return True
        return False

    def _assert_access(self, thread: SupportThread, *, principal: AuthPrincipal) -> None:
        if not self._can_access(thread, principal=principal):
            raise HTTPException(status_code=404, detail="Conversation not found.")

    def _summary(self, thread: SupportThread, *, viewer: str) -> SupportThreadSummary:
        unread = sum(1 for m in thread.messages if viewer not in m.read_by and m.author_subject != viewer)
        last = thread.messages[-1] if thread.messages else None
        preview = (last.body[:120] + "…") if last and len(last.body) > 120 else (last.body if last else None)
        return SupportThreadSummary(
            thread_id=thread.thread_id,
            channel=thread.channel,
            owner_subject=thread.owner_subject,
            clinic_id=thread.clinic_id,
            subject=thread.subject,
            status=thread.status,
            related_case_id=thread.related_case_id,
            related_submission_id=thread.related_submission_id,
            message_count=len(thread.messages),
            unread_count=unread,
            last_message_preview=preview,
            last_message_at=last.created_at if last else None,
            created_at=thread.created_at,
            updated_at=thread.updated_at,
        )

    def _views(self, thread: SupportThread, *, viewer: str) -> list[SupportMessageView]:
        return [
            SupportMessageView(
                message_id=m.message_id,
                author_subject=m.author_subject,
                author_role=m.author_role,
                body=m.body,
                created_at=m.created_at,
                unread=viewer not in m.read_by and m.author_subject != viewer,
            )
            for m in thread.messages
        ]

    def _notify_recipients(
        self,
        thread: SupportThread,
        *,
        author: str,
        title: str,
        body: str,
        message_id: str,
    ) -> None:
        if self._notifications is None:
            return
        recipients: set[str] = {thread.owner_subject}
        if thread.channel == "radiologist":
            recipients.update(self._subjects_for_role("expert", clinic_id=thread.clinic_id))
        else:
            recipients.update(self._subjects_for_role("admin", clinic_id=None))
        recipients.discard(author)
        for recipient in recipients:
            self._notifications.notify(
                recipient_subject=recipient,
                kind="support_message",
                title=title,
                body=body[:200],
                link_path=f"/mesajlar/{thread.thread_id}",
                dedupe_key=f"support_message:{thread.thread_id}:{message_id}:{recipient}",
                case_id=thread.related_case_id,
                submission_id=thread.related_submission_id,
                clinic_id=thread.clinic_id,
            )

    def list_threads(self, *, principal: AuthPrincipal) -> list[SupportThreadSummary]:
        if principal.role not in {"owner", "expert", "admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Messaging not available for this role.")
        out: list[SupportThreadSummary] = []
        for t in self._store.list_threads():
            if not self._can_access(t, principal=principal):
                continue
            out.append(self._summary(t, viewer=principal.subject))
        return out

    def get_thread(self, thread_id: str, *, principal: AuthPrincipal) -> SupportThreadDetail:
        thread = self._store.get_thread(thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        self._assert_access(thread, principal=principal)
        return SupportThreadDetail(
            thread=self._summary(thread, viewer=principal.subject),
            messages=self._views(thread, viewer=principal.subject),
        )

    def create_thread(
        self,
        payload: SupportThreadCreate,
        *,
        principal: AuthPrincipal,
        actor_subject: str | None = None,
        actor_role: str | None = None,
    ) -> SupportThreadDetail:
        subject = (actor_subject or principal.subject).strip()
        role = (actor_role or principal.role).strip()
        starter_ok = (
            principal.role in {"owner", "demo", "service"}
            if principal.via == "jwt"
            else role in {"owner", "demo", "service"}
        )
        if not starter_ok:
            raise HTTPException(
                status_code=403,
                detail="Only pet owners can start a new conversation in this demo.",
            )
        first = SupportMessage(
            author_subject=subject,
            author_role=role,
            body=payload.body.strip(),
            read_by=[subject],
        )
        thread = SupportThread(
            channel=payload.channel,
            owner_subject=subject,
            clinic_id=principal.clinic_id,
            subject=payload.subject.strip(),
            related_case_id=payload.related_case_id,
            related_submission_id=payload.related_submission_id,
            messages=[first],
        )
        saved = self._store.save_thread(thread)
        channel_label = "radyolog" if saved.channel == "radiologist" else "yönetim"
        self._notify_recipients(
            saved,
            author=subject,
            title=f"Yeni mesaj ({channel_label})",
            body=f"{saved.subject}: {first.body}",
            message_id=first.message_id,
        )
        return SupportThreadDetail(
            thread=self._summary(saved, viewer=subject),
            messages=self._views(saved, viewer=subject),
        )

    def post_message(
        self,
        thread_id: str,
        payload: SupportMessageCreate,
        *,
        principal: AuthPrincipal,
        actor_subject: str | None = None,
        actor_role: str | None = None,
    ) -> SupportMessageView:
        thread = self._store.get_thread(thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        # Resolve effective actor (JWT principal, or demo headers when auth is off).
        subject = (actor_subject or principal.subject).strip()
        role = (actor_role or principal.role).strip()
        # Access check uses JWT principal; for disabled auth allow demo actor.
        if principal.via == "disabled":
            demo_principal = AuthPrincipal(
                subject=subject,
                role=role,
                via="disabled",
                clinic_id=principal.clinic_id,
            )
            self._assert_access(thread, principal=demo_principal)
        else:
            self._assert_access(thread, principal=principal)
        if thread.status == "closed":
            raise HTTPException(status_code=409, detail="Conversation is closed.")

        effective_role = role if principal.via == "disabled" else principal.role
        effective_subject = subject if principal.via == "disabled" else principal.subject

        if effective_role not in {
            "owner",
            "expert",
            "admin",
            "demo",
            "service",
        }:
            raise HTTPException(status_code=403, detail="Not allowed to reply.")
        if thread.channel == "radiologist" and effective_role not in {
            "owner",
            "expert",
            "admin",
            "demo",
            "service",
        }:
            raise HTTPException(status_code=403, detail="Not allowed to reply.")
        if thread.channel == "admin" and effective_role not in {"owner", "admin", "demo", "service"}:
            raise HTTPException(status_code=403, detail="Not allowed to reply.")

        msg = SupportMessage(
            author_subject=effective_subject,
            author_role=effective_role,
            body=payload.body.strip(),
            read_by=[effective_subject],
        )
        thread = thread.model_copy(
            update={
                "messages": [*thread.messages, msg],
                "updated_at": utcnow(),
            }
        )
        saved = self._store.save_thread(thread)
        channel_label = "radyolog" if saved.channel == "radiologist" else "yönetim"
        self._notify_recipients(
            saved,
            author=effective_subject,
            title=f"Yeni yanıt ({channel_label})",
            body=f"{saved.subject}: {msg.body}",
            message_id=msg.message_id,
        )
        return SupportMessageView(
            message_id=msg.message_id,
            author_subject=msg.author_subject,
            author_role=msg.author_role,
            body=msg.body,
            created_at=msg.created_at,
            unread=False,
        )

    def mark_read(self, thread_id: str, *, principal: AuthPrincipal) -> SupportThreadDetail:
        thread = self._store.get_thread(thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        self._assert_access(thread, principal=principal)
        viewer = principal.subject
        updated_msgs: list[SupportMessage] = []
        changed = False
        for m in thread.messages:
            if viewer not in m.read_by:
                updated_msgs.append(m.model_copy(update={"read_by": [*m.read_by, viewer]}))
                changed = True
            else:
                updated_msgs.append(m)
        if changed:
            thread = thread.model_copy(update={"messages": updated_msgs, "updated_at": _now()})
            thread = self._store.save_thread(thread)
        return SupportThreadDetail(
            thread=self._summary(thread, viewer=viewer),
            messages=self._views(thread, viewer=viewer),
        )
