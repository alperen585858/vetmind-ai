"""Messaging between clinic staff, radiologists and the support team (B2B).

- A vet (or clinic owner) starts a conversation with one radiologist they are allowed to
  work with, or with the support team (all admins share that inbox).
- Only the participants (plus admins on the support channel) can read or reply.
- With tenant isolation on, people from other clinics are never listed or reachable.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

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

_log = logging.getLogger(__name__)

# Subjects stored by auth-off demo sessions before messages were attributed to a person.
LEGACY_DEMO_SUBJECTS = frozenset({"anonymous", "demo"})


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
        live: object | None = None,
    ) -> None:
        self._store = store
        self._notifications = notifications
        self._auth_users = auth_users if auth_users is not None else dict(DEMO_USERS)
        self._tenant_isolation = tenant_isolation
        # Optional managed-user store, used only for display names.
        self._user_directory = user_directory
        # Optional LiveEventBroker for SSE pushes (new message, delete/undo, read, typing).
        self._live = live

    # How long a deleted message can be restored; after that its text is purged.
    UNDO_WINDOW = timedelta(minutes=5)

    # --- live events --------------------------------------------------------------

    def _participants(self, thread: SupportThread) -> set[str]:
        people = {thread.owner_subject}
        if thread.recipient_subject:
            people.add(thread.recipient_subject)
        elif thread.channel == "radiologist":
            people.update(self._subjects_for_role("expert", clinic_id=thread.clinic_id))
        if thread.channel == "admin":
            people.update(self._subjects_for_role("admin", clinic_id=None))
        return people

    def _publish(self, thread: SupportThread, event: dict, *, exclude: str | None = None) -> None:
        if self._live is None:
            return
        targets = self._participants(thread)
        if exclude:
            targets.discard(exclude)
        try:
            self._live.publish(targets, {"thread_id": thread.thread_id, **event})  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 — live push is best effort; data is already saved
            _log.warning("_publish: ignored error", exc_info=True)

    def _is_online(self, subject: str | None) -> bool:
        if self._live is None or not subject:
            return False
        return bool(self._live.is_online(subject))  # type: ignore[attr-defined]

    # --- soft delete ----------------------------------------------------------------

    def _purge_expired(self, thread: SupportThread) -> SupportThread:
        """Drop the text of deleted messages whose undo window has passed (KVKK)."""
        cutoff = _now() - self.UNDO_WINDOW
        changed = False
        msgs: list[SupportMessage] = []
        for m in thread.messages:
            if m.deleted_at is not None and m.deleted_at <= cutoff and m.body:
                msgs.append(m.model_copy(update={"body": ""}))
                changed = True
            else:
                msgs.append(m)
        if not changed:
            return thread
        return self._store.save_thread(thread.model_copy(update={"messages": msgs}))

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
                _log.warning("_display_name: ignored error", exc_info=True)
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
        """Radiologists the caller may contact, the clinic manager <-> vets, plus the support team."""
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
        # Inside one clinic the manager can write to the vets, and the vets to the manager.
        peer_role = {"clinic_owner": "vet", "vet": "clinic_owner"}.get(principal.role)
        if peer_role:
            for email, rec in sorted(self._auth_users.items()):
                if rec.role != peer_role or email == principal.subject:
                    continue
                if not principal.clinic_id or rec.clinic_id != principal.clinic_id:
                    continue
                out.append(
                    MessageRecipient(
                        subject=email,
                        display_name=self._display_name(email),
                        role=peer_role,
                        channel="clinic",
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
            role_words = {
                "expert": "radyolog radiologist uzman",
                "support": "destek support admin yönetim",
                "vet": "veteriner vet hekim",
                "clinic_owner": "klinik yönetici clinic manager",
            }
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
                rec = self._auth_users.get(thread.recipient_subject)
                return self._display_name(thread.recipient_subject), getattr(rec, "role", "") or "expert"
            return "Radyolog", "expert"
        starter = self._auth_users.get(thread.owner_subject)
        return self._display_name(thread.owner_subject), getattr(starter, "role", "") or "vet"

    def _summary(self, thread: SupportThread, *, viewer: str) -> SupportThreadSummary:
        name, role = self._counterpart(thread, viewer=viewer)
        live_msgs = [m for m in thread.messages if m.deleted_at is None]
        unread = sum(1 for m in live_msgs if viewer not in m.read_by and m.author_subject != viewer)
        last = live_msgs[-1] if live_msgs else None
        preview = (last.body[:120] + "…") if last and len(last.body) > 120 else (last.body if last else None)
        if viewer == thread.owner_subject:
            online = (
                any(self._is_online(a) for a in self._subjects_for_role("admin", clinic_id=None))
                if thread.channel == "admin"
                else self._is_online(thread.recipient_subject)
            )
        else:
            online = self._is_online(thread.owner_subject)
        return SupportThreadSummary(
            thread_id=thread.thread_id,
            channel=thread.channel,
            owner_subject=thread.owner_subject,
            recipient_subject=thread.recipient_subject,
            counterpart_name=name,
            counterpart_role=role,
            counterpart_online=online,
            clinic_id=thread.clinic_id,
            subject=thread.subject,
            status=thread.status,
            related_case_id=thread.related_case_id,
            related_submission_id=thread.related_submission_id,
            message_count=len(live_msgs),
            unread_count=unread,
            last_message_preview=preview,
            last_message_at=last.created_at if last else None,
            created_at=thread.created_at,
            updated_at=thread.updated_at,
        )

    def _view(self, m: SupportMessage, *, viewer: str) -> SupportMessageView:
        deleted = m.deleted_at is not None
        restorable_until = (m.deleted_at + self.UNDO_WINDOW) if deleted and m.body else None
        return SupportMessageView(
            message_id=m.message_id,
            author_subject=m.author_subject,
            author_role=m.author_role,
            # Deleted text is only returned to the deleter (to show what undo brings back).
            body="" if deleted and m.deleted_by != viewer else m.body,
            created_at=m.created_at,
            unread=not deleted and viewer not in m.read_by and m.author_subject != viewer,
            read_by_other=any(r != m.author_subject for r in m.read_by),
            deleted=deleted,
            deleted_at=m.deleted_at,
            restorable_until=restorable_until if m.deleted_by == viewer else None,
        )

    def _views(self, thread: SupportThread, *, viewer: str) -> list[SupportMessageView]:
        return [self._view(m, viewer=viewer) for m in thread.messages]

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
            t = self._purge_expired(t)
            out.append(self._summary(t, viewer=principal.subject))
        out.sort(key=lambda t: t.last_message_at or t.updated_at, reverse=True)
        return out

    def get_thread(self, thread_id: str, *, principal: AuthPrincipal) -> SupportThreadDetail:
        thread = self._store.get_thread(thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        self._assert_access(thread, principal=principal)
        thread = self._purge_expired(thread)
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
        if payload.channel in {"radiologist", "clinic"}:
            recipient = (payload.recipient_subject or "").strip().lower() or None
            allowed = {
                r.subject
                for r in self.list_recipients(
                    principal=AuthPrincipal(
                        subject=subject, role=role if role in self.STARTER_ROLES else "vet",
                        via=principal.via, clinic_id=principal.clinic_id,
                    )
                )
                if r.channel == payload.channel
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
        self._publish(saved, {"type": "thread.created"})
        channel_label = {"radiologist": "radyolog", "clinic": "klinik"}.get(saved.channel, "yönetim")
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
        self._publish(
            saved,
            {
                "type": "message.created",
                "message": self._view(msg, viewer="").model_dump(mode="json")
                | {"unread": True},
            },
        )
        channel_label = {"radiologist": "radyolog", "clinic": "klinik"}.get(saved.channel, "yönetim")
        self._notify_recipients(
            saved,
            author=effective_subject,
            title=f"Yeni yanıt ({channel_label})",
            body=f"{saved.subject}: {msg.body}",
            message_id=msg.message_id,
        )
        return self._view(msg, viewer=effective_subject)

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
            self._publish(thread, {"type": "thread.read", "reader": viewer}, exclude=viewer)
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
    ) -> SupportThreadDetail:
        """Soft-delete one message. It can be restored for ``UNDO_WINDOW``, then its text is purged."""
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
        # Auth-off demo only: rows written before attribution worked belong to nobody.
        legacy_demo = principal.via == "disabled" and target.author_subject in LEGACY_DEMO_SUBJECTS
        if not is_author and not is_admin and not legacy_demo:
            raise HTTPException(status_code=403, detail="Only the author or an admin can delete this message.")
        if target.deleted_at is None:
            now = utcnow()
            msgs = [
                m.model_copy(update={"deleted_at": now, "deleted_by": subject}) if m.message_id == message_id else m
                for m in thread.messages
            ]
            thread = self._store.save_thread(thread.model_copy(update={"messages": msgs, "updated_at": now}))
            self._publish(thread, {"type": "message.deleted", "message_id": message_id})
        return SupportThreadDetail(
            thread=self._summary(thread, viewer=subject),
            messages=self._views(thread, viewer=subject),
        )

    def restore_message(
        self,
        thread_id: str,
        message_id: str,
        *,
        principal: AuthPrincipal,
        actor_subject: str | None = None,
        actor_role: str | None = None,
    ) -> SupportThreadDetail:
        """Undo a delete — only by whoever deleted it, and only inside ``UNDO_WINDOW``."""
        thread = self._store.get_thread(thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        subject, _role, _access = self._effective_actor(
            principal=principal,
            actor_subject=actor_subject,
            actor_role=actor_role,
            thread=thread,
        )
        thread = self._purge_expired(thread)
        target = next((m for m in thread.messages if m.message_id == message_id), None)
        if target is None:
            raise HTTPException(status_code=404, detail="Message not found.")
        if target.deleted_at is None:
            raise HTTPException(status_code=409, detail="Message is not deleted.")
        if target.deleted_by != subject:
            raise HTTPException(status_code=403, detail="Only the person who deleted this message can restore it.")
        if not target.body or utcnow() - target.deleted_at > self.UNDO_WINDOW:
            raise HTTPException(status_code=410, detail="The undo window has passed.")
        msgs = [
            m.model_copy(update={"deleted_at": None, "deleted_by": None}) if m.message_id == message_id else m
            for m in thread.messages
        ]
        thread = self._store.save_thread(thread.model_copy(update={"messages": msgs, "updated_at": utcnow()}))
        restored = next(m for m in thread.messages if m.message_id == message_id)
        self._publish(
            thread,
            {"type": "message.restored", "message": self._view(restored, viewer="").model_dump(mode="json")},
        )
        return SupportThreadDetail(
            thread=self._summary(thread, viewer=subject),
            messages=self._views(thread, viewer=subject),
        )

    def typing(
        self,
        thread_id: str,
        *,
        principal: AuthPrincipal,
        actor_subject: str | None = None,
        actor_role: str | None = None,
    ) -> None:
        """Tell the other participants that this user is typing (not stored)."""
        thread = self._store.get_thread(thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        subject, _role, _access = self._effective_actor(
            principal=principal,
            actor_subject=actor_subject,
            actor_role=actor_role,
            thread=thread,
        )
        self._publish(
            thread,
            {"type": "typing", "subject": subject, "name": self._display_name(subject)},
            exclude=subject,
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
            or (principal.via == "disabled" and thread.owner_subject in LEGACY_DEMO_SUBJECTS)
            or role in {"admin", "demo", "service"}
            or (thread.channel == "radiologist" and role == "expert" and thread.recipient_subject is None)
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Not allowed to delete this conversation.")
        self._store.delete_thread(thread_id)
        self._publish(thread, {"type": "thread.deleted"})
