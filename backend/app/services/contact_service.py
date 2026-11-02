"""Public contact form → founder inbox."""

from __future__ import annotations

from fastapi import HTTPException, status

from app.auth.principal import AuthPrincipal
from app.schemas.contact import (
    ContactInquiry,
    ContactInquiryCreate,
    ContactInquiryPublicReceipt,
    ContactInquiryUpdate,
    utcnow,
)
from app.security.audit import AuditLogger, AuditOutcome
from app.services.contact_store import ContactStore


class ContactService:
    def __init__(self, store: ContactStore, *, audit: AuditLogger | None = None) -> None:
        self._store = store
        self._audit = audit

    def _require_founder(self, principal: AuthPrincipal) -> None:
        if principal.via == "disabled":
            return
        if principal.role != "founder":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Founder only.")

    def create_public(self, payload: ContactInquiryCreate) -> ContactInquiryPublicReceipt:
        phone = payload.phone.strip() if payload.phone and payload.phone.strip() else None
        organization = (
            payload.organization.strip()
            if payload.organization and payload.organization.strip()
            else None
        )
        inquiry = ContactInquiry(
            name=payload.name.strip(),
            email=payload.email.strip().lower(),
            phone=phone,
            organization=organization,
            topic=payload.topic,
            message=payload.message.strip(),
            status="new",
        )
        self._store.save(inquiry)
        if self._audit is not None:
            self._audit.record(
                event_type="contact.inquiry.create",
                actor=inquiry.email,
                resource=f"/public/contact/{inquiry.inquiry_id}",
                outcome=AuditOutcome.SUCCESS,
                detail=inquiry.topic,
            )
        return ContactInquiryPublicReceipt(inquiry_id=inquiry.inquiry_id)

    def list_inquiries(self, *, principal: AuthPrincipal) -> list[ContactInquiry]:
        self._require_founder(principal)
        return self._store.list()

    def update_inquiry(
        self,
        inquiry_id: str,
        payload: ContactInquiryUpdate,
        *,
        principal: AuthPrincipal,
    ) -> ContactInquiry:
        self._require_founder(principal)
        existing = self._store.get(inquiry_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Inquiry not found.")
        updated = existing.model_copy(
            update={"status": payload.status, "updated_at": utcnow()},
        )
        self._store.save(updated)
        if self._audit is not None:
            actor = principal.subject if principal.via != "disabled" else "demo"
            self._audit.record(
                event_type="contact.inquiry.update",
                actor=actor,
                resource=f"/founder/contact/{inquiry_id}",
                outcome=AuditOutcome.SUCCESS,
                detail=payload.status,
            )
        return updated

    def new_count(self, *, principal: AuthPrincipal) -> int:
        self._require_founder(principal)
        return sum(1 for i in self._store.list() if i.status == "new")
