"""Support messaging API — owner ↔ radiologist / admin."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth, require_capability
from app.auth.rbac import CAP_MESSAGES
from app.container import AppContainer
from app.schemas.messaging import (
    SupportMessageCreate,
    SupportMessageView,
    SupportThreadCreate,
    SupportThreadDetail,
    SupportThreadSummary,
)

router = APIRouter(prefix="/api/v1/messages", tags=["messages"], dependencies=[Depends(require_auth)])

_ALLOWED_DEMO_ROLES = frozenset({"owner", "expert", "admin", "vet", "clinic_owner"})


def _messaging(container: AppContainer = Depends(get_container)):
    return container.messaging


def _demo_actor(request: Request, principal: AuthPrincipal) -> tuple[str | None, str | None]:
    """When auth is off, honor FE demo identity headers for correct attribution."""
    if principal.via != "disabled":
        return None, None
    role = (request.headers.get("X-VetMind-Demo-Role") or "").strip().lower()
    subject = (request.headers.get("X-VetMind-Demo-Subject") or "").strip().lower()
    if role not in _ALLOWED_DEMO_ROLES:
        role = ""
    if role and not subject:
        if role == "clinic_owner":
            subject = "clinic-owner@demo.local"
        else:
            subject = f"{role}@demo.local"
    return (subject or None), (role or None)


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
