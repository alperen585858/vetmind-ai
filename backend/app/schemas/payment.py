"""Demo-only payment intents for imaging submissions.

Never stores card numbers, expiry, or CVV. Not a real financial transaction.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

PaymentStatus = Literal["requires_confirmation", "approved", "failed"]
PaymentMode = Literal["demo"]

DEMO_IMAGING_AMOUNT = 100
DEMO_IMAGING_CURRENCY = "EUR"

# Predefined test card — accepted only by the demo simulator.
DEMO_CARD_NUMBER = "4242424242424242"
DEMO_CARD_EXPIRY = "12/34"
DEMO_CARD_CVC = "123"
# Declined test card — simulates failure without a real gateway.
DEMO_DECLINE_CARD_NUMBER = "4000000000000002"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DemoPayment(BaseModel):
    """Authoritative demo payment record (no card PAN/CVV/expiry stored)."""

    model_config = ConfigDict(extra="forbid")

    payment_id: str = Field(default_factory=lambda: f"pay-{uuid4().hex[:12]}")
    submission_id: str = Field(min_length=1, max_length=80)
    amount: int = Field(default=DEMO_IMAGING_AMOUNT, ge=1)
    currency: Literal["EUR"] = "EUR"
    mode: PaymentMode = "demo"
    status: PaymentStatus = "requires_confirmation"
    owner_subject: str = Field(min_length=1, max_length=120)
    clinic_id: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    approved_at: Optional[datetime] = None
    # Tenancy helper alias
    owner_subject_alias: Optional[str] = None


class DemoPaymentIntentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submission_id: str = Field(min_length=1, max_length=80)


class DemoPaymentConfirmRequest(BaseModel):
    """Demo card fields are validated then discarded — never persisted or audited."""

    model_config = ConfigDict(extra="forbid")

    card_number: str = Field(min_length=12, max_length=23)
    expiry: str = Field(min_length=4, max_length=7)
    cvc: str = Field(min_length=3, max_length=4)


class DemoPaymentConfirmResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payment: DemoPayment
    message: str
    submission_finalized: bool = False
    submission_id: Optional[str] = None
    submission_status: Optional[str] = None
