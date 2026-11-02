"""Public contact form + founder inbox for license / partnership inquiries."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_container
from app.auth.deps import AuthPrincipal, require_auth, require_exact_roles
from app.container import AppContainer
from app.schemas.contact import (
    ContactInquiry,
    ContactInquiryCreate,
    ContactInquiryPublicReceipt,
    ContactInquiryUpdate,
)

public_router = APIRouter(prefix="/api/v1/public", tags=["public-contact"])
founder_router = APIRouter(
    prefix="/api/v1/founder/contact-inquiries",
    tags=["founder-contact"],
    dependencies=[Depends(require_auth), Depends(require_exact_roles("founder"))],
)


def _svc(container: AppContainer = Depends(get_container)):
    return container.contact


@public_router.post("/contact", response_model=ContactInquiryPublicReceipt, status_code=201)
def submit_contact(
    payload: ContactInquiryCreate,
    service=Depends(_svc),
) -> ContactInquiryPublicReceipt:
    """Unauthenticated landing-page form — anyone can write to the founder."""
    return service.create_public(payload)


@founder_router.get("", response_model=list[ContactInquiry])
def list_contact_inquiries(
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> list[ContactInquiry]:
    return service.list_inquiries(principal=principal)


@founder_router.get("/new-count")
def contact_new_count(
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> dict[str, int]:
    return {"new_count": service.new_count(principal=principal)}


@founder_router.patch("/{inquiry_id}", response_model=ContactInquiry)
def update_contact_inquiry(
    inquiry_id: str,
    payload: ContactInquiryUpdate,
    principal: AuthPrincipal = Depends(require_auth),
    service=Depends(_svc),
) -> ContactInquiry:
    return service.update_inquiry(inquiry_id, payload, principal=principal)
