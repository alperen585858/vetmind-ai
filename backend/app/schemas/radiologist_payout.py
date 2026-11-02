"""Radiologist payout ledger — fixed fee per approved case (demo accounting only)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

PayoutStatus = Literal["owed", "paid"]

# Fixed radiologist fee per approved case (demo). Owner intake is separate (100 EUR).
RADIOLOGIST_CASE_FEE = 40
RADIOLOGIST_CASE_CURRENCY = "EUR"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RadiologistCasePayout(BaseModel):
    """One ledger row per approved case — idempotent on case_id."""

    model_config = ConfigDict(extra="forbid")

    payout_id: str = Field(default_factory=lambda: f"rpay-{uuid4().hex[:12]}")
    case_id: str = Field(min_length=1, max_length=80)
    radiologist_subject: str = Field(min_length=1, max_length=120)
    amount: int = Field(default=RADIOLOGIST_CASE_FEE, ge=1)
    currency: Literal["EUR"] = "EUR"
    status: PayoutStatus = "owed"
    approved_at: datetime = Field(default_factory=utcnow)
    paid_at: Optional[datetime] = None
    marked_paid_by: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class RadiologistPayoutSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    radiologist_subject: str
    display_name: Optional[str] = None
    active: bool = True
    approved_cases: int = 0
    unpaid_cases: int = 0
    paid_cases: int = 0
    amount_owed: int = 0
    amount_paid: int = 0
    fee_per_case: int = RADIOLOGIST_CASE_FEE
    currency: Literal["EUR"] = "EUR"


class RadiologistPayoutLedger(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fee_per_case: int = RADIOLOGIST_CASE_FEE
    currency: Literal["EUR"] = "EUR"
    radiologists: list[RadiologistPayoutSummary] = Field(default_factory=list)
    total_unpaid_cases: int = 0
    total_amount_owed: int = 0


class RadiologistPayoutDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: RadiologistPayoutSummary
    payouts: list[RadiologistCasePayout] = Field(default_factory=list)


class MarkRadiologistPaidRequest(BaseModel):
    """Mark owed cases as paid. Empty case_ids → all currently owed for that radiologist."""

    model_config = ConfigDict(extra="forbid")

    case_ids: Optional[list[str]] = None


class RadiologistPayoutSettings(BaseModel):
    """Persisted admin fee config (applies to new approvals + unpaid rows when updated)."""

    model_config = ConfigDict(extra="forbid")

    fee_per_case: int = Field(default=RADIOLOGIST_CASE_FEE, ge=1, le=100_000)
    currency: Literal["EUR"] = "EUR"
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None


class RadiologistPayoutSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fee_per_case: int = Field(ge=1, le=100_000)
    # When true (default), rewrite amount on all currently owed rows to the new fee.
    apply_to_unpaid: bool = True
