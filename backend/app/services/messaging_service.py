"""Messaging between clinic staff, radiologists and the support team (B2B).

- A vet (or clinic owner) starts a conversation with one radiologist they are allowed to
  work with, or with the support team (all admins share that inbox).
- Only the participants (plus admins on the support channel) can read or reply.
- With tenant isolation on, people from other clinics are never listed or reachable.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.auth.security import DEMO_USERS, DemoUserRecord
from app.schemas.messaging import (
    MessageRecipient,
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
        user_directory: object | None = None,
    ) -> None:
        self._store = store
        self._notifications = notifications
        self._auth_users = auth_users if auth_users is not None else dict(DEMO_USERS)
        self._tenant_isolation = tenant_isolation
        # Optional managed-user store, used only for display names.
        self._user_directory = user_directory

    # Roles that may start conversations / reply as clinic-side participants.
    STARTER_ROLES = frozenset({"vet", "clinic_owner", "demo", "service"})
    PARTICIPANT_ROLES = frozenset({"vet", "clinic_owner", "expert", "admin", "demo", "service"})
    SUPPORT_SUBJECT = "support"

    def _display_name(self, subject: str | None) -> str:
        if not subject:
            return ""
        if subject == self.SUPPORT_SUBJECT:
            return "Destek ekibi"
        store = self._user_directory
        if store is not None and hasattr(store, "get_user"):
            try:
                user = store.get_user(subject)  # type: ignore[attr-defined]
            except Exception:  # noqa: BLE001 — display only
                user = None
            name = getattr(user, "display_name", None) if user is not None else None
            if name:
                return str(name)
        return subject.split("@")[0]

    def _same_clinic(self, a: str | None, b: str | None) -> bool:
        if not self._tenant_isolation:
            return True
        return not a or not b or a == b

    def list_recipients(self, *, principal: AuthPrincipal, query: str | None = None) -> list[MessageRecipient]:
        """Radiologists the caller may contact, plus the support team."""
        if principal.role not in self.STARTER_ROLES and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Messaging not available for this role.")
        needle = (query or "").strip().lower()
        out: list[MessageRecipient] = []
        for email, rec in sorted(self._auth_users.items()):
            if rec.role != "expert" or email == principal.subject:
                continue
            if not self._same_clinic(principal.clinic_id, rec.clinic_id):
                continue
            out.append(
                MessageRecipient(
                    subject=email,
                    display_name=self._display_name(email),
                    role="expert",
                    channel="radiologist",
                )
            )
        out.append(
            MessageRecipient(
                subject=self.SUPPORT_SUBJECT,
                display_name=self._display_name(self.SUPPORT_SUBJECT),
                role="support",
                channel="admin",
            )
        )
        if needle:
            role_words = {"expert": "radyolog radiologist uzman", "support": "destek support admin yönetim"}
            out = [
                r
                for r in out
                if needle in f"{r.subject} {r.display_name} {role_words.get(r.role, '')}".lower()
            ]
        return out

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
        if principal.subject in {thread.owner_subject, thread.recipient_subject}:
            return True
        if principal.role == "expert" and thread.channel == "radiologist" and thread.recipient_subject is None:
            # Legacy threads addressed to "any radiologist" in the clinic.
            return self._same_clinic(thread.clinic_id, principal.clinic_id)
        return False

    def _assert_access(self, thread: SupportThread, *, principal: AuthPrincipal) -> None:
        if not self._can_access(thread, principal=principal):
            raise HTTPException(status_code=404, detail="Conversation not found.")

    def _counterpart(self, thread: SupportThread, *, viewer: str) -> tuple[str, str]:
        if viewer == thread.owner_subject:
            if thread.channel == "admin":
                return self._display_name(self.SUPPORT_SUBJECT), "support"
            if thread.recipient_subject:
                return self._display_name(thread.recipient_subject), "expert"
            return "Radyolog", "expert"
        starter = self._auth_users.get(thread.owner_subject)
        return self._display_name(thread.owner_subject), getattr(starter, "role", "") or "vet"

    def _summary(self, thread: SupportThread, *, viewer: str) -> SupportThreadSummary:
        name, role = self._counterpart(thread, viewer=viewer)
        unread = sum(1 for m in thread.messages if viewer not in m.read_by and m.author_subject != viewer)
        last = thread.messages[-1] if thread.messages else None
        preview = (last.body[:120] + "…") if last and len(last.body) > 120 else (last.body if last else None)
        return SupportThreadSummary(
            thread_id=thread.thread_id,
            channel=thread.channel,
            owner_subject=thread.owner_subject,
            recipient_subject=thread.recipient_subject,
            counterpart_name=name,
            counterpart_role=role,
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
        if thread.recipient_subject:
            recipients.add(thread.recipient_subject)
        elif thread.channel == "radiologist":
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
        if principal.role not in self.PARTICIPANT_ROLES and principal.via != "disabled":
            raise HTTPException(status_code=403, detail="Messaging not available for this role.")
        out: list[SupportThreadSummary] = []
        for t in self._store.list_threads():
            if not self._can_access(t, principal=principal):
                continue
            out.append(self._summary(t, viewer=principal.subject))
        out.sort(key=lambda t: t.last_message_at or t.updated_at, reverse=True)
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
            principal.role in self.STARTER_ROLES
            if principal.via == "jwt"
            else role in self.STARTER_ROLES or role in {"vet", "clinic_owner"}
        )
        if not starter_ok:
            raise HTTPException(
                status_code=403,
                detail="Only clinic staff can start a new conversation.",
            )
        recipient: str | None = None
        if payload.channel == "radiologist":
            recipient = (payload.recipient_subject or "").strip().lower() or None
            allowed = {
                r.subject
                for r in self.list_recipients(
                    principal=AuthPrincipal(
                        subject=subject, role=role if role in self.STARTER_ROLES else "vet",
                        via=principal.via, clinic_id=principal.clinic_id,
                    )
                )
                if r.channel == "radiologist"
            }
            if recipient is None or recipient not in allowed:
                # 404, not 403: do not reveal accounts outside the caller's reach.
                raise HTTPException(status_code=404, detail="Recipient not found.")
        first = SupportMessage(
            author_subject=subject,
            author_role=role,
            body=payload.body.strip(),
            read_by=[subject],
        )
        thread = SupportThread(
            channel=payload.channel,
            owner_subject=subject,
            recipient_subject=recipient,
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

        if effective_role not in self.PARTICIPANT_ROLES:
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

    def _effective_actor(
        self,
        *,
        principal: AuthPrincipal,
        actor_subject: str | None,
        actor_role: str | None,
        thread: SupportThread,
    ) -> tuple[str, str, AuthPrincipal]:
        subject = (actor_subject or principal.subject).strip()
        role = (actor_role or principal.role).strip()
        if principal.via == "disabled":
            access_principal = AuthPrincipal(
                subject=subject,
                role=role,
                via="disabled",
                clinic_id=principal.clinic_id,
            )
            self._assert_access(thread, principal=access_principal)
            return subject, role, access_principal
        self._assert_access(thread, principal=principal)
        return principal.subject, principal.role, principal

    def delete_message(
        self,
        thread_id: str,
        message_id: str,
        *,
        principal: AuthPrincipal,
        actor_subject: str | None = None,
        actor_role: str | None = None,
    ) -> SupportThreadDetail | None:
        """Delete one message. Returns remaining thread detail, or None if the thread was removed."""
        thread = self._store.get_thread(thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        subject, role, _access = self._effective_actor(
            principal=principal,
            actor_subject=actor_subject,
            actor_role=actor_role,
            thread=thread,
        )
        target = next((m for m in thread.messages if m.message_id == message_id), None)
        if target is None:
            raise HTTPException(status_code=404, detail="Message not found.")
        is_author = target.author_subject == subject
        is_admin = role == "admin" or principal.role == "admin"
        if not is_author and not is_admin:
            raise HTTPException(status_code=403, detail="Only the author or an admin can delete this message.")

        remaining = [m for m in thread.messages if m.message_id != message_id]
        if not remaining:
            self._store.delete_thread(thread_id)
            return None
        saved = self._store.save_thread(
            thread.model_copy(update={"messages": remaining, "updated_at": utcnow()})
        )
        return SupportThreadDetail(
            thread=self._summary(saved, viewer=subject),
            messages=self._views(saved, viewer=subject),
        )

    def delete_thread(
        self,
        thread_id: str,
        *,
        principal: AuthPrincipal,
        actor_subject: str | None = None,
        actor_role: str | None = None,
    ) -> None:
        thread = self._store.get_thread(thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        subject, role, _access = self._effective_actor(
            principal=principal,
            actor_subject=actor_subject,
            actor_role=actor_role,
            thread=thread,
        )
        # Participants or an admin may remove the conversation.
        allowed = (
            subject in {thread.owner_subject, thread.recipient_subject}
            or role in {"admin", "demo", "service"}
            or (thread.channel == "radiologist" and role == "expert" and thread.recipient_subject is None)
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Not allowed to delete this conversation.")
        self._store.delete_thread(thread_id)
