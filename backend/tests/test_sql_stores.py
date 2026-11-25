"""Every store on the shared SQL database (#102): SQLite always, Postgres when
VETMIND_TEST_DATABASE_URL is set (CI's postgres job). The database is emptied first."""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pytest

from app.auth.password_reset import ResetRecord, SqlPasswordResetStore
from app.auth.refresh_tokens import RefreshRecord, SqlRefreshTokenStore
from app.feedback.store import FeedbackStore
from app.llm.lessons import LessonContext, LessonStore
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, CaseLifecycleStatus, Modality, Species
from app.schemas.messaging import SupportThread
from app.schemas.notifications import AppNotification
from app.schemas.radiologist_payout import RadiologistPayoutSettings
from app.schemas.user_settings import UserSettingsUpdate
from app.schemas.workflow import ManagedUser
from app.security.audit import AuditLogger
from app.services.messaging_store import SqlMessagingStore
from app.services.notification_store import SqlNotificationStore
from app.services.radiologist_payout_store import SqlRadiologistPayoutStore
from app.services.report_view_tokens import ReportViewRecord, SqlReportViewTokenStore
from app.services.sqlite_repository import SqlCaseRepository
from app.services.user_settings_store import SqlUserSettingsStore
from app.services.workflow_store import SqlWorkflowStore
from app.storage.sql import Database, run_migrations

PG_URL = os.getenv("VETMIND_TEST_DATABASE_URL")


def _reset_postgres(url: str) -> None:
    import psycopg

    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")


@pytest.fixture(params=["sqlite", pytest.param("postgres", marks=pytest.mark.postgres)])
def db(request, tmp_path: Path) -> Database:
    if request.param == "sqlite":
        return Database.sqlite(tmp_path / "vetmind.sqlite3")
    if not PG_URL:
        pytest.skip("Set VETMIND_TEST_DATABASE_URL to run the Postgres store tests.")
    _reset_postgres(PG_URL)
    database = Database(PG_URL)
    run_migrations(database.url)  # fresh schema every test (the per-process cache would skip it)
    return database


def _case() -> CaseRecord:
    return CaseRecord(
        case_id=f"case-{uuid4().hex[:10]}",
        patient_name="Pamuk",
        species=Species.FELINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        status=CaseLifecycleStatus.CREATED,
    )


def test_cases_roundtrip_and_survive_a_new_connection(db: Database) -> None:
    repo = SqlCaseRepository(db.connect())
    a, b = _case(), _case()
    repo.save_case(a)
    repo.save_case(b)
    repo.save_case(a.model_copy(update={"patient_name": "Pamuk II"}))
    again = SqlCaseRepository(db.connect())
    assert again.get_case(a.case_id).patient_name == "Pamuk II"
    assert {c.case_id for c in again.list_cases()} == {a.case_id, b.case_id}
    assert again.delete_case(b.case_id) is True
    assert again.get_case(b.case_id) is None


def test_workflow_users_and_settings(db: Database) -> None:
    wf = SqlWorkflowStore(db.connect())
    wf.save_user(ManagedUser(email="Vet@Clinic.test", role="vet", clinic_id="clinic-demo-a"))
    assert SqlWorkflowStore(db.connect()).get_user("vet@clinic.test").role == "vet"
    assert wf.delete_user("vet@clinic.test") is True

    us = SqlUserSettingsStore(db.connect())
    us.update("vet@clinic.test", UserSettingsUpdate(language="en"))
    assert SqlUserSettingsStore(db.connect()).get("vet@clinic.test").language == "en"


def test_notifications_dedupe_and_payout_settings_row(db: Database) -> None:
    store = SqlNotificationStore(db.connect())
    n = AppNotification(
        notification_id=f"n-{uuid4().hex[:8]}", recipient_subject="vet@demo.local", dedupe_key="k1",
        kind="report_approved", title="t", body="b", link_path="/vakalar/case-1",
    )
    assert store.upsert(n) is not None
    dup = n.model_copy(update={"notification_id": f"n-{uuid4().hex[:8]}"})
    assert store.upsert(dup) is None  # same dedupe key; the connection stays usable
    assert [x.notification_id for x in store.list_for("vet@demo.local")] == [n.notification_id]
    assert store.mark_all_read("vet@demo.local") == 1

    payouts = SqlRadiologistPayoutStore(db.connect())
    SqlRadiologistPayoutStore(db.connect())  # a second process start must not duplicate the row
    payouts.save_settings(RadiologistPayoutSettings(fee_per_case=55))
    assert SqlRadiologistPayoutStore(db.connect()).get_settings().fee_per_case == 55


def test_tokens_store_hashes_and_revoke(db: Database) -> None:
    now = time.time()
    rt = SqlRefreshTokenStore(db.connect())
    rt.save(RefreshRecord("h1", "vet@demo.local", "fam", 0, now, now + 60))
    rt.save(RefreshRecord("h2", "vet@demo.local", "fam", 0, now, now + 60))
    assert rt.revoke_family("fam", now) == 2
    assert SqlRefreshTokenStore(db.connect()).get("h1").revoked_at == pytest.approx(now)

    pr = SqlPasswordResetStore(db.connect())
    pr.save(ResetRecord("r1", "vet@demo.local", now, now + 60))
    assert pr.invalidate_subject("vet@demo.local", now) == 1

    links = SqlReportViewTokenStore(db.connect())
    links.save(ReportViewRecord("v1", "case-1", 2, now, now + 60))
    assert links.invalidate_case("case-1", now) == 1
    assert links.get("v1").revoked_at == pytest.approx(now)


def test_messaging_audit_feedback_lessons(db: Database) -> None:
    ms = SqlMessagingStore(db.connect())
    t = SupportThread(thread_id=f"t-{uuid4().hex[:8]}", channel="admin", owner_subject="vet@demo.local", subject="Soru")
    ms.save_thread(t)
    assert SqlMessagingStore(db.connect()).get_thread(t.thread_id).subject == "Soru"

    audit = AuditLogger(conn=db.connect())
    audit.record(event_type="auth.login", actor="vet@demo.local", resource="/api/v1/auth/login")
    audit.record(event_type="auth.logout", actor="vet@demo.local", resource="/api/v1/auth/logout")
    events = AuditLogger(conn=db.connect()).list_events(limit=10)
    assert [e["event_type"] for e in events] == ["auth.login", "auth.logout"]

    fb = FeedbackStore(conn=db.connect())
    fb.record(case_id="case-1", decision="approve", actor="expert@demo.local", clinic_id="c1")
    fb.record(case_id="case-2", decision="reject", actor="expert@demo.local", clinic_id="c2")
    again = FeedbackStore(conn=db.connect())
    assert [e.case_id for e in again.list_events(clinic_id="c2")] == ["case-2"]

    lessons = LessonStore(conn=db.connect())
    ctx = LessonContext(region="BRAIN", species="feline", modality="MR", finding_codes=["MASS"])
    lesson = lessons.add(instruction="Kitle için kontrast öner.", context=ctx, created_by="expert@demo.local")
    lessons.mark_applied([lesson.lesson_id])
    reloaded = LessonStore(conn=db.connect())
    assert reloaded.get(lesson.lesson_id).times_applied == 1
    assert reloaded.delete(lesson.lesson_id) is True
    assert LessonStore(conn=db.connect()).list() == []


def test_audit_timestamps_sort(db: Database) -> None:
    audit = AuditLogger(conn=db.connect())
    for _ in range(3):
        audit.record(event_type="x", actor="a", resource="r")
    stamps = [e["timestamp"] for e in audit.list_events(limit=2)]
    assert stamps == sorted(stamps) and len(stamps) == 2
    assert datetime.fromisoformat(stamps[-1]) <= datetime.now(timezone.utc)
