"""Unified messaging domain: support threads and case-scoped chat.

HTTP routers keep their existing paths. This facade is the single object
callers use instead of reaching into ``container.messaging`` and
``container.collaboration`` separately.
"""

from __future__ import annotations

from app.auth.principal import AuthPrincipal
from app.schemas.case import (
    AiChatAsk,
    AiChatResponse,
    AiChatTurn,
    CaseMessageCreate,
    CaseMessageView,
)
from app.schemas.messaging import (
    SupportMessageCreate,
    SupportMessageView,
    SupportThreadCreate,
    SupportThreadDetail,
    SupportThreadSummary,
)
from app.services.case_collaboration import CaseCollaborationService
from app.services.messaging_service import MessagingService
from app.settings import Settings


class MessagingFacade:
    def __init__(
        self,
        support: MessagingService,
        collaboration: CaseCollaborationService,
    ) -> None:
        self.support = support
        self.cases = collaboration

    def list_threads(self, *, principal: AuthPrincipal) -> list[SupportThreadSummary]:
        return self.support.list_threads(principal=principal)

    def get_thread(self, thread_id: str, *, principal: AuthPrincipal) -> SupportThreadDetail:
        return self.support.get_thread(thread_id, principal=principal)

    def create_thread(
        self,
        payload: SupportThreadCreate,
        *,
        principal: AuthPrincipal,
        actor_subject: str | None = None,
        actor_role: str | None = None,
    ) -> SupportThreadDetail:
        return self.support.create_thread(
            payload,
            principal=principal,
            actor_subject=actor_subject,
            actor_role=actor_role,
        )

    def post_support_message(
        self,
        thread_id: str,
        payload: SupportMessageCreate,
        *,
        principal: AuthPrincipal,
        actor_subject: str | None = None,
        actor_role: str | None = None,
    ) -> SupportMessageView:
        return self.support.post_message(
            thread_id,
            payload,
            principal=principal,
            actor_subject=actor_subject,
            actor_role=actor_role,
        )

    def mark_thread_read(self, thread_id: str, *, principal: AuthPrincipal) -> SupportThreadDetail:
        return self.support.mark_read(thread_id, principal=principal)

    def delete_support_message(
        self,
        thread_id: str,
        message_id: str,
        *,
        principal: AuthPrincipal,
        actor_subject: str | None = None,
        actor_role: str | None = None,
    ) -> SupportThreadDetail | None:
        return self.support.delete_message(
            thread_id,
            message_id,
            principal=principal,
            actor_subject=actor_subject,
            actor_role=actor_role,
        )

    def delete_thread(
        self,
        thread_id: str,
        *,
        principal: AuthPrincipal,
        actor_subject: str | None = None,
        actor_role: str | None = None,
    ) -> None:
        self.support.delete_thread(
            thread_id,
            principal=principal,
            actor_subject=actor_subject,
            actor_role=actor_role,
        )

    def list_case_messages(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[CaseMessageView]:
        return self.cases.list_messages(case_id, principal=principal)

    def post_case_message(
        self,
        case_id: str,
        payload: CaseMessageCreate,
        *,
        principal: AuthPrincipal | None = None,
    ) -> CaseMessageView:
        return self.cases.post_message(case_id, payload, principal=principal)

    def mark_case_messages_read(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[CaseMessageView]:
        return self.cases.mark_messages_read(case_id, principal=principal)

    def list_ai_chat(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[AiChatTurn]:
        return self.cases.list_ai_chat(case_id, principal=principal)

    def ask_ai_chat(
        self,
        case_id: str,
        payload: AiChatAsk,
        *,
        settings: Settings,
        principal: AuthPrincipal | None = None,
    ) -> AiChatResponse:
        return self.cases.ask_ai_chat(case_id, payload, settings=settings, principal=principal)

    def clear_ai_chat(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[AiChatTurn]:
        return self.cases.clear_ai_chat(case_id, principal=principal)
