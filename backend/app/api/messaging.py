"""Messaging API — clinic staff ↔ radiologist / support team."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.api.deps import get_container, get_messaging_facade
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_MESSAGES
from app.schemas.messaging import (
    MessageRecipient,
    SupportMessageCreate,
    SupportMessageView,
    SupportThreadCreate,
    SupportThreadDetail,
    SupportThreadSummary,
)
from app.services.live_events import StreamIdentity, event_stream
from app.services.messaging_facade import MessagingFacade

router = APIRouter(prefix="/api/v1/messages", tags=["messages"], dependencies=[Depends(require_auth)])
# The SSE stream authenticates with a single-use ticket (EventSource cannot send headers).
live_router = APIRouter(prefix="/api/v1/live", tags=["live"])

_ALLOWED_DEMO_ROLES = frozenset({"expert", "admin", "vet", "clinic_owner"})


def _messaging(facade: MessagingFacade = Depends(get_messaging_facade)):
    return facade.support


def _jwt_identity(request: Request) -> tuple[str | None, str | None]:
    """Subject/role from a valid Bearer JWT (signature + token version checked), else None."""
    header = request.headers.get("Authorization") or ""
    if not header.lower().startswith("bearer "):
        return None, None
    try:
        from app.auth.security import decode_token, resolve_jwt_identity

        auth = get_container(request).auth
        payload = decode_token(header.split(" ", 1)[1].strip(), auth.jwt_secret)
        subject, role, _clinic = resolve_jwt_identity(payload, auth.users)
    except Exception:  # noqa: BLE001 — invalid/expired token → no identity
        return None, None
    if role not in _ALLOWED_DEMO_ROLES:
        return None, None
    return subject, role


def _demo_actor(request: Request, principal: AuthPrincipal) -> tuple[str | None, str | None]:
    """When auth is off, honor FE demo identity headers for correct attribution."""
    if principal.via != "disabled":
        return None, None
    role = (request.headers.get("X-VetMind-Demo-Role") or "").strip().lower()
    subject = (request.headers.get("X-VetMind-Demo-Subject") or "").strip().lower()
    if not role:
        # Signed-in browser with auth off: the client sends its JWT instead of demo
        # headers. Use the verified token identity so messages are attributed correctly.
        jwt_subject, jwt_role = _jwt_identity(request)
        if jwt_subject:
            return jwt_subject, jwt_role
    if role not in _ALLOWED_DEMO_ROLES:
        role = ""
    if role and not subject:
        if role == "clinic_owner":
            subject = "clinic-owner@demo.local"
        else:
            subject = f"{role}@demo.local"
    return (subject or None), (role or None)


@router.get("/recipients", response_model=list[MessageRecipient])
def list_recipients(
    request: Request,
    q: str | None = Query(default=None, max_length=120),
    principal: AuthPrincipal = Depends(require_capability(CAP_MESSAGES)),
    service=Depends(_messaging),
) -> list[MessageRecipient]:
    """People the caller may start a conversation with (own-clinic radiologists + support)."""
    subject, role = _demo_actor(request, principal)
    if subject and role:
        from app.auth.principal import AuthPrincipal as AP

        principal = AP(subject=subject, role=role, via="disabled", clinic_id=principal.clinic_id)
    return service.list_recipients(principal=principal, query=q)


@router.get("/threads", response_model=list[SupportThreadSummary])
def list_threads(
    request: Request,
    principal: AuthPrincipal = Depends(require_capability(CAP_MESSAGES)),
    service=Depends(_messaging),
) -> list[SupportThreadSummary]:
    subject, role = _demo_actor(request, principal)
    if subject and role:
        from app.auth.principal import AuthPrincipal as AP

        return service.list_threads(
            principal=AP(subject=subject, role=role, via="disabled", clinic_id=principal.clinic_id)
        )
    return service.list_threads(principal=principal)


@router.post("/threads", response_model=SupportThreadDetail, status_code=status.HTTP_201_CREATED)
def create_thread(
    payload: SupportThreadCreate,
    request: Request,
    principal: AuthPrincipal = Depends(require_capability(CAP_MESSAGES)),
    service=Depends(_messaging),
) -> SupportThreadDetail:
    subject, role = _demo_actor(request, principal)
    return service.create_thread(
        payload, principal=principal, actor_subject=subject, actor_role=role
    )


@router.get("/threads/{thread_id}", response_model=SupportThreadDetail)
def get_thread(
    thread_id: str,
    request: Request,
    principal: AuthPrincipal = Depends(require_capability(CAP_MESSAGES)),
    service=Depends(_messaging),
) -> SupportThreadDetail:
    subject, role = _demo_actor(request, principal)
    if subject and role:
        from app.auth.principal import AuthPrincipal as AP

        return service.get_thread(
            thread_id,
            principal=AP(subject=subject, role=role, via="disabled", clinic_id=principal.clinic_id),
        )
    return service.get_thread(thread_id, principal=principal)


@router.post("/threads/{thread_id}/messages", response_model=SupportMessageView)
def post_message(
    thread_id: str,
    payload: SupportMessageCreate,
    request: Request,
    principal: AuthPrincipal = Depends(require_capability(CAP_MESSAGES)),
    service=Depends(_messaging),
) -> SupportMessageView:
    subject, role = _demo_actor(request, principal)
    return service.post_message(
        thread_id,
        payload,
        principal=principal,
        actor_subject=subject,
        actor_role=role,
    )


@router.post("/threads/{thread_id}/read", response_model=SupportThreadDetail)
def mark_thread_read(
    thread_id: str,
    request: Request,
    principal: AuthPrincipal = Depends(require_capability(CAP_MESSAGES)),
    service=Depends(_messaging),
) -> SupportThreadDetail:
    subject, role = _demo_actor(request, principal)
    if subject and role:
        from app.auth.principal import AuthPrincipal as AP

        return service.mark_read(
            thread_id,
            principal=AP(subject=subject, role=role, via="disabled", clinic_id=principal.clinic_id),
        )
    return service.mark_read(thread_id, principal=principal)


@router.delete(
    "/threads/{thread_id}/messages/{message_id}",
    response_model=SupportThreadDetail,
    responses={204: {"description": "Message deleted and conversation removed (was last message)"}},
)
def delete_message(
    thread_id: str,
    message_id: str,
    request: Request,
    response: Response,
    principal: AuthPrincipal = Depends(require_capability(CAP_MESSAGES)),
    service=Depends(_messaging),
) -> SupportThreadDetail | Response:
    subject, role = _demo_actor(request, principal)
    detail = service.delete_message(
        thread_id,
        message_id,
        principal=principal,
        actor_subject=subject,
        actor_role=role,
    )
    if detail is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return detail


@router.delete(
    "/threads/{thread_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_thread(
    thread_id: str,
    request: Request,
    principal: AuthPrincipal = Depends(require_capability(CAP_MESSAGES)),
    service=Depends(_messaging),
) -> Response:
    subject, role = _demo_actor(request, principal)
    service.delete_thread(
        thread_id,
        principal=principal,
        actor_subject=subject,
        actor_role=role,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/threads/{thread_id}/messages/{message_id}/restore", response_model=SupportThreadDetail)
def restore_message(
    thread_id: str,
    message_id: str,
    request: Request,
    principal: AuthPrincipal = Depends(require_capability(CAP_MESSAGES)),
    service=Depends(_messaging),
) -> SupportThreadDetail:
    """Undo a delete (only the person who deleted it, within the undo window)."""
    subject, role = _demo_actor(request, principal)
    return service.restore_message(
        thread_id, message_id, principal=principal, actor_subject=subject, actor_role=role
    )


@router.post("/threads/{thread_id}/typing", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def typing(
    thread_id: str,
    request: Request,
    principal: AuthPrincipal = Depends(require_capability(CAP_MESSAGES)),
    service=Depends(_messaging),
) -> Response:
    subject, role = _demo_actor(request, principal)
    service.typing(thread_id, principal=principal, actor_subject=subject, actor_role=role)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class StreamTicket(BaseModel):
    ticket: str
    expires_in: int


@router.post("/stream-ticket", response_model=StreamTicket)
def stream_ticket(
    request: Request,
    principal: AuthPrincipal = Depends(require_capability(CAP_MESSAGES)),
) -> StreamTicket:
    """Single-use ticket (60 s) for opening the live event stream."""
    container = get_container(request)
    subject, role = _demo_actor(request, principal)
    identity = StreamIdentity(
        subject=(subject or principal.subject).strip().lower(),
        role=role or principal.role,
        clinic_id=principal.clinic_id,
    )
    tickets = container.stream_tickets
    return StreamTicket(ticket=tickets.issue(identity), expires_in=tickets.ttl_seconds)


@live_router.get("/stream")
async def live_stream(request: Request, ticket: str = Query(min_length=8, max_length=200)) -> StreamingResponse:
    """Server-Sent Events for the signed-in user: new messages, delete/undo, read, typing,
    notifications. Open with a ticket from ``POST /api/v1/messages/stream-ticket``."""
    container = get_container(request)
    identity = container.stream_tickets.consume(ticket)
    if identity is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired stream ticket.")
    return StreamingResponse(
        event_stream(container.live_events, identity.subject, is_disconnected=request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
