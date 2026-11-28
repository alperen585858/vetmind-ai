from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.llm.interfaces import LLMProviderError
from app.schemas.case import (
    AiChatAsk,
    AiChatResponse,
    AiChatTurn,
    CaseMessage,
    CaseMessageCreate,
    CaseMessageView,
    CaseRecord,
)
from app.schemas.documents import CaseDocumentContext
from app.schemas.workflow import (
    AttachmentRef,
    CaseDocumentAttach,
    CaseNoteCreate,
    ClinicalNoteEntry,
    InfoRequest,
    InfoRequestCreate,
    InfoRequestReply,
)
from app.services.activity import append_activity
from app.services.host_bound import HostBound
from app.settings import Settings


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CaseCollaborationService(HostBound):
    """Case messages, AI chat, clinical notes, info requests, and document attach."""

    def list_messages(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[CaseMessageView]:
        case = self.get_case(case_id, principal=principal)
        subject = principal.subject if principal and principal.via != "disabled" else ""
        views: list[CaseMessageView] = []
        for m in case.messages:
            unread = bool(subject and subject not in m.read_by and m.author_id != subject)
            views.append(
                CaseMessageView(
                    message_id=m.message_id,
                    case_id=m.case_id or case.case_id,
                    author_id=m.author_id,
                    author_role=m.author_role,
                    body=m.body,
                    created_at=m.created_at,
                    unread=unread,
                )
            )
        return views

    def post_message(
        self,
        case_id: str,
        payload: CaseMessageCreate,
        *,
        principal: AuthPrincipal | None = None,
    ) -> CaseMessageView:
        case = self.get_case(case_id, principal=principal)
        author_id = principal.subject if principal and principal.via != "disabled" else "demo"
        author_role = principal.role if principal else "demo"
        msg = CaseMessage(
            case_id=case.case_id,
            author_id=author_id,
            author_role=author_role,
            body=payload.body.strip(),
            read_by=[author_id],
        )
        case.messages.append(msg)
        append_activity(case, kind="case_message", actor_subject=author_id, detail=msg.message_id)
        case.updated_at = _now()
        self._repo.save_case(case)
        self._emit_audit("case.message", principal=principal, resource=case_id)
        # Notify other authorized participants (not the author).
        recipients = {
            case.pet_owner_subject,
            case.owner_subject,
            case.assigned_reviewer_id,
        }
        # Clinic vets are notified via assigned/owner; also notify known vet subject if distinct.
        for recipient in recipients:
            if not recipient or recipient == author_id:
                continue
            self._notify(
                recipient_subject=recipient,
                kind="case_message",
                title="Yeni vaka mesajı",
                body=msg.body[:160],
                link_path=f"/vakalar/{case.case_id}",
                dedupe_key=f"case_message:{case.case_id}:{msg.message_id}:{recipient}",
                case_id=case.case_id,
                clinic_id=case.clinic_id,
            )
        return CaseMessageView(
            message_id=msg.message_id,
            case_id=msg.case_id,
            author_id=msg.author_id,
            author_role=msg.author_role,
            body=msg.body,
            created_at=msg.created_at,
            unread=False,
        )

    def mark_messages_read(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[CaseMessageView]:
        case = self.get_case(case_id, principal=principal)
        if principal is None or principal.via == "disabled":
            return self.list_messages(case_id, principal=principal)
        subject = principal.subject
        changed = False
        for m in case.messages:
            if m.author_id != subject and subject not in m.read_by:
                m.read_by.append(subject)
                changed = True
        if changed:
            case.updated_at = _now()
            self._repo.save_case(case)
        return self.list_messages(case_id, principal=principal)

    def list_ai_chat(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[AiChatTurn]:
        case = self.get_case(case_id, principal=principal)
        return list(case.ai_chat or [])

    def ask_ai_chat(
        self,
        case_id: str,
        payload: AiChatAsk,
        *,
        settings: Settings,
        principal: AuthPrincipal | None = None,
    ) -> AiChatResponse:
        """Radiologist Q&A over case context (ChatGPT-style). Caps history at 40 turns."""
        from app.llm.case_chat import answer_case_question

        case = self.get_case(case_id, principal=principal)
        author_id = principal.subject if principal and principal.via != "disabled" else "demo"
        history = list(case.ai_chat or [])
        try:
            reply, provider = answer_case_question(
                case,
                payload.message,
                history,
                settings,
                language=self._resolve_report_language(case, principal=principal),
            )
        except LLMProviderError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        user_turn = AiChatTurn(role="user", content=payload.message.strip(), author_id=author_id)
        assistant_turn = AiChatTurn(role="assistant", content=reply, author_id="vetmind-ai")
        # The model call can take a minute: reload and change only the chat, so an approval,
        # draft save or analysis result written meanwhile is not overwritten by a stale copy.
        with self._lock:
            latest = self.get_case(case_id, principal=principal)
            history = [*(latest.ai_chat or []), user_turn, assistant_turn]
            # Bound growth for SQLite rows / demo DB size.
            if len(history) > 40:
                history = history[-40:]
            latest.ai_chat = history
            latest.updated_at = _now()
            append_activity(latest, kind="ai_chat", actor_subject=author_id, detail=f"{len(payload.message)} chars")
            self._repo.save_case(latest)
        self._emit_audit("case.ai_chat", principal=principal, resource=case_id)
        return AiChatResponse(
            case_id=case.case_id,
            reply=reply,
            history=history,
            provider=provider,
        )

    def clear_ai_chat(
        self, case_id: str, *, principal: AuthPrincipal | None = None
    ) -> list[AiChatTurn]:
        with self._lock:
            case = self.get_case(case_id, principal=principal)
            case.ai_chat = []
            case.updated_at = _now()
            self._repo.save_case(case)
        self._emit_audit("case.ai_chat.clear", principal=principal, resource=case_id)
        return []

    def _note_author_name(self, subject: str | None) -> str | None:
        """Name to show next to a note: the user's own display name (Settings), else the
        directory name; None when only the e-mail prefix is known (the UI falls back)."""
        if not subject or subject == "anonymous":
            return None
        fallback = subject.split("@")[0]
        candidates: list[object] = []
        store = getattr(self, "_user_settings", None)
        lookup = getattr(store, "get_stored", None) if store is not None else None
        if lookup is not None:
            try:
                candidates.append(getattr(lookup(subject), "display_name", None))
            except Exception:  # noqa: BLE001 — display only, never blocks the note
                pass
        directory = getattr(self, "_workflow_store", None)
        if directory is not None and hasattr(directory, "get_user"):
            try:
                candidates.append(getattr(directory.get_user(subject), "display_name", None))
            except Exception:  # noqa: BLE001 — display only
                pass
        for name in candidates:
            if isinstance(name, str) and name.strip() and name.strip() != fallback:
                return name.strip()[:120]
        return None

    def append_clinical_note(
        self, case_id: str, payload: CaseNoteCreate, *, principal: AuthPrincipal
    ) -> CaseRecord:
        if principal.role not in {"vet", "clinic_owner", "admin", "demo", "service", "expert"} and principal.via != "disabled":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
        case = self.get_case(case_id, principal=principal)
        entry = ClinicalNoteEntry(
            body=payload.body.strip(),
            author_subject=principal.subject,
            author_role=principal.role,
            author_name=self._note_author_name(principal.subject),
            kind="clinical",
        )
        # Notes stay a separate list (#68): the free-text history is not touched, so the
        # complaint / history fields never show a raw "[<time> · <subject>]" stamp. Models
        # read the notes as their own section (app.llm.clinical_notes).
        case.clinical_notes_log = [*case.clinical_notes_log, entry]
        append_activity(case, kind="clinical_note", actor_subject=principal.subject, detail=entry.note_id)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        recipients = {r for r in [saved.assigned_reviewer_id, saved.owner_subject] if r}
        for recipient in recipients:
            if recipient == principal.subject:
                continue
            self._notify(
                recipient_subject=recipient,
                kind="clinical_history_updated",
                title="Klinik not eklendi",
                body=entry.body[:200],
                link_path=f"/vakalar/{saved.case_id}",
                dedupe_key=f"clinical_history_updated:{saved.case_id}:{entry.note_id}:{recipient}",
                case_id=saved.case_id,
                clinic_id=saved.clinic_id,
            )
        return saved

    def append_internal_note(
        self, case_id: str, payload: CaseNoteCreate, *, principal: AuthPrincipal
    ) -> CaseRecord:
        if principal.role not in {"expert", "admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Internal notes are for radiologists.")
        case = self.get_case(case_id, principal=principal)
        entry = ClinicalNoteEntry(
            body=payload.body.strip(),
            author_subject=principal.subject,
            author_role=principal.role,
            author_name=self._note_author_name(principal.subject),
            kind="internal",
        )
        case.internal_notes = [*case.internal_notes, entry]
        append_activity(case, kind="internal_note", actor_subject=principal.subject, detail=entry.note_id)
        case.updated_at = _now()
        return self._repo.save_case(case)

    def create_info_request(
        self, case_id: str, payload: InfoRequestCreate, *, principal: AuthPrincipal
    ) -> CaseRecord:
        if principal.role not in {"expert", "vet", "clinic_owner", "admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
        case = self.get_case(case_id, principal=principal)
        to_role = payload.to_role
        irq = InfoRequest(
            status="OPEN",
            from_role=principal.role,
            from_subject=principal.subject,
            to_role=to_role,
            body=payload.body.strip(),
        )
        case.info_requests = [*case.info_requests, irq]
        append_activity(case, kind="info_request_opened", actor_subject=principal.subject, detail=irq.request_id)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        recipients: set[str] = set()
        if to_role == "vet":
            if saved.owner_subject:
                recipients.add(saved.owner_subject)
            recipients.add("vet@demo.local")
        elif to_role == "expert":
            if saved.assigned_reviewer_id:
                recipients.add(saved.assigned_reviewer_id)
            elif saved.draft_report and saved.draft_report.reviewed_by:
                recipients.add(saved.draft_report.reviewed_by)
        for recipient in recipients:
            if recipient == principal.subject:
                continue
            self._notify(
                recipient_subject=recipient,
                kind="info_request_opened",
                title="Bilgi isteği",
                body=irq.body[:200],
                link_path=f"/vakalar/{saved.case_id}",
                dedupe_key=f"info_request_opened:{saved.case_id}:{irq.request_id}:{recipient}",
                case_id=saved.case_id,
                clinic_id=saved.clinic_id,
            )
        return saved

    def reply_info_request(
        self,
        case_id: str,
        request_id: str,
        payload: InfoRequestReply,
        *,
        principal: AuthPrincipal,
    ) -> CaseRecord:
        case = self.get_case(case_id, principal=principal)
        found = False
        updated: list[InfoRequest] = []
        for irq in case.info_requests:
            if irq.request_id == request_id:
                if irq.status == "CLOSED":
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Info request is closed.")
                found = True
                updated.append(
                    irq.model_copy(
                        update={
                            "status": "ANSWERED",
                            "reply": payload.reply.strip(),
                            "answered_at": _now(),
                        }
                    )
                )
            else:
                updated.append(irq)
        if not found:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Info request not found.")
        case.info_requests = updated
        append_activity(case, kind="info_request_answered", actor_subject=principal.subject, detail=request_id)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        # Notify original requester
        for irq in saved.info_requests:
            if irq.request_id == request_id:
                self._notify(
                    recipient_subject=irq.from_subject,
                    kind="info_request_answered",
                    title="Bilgi isteği yanıtlandı",
                    body=payload.reply[:200],
                    link_path=f"/vakalar/{saved.case_id}",
                    dedupe_key=f"info_request_answered:{saved.case_id}:{request_id}",
                    case_id=saved.case_id,
                    clinic_id=saved.clinic_id,
                )
                break
        return saved

    def close_info_request(
        self, case_id: str, request_id: str, *, principal: AuthPrincipal
    ) -> CaseRecord:
        if principal.role not in {"vet", "expert", "clinic_owner", "admin", "demo", "service"} and principal.via != "disabled":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
        case = self.get_case(case_id, principal=principal)
        found = False
        updated: list[InfoRequest] = []
        target_from: str | None = None
        for irq in case.info_requests:
            if irq.request_id == request_id:
                found = True
                target_from = irq.from_subject
                updated.append(irq.model_copy(update={"status": "CLOSED", "closed_at": _now()}))
            else:
                updated.append(irq)
        if not found:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Info request not found.")
        case.info_requests = updated
        append_activity(case, kind="info_request_closed", actor_subject=principal.subject, detail=request_id)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        if target_from:
            self._notify(
                recipient_subject=target_from,
                kind="info_request_closed",
                title="Bilgi isteği kapatıldı",
                body=f"Vaka {saved.case_id}",
                link_path=f"/vakalar/{saved.case_id}",
                dedupe_key=f"info_request_closed:{saved.case_id}:{request_id}",
                case_id=saved.case_id,
                clinic_id=saved.clinic_id,
            )
        return saved

    def attach_document_ingest(
        self,
        case_id: str,
        payload: CaseDocumentAttach,
        *,
        principal: AuthPrincipal,
        documents_svc: object | None = None,
    ) -> CaseRecord:
        """Bind a quarantined document ingest to an existing case (never creates a new case)."""
        if principal.role not in {"vet", "clinic_owner", "admin", "demo", "service", "expert"} and principal.via != "disabled":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
        case = self.get_case(case_id, principal=principal)
        if documents_svc is None:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Document service unavailable.")
        record = documents_svc.get_ingestion(payload.ingest_id, principal=principal)  # type: ignore[attr-defined]
        if record.blocked:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=record.block_reason or "Blocked ingest.")
        if record.accepted and record.case_id and record.case_id != case_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Document already linked to case {record.case_id}.",
            )
        # Merge into document_context without creating a case.
        new_docs = list(record.documents)
        if case.document_context is None:
            combined_parts = [
                f"--- {d.filename} ({d.content_kind.value}) ---\n{(d.extracted_text or '').strip()}"
                for d in new_docs
            ]
            combined = "\n\n".join(p for p in combined_parts if p.strip())
            case.document_context = CaseDocumentContext(
                document_ingest_id=record.ingest_id,
                documents=new_docs,
                combined_text_preview=(combined[:4000] + ("…[truncated]" if len(combined) > 4000 else "")) or None,
            )
        else:
            ctx = case.document_context
            if record.ingest_id != ctx.document_ingest_id and record.ingest_id not in ctx.additional_ingest_ids:
                ctx.additional_ingest_ids = [*ctx.additional_ingest_ids, record.ingest_id]
            # Deduplicate by filename+path
            existing_paths = {d.quarantine_relative_path for d in ctx.documents}
            for d in new_docs:
                if d.quarantine_relative_path not in existing_paths:
                    ctx.documents.append(d)
            combined_parts = [
                f"--- {d.filename} ({d.content_kind.value}) ---\n{(d.extracted_text or '').strip()}"
                for d in ctx.documents
            ]
            combined = "\n\n".join(p for p in combined_parts if p.strip())
            ctx.combined_text_preview = (combined[:4000] + ("…[truncated]" if len(combined) > 4000 else "")) or None
            case.document_context = ctx
        att = AttachmentRef(
            kind="document",
            ingest_id=record.ingest_id,
            uploaded_by=principal.subject,
        )
        if att.ingest_id not in {a.ingest_id for a in case.attachment_refs}:
            case.attachment_refs = [*case.attachment_refs, att]
        record.accepted = True
        record.case_id = case.case_id
        documents_svc._repo.save_document_ingestion(record)  # type: ignore[attr-defined]  # noqa: SLF001
        append_activity(case, kind="document_attached", actor_subject=principal.subject, detail=record.ingest_id)
        case.updated_at = _now()
        saved = self._repo.save_case(case)
        self._notify(
            recipient_subject=saved.assigned_reviewer_id,
            kind="attachment_added",
            title="Belge eklendi",
            body=f"Vaka {saved.case_id}",
            link_path=f"/vakalar/{saved.case_id}",
            dedupe_key=f"attachment_added:{saved.case_id}:{record.ingest_id}",
            case_id=saved.case_id,
            clinic_id=saved.clinic_id,
        )
        return saved

