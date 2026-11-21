"""Narrow constructor ports for services that used to be late-bound."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol


class PayoutPort(Protocol):
    """Ledger write used when a radiologist approves a case."""

    def record_approval(
        self,
        *,
        case_id: str,
        radiologist_subject: str,
        approved_at: datetime | None = None,
    ) -> object: ...


class OwnerDeliveryPort(Protocol):
    """SMTP and magic-link dependencies for non-member pet-owner delivery."""

    mailer: object | None
    report_view_tokens: object | None
    auth_users: dict | None
    workflow_store: object | None
    smtp_configured: bool
    public_base_url: str


class OwnerDelivery:
    """Concrete bundle passed into CaseService. Satisfies OwnerDeliveryPort."""

    def __init__(
        self,
        *,
        mailer: object | None,
        report_view_tokens: object | None,
        auth_users: dict | None,
        workflow_store: object | None,
        smtp_configured: bool,
        public_base_url: str,
    ) -> None:
        self.mailer = mailer
        self.report_view_tokens = report_view_tokens
        self.auth_users = auth_users
        self.workflow_store = workflow_store
        self.smtp_configured = bool(smtp_configured)
        self.public_base_url = (public_base_url or "http://127.0.0.1:5173").rstrip("/")


class PaymentPort(Protocol):
    """Submission finalization only needs an approved-payment check."""

    def assert_approved_for_submission(self, submission_id: str) -> object: ...
