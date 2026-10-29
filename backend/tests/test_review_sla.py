"""Expert response SLA: 24h urgent/STAT, 48h otherwise."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, CaseLifecycleStatus, Modality, Species
from app.review_sla import (
    WARN_WITHIN_HOURS,
    apply_review_sla,
    clear_review_sla,
    remaining_seconds,
    sla_hours_for,
)


def _case(**kwargs) -> CaseRecord:
    base = dict(
        case_id="case-sla-1",
        patient_name="Test",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.CERVICAL,
        status=CaseLifecycleStatus.AWAITING_REVIEW,
        priority="normal",
    )
    base.update(kwargs)
    return CaseRecord(**base)


def test_sla_hours_by_priority():
    assert sla_hours_for("stat") == 24
    assert sla_hours_for("urgent") == 24
    assert sla_hours_for("high") == 48
    assert sla_hours_for("normal") == 48


def test_apply_sets_24h_for_urgent():
    now = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
    case = _case(priority="urgent")
    assert apply_review_sla(case, now=now) is True
    assert case.awaiting_review_since == now
    assert case.review_due_at == now + timedelta(hours=24)


def test_apply_sets_48h_for_normal():
    now = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
    case = _case(priority="normal")
    apply_review_sla(case, now=now)
    assert case.review_due_at == now + timedelta(hours=48)


def test_priority_upgrade_shortens_due():
    now = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
    case = _case(priority="normal")
    apply_review_sla(case, now=now)
    case.priority = "stat"
    apply_review_sla(case, now=now)
    assert case.review_due_at == now + timedelta(hours=24)


def test_clear_on_response():
    now = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
    case = _case(priority="urgent")
    apply_review_sla(case, now=now)
    assert clear_review_sla(case) is True
    assert case.review_due_at is None


def test_warning_threshold_helper():
    assert WARN_WITHIN_HOURS == 6
    now = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
    case = _case(priority="urgent", review_due_at=now + timedelta(hours=3))
    rem = remaining_seconds(case, now=now)
    assert rem is not None
    assert rem <= WARN_WITHIN_HOURS * 3600
