"""B2B transition (issues #87–#96): no pet-owner users, optional owner name,
report-ready email to the submitting vet, staff messaging, and access checks."""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth.mailer import MailDeliveryError, OutgoingMail
from app.container import AppContainer
from app.main import create_app
from app.schemas.case import CaseCreate
from app.schemas.workflow import ManagedUser
from app.services.report_email import deliver_vet_report_email
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


class RecordingMailer:
    def __init__(self, *, fail_times: int = 0) -> None:
        self.outbox: deque[OutgoingMail] = deque(maxlen=50)
        self.calls = 0
        self._fail_times = fail_times

    def send(self, mail: OutgoingMail, *, raise_on_error: bool = False) -> None:
        self.calls += 1
        if self.calls <= self._fail_times:
            if raise_on_error:
                raise MailDeliveryError("SMTPServerDisconnected")
            return
        self.outbox.append(mail)


def _container(tmp_path: Path, *, smtp_host: str | None = None) -> AppContainer:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-b2b-transition",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
        smtp_host=smtp_host,
        public_base_url="https://vetmind.example",
        self_registration_enabled=True,
    )
    return AppContainer(repo=InMemoryCaseRepository(), settings=settings)


def _client(container: AppContainer) -> TestClient:
    return TestClient(create_app(container))


def _token(client: TestClient, email: str) -> str:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _hdr(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _case_body(**overrides):
    body = {
        "patient_name": "Pax",
        "species": "canine",
        "breed": "Golden",
        "modality": "MR",
        "anatomical_region": "BRAIN",
        "clinical_history": "Synthetic demo",
    }
    body.update(overrides)
    return body


def _approve(client: TestClient, case_id: str, expert: str):
    return client.post(
        f"/api/v1/cases/{case_id}/review",
        json={
            "reviewer_id": "expert@demo.local",
            "action": "approve",
            "edited_technique": "Teknik",
            "edited_findings": "Bulgular",
            "edited_impression": "Yorum",
            "edited_recommendations": "Öneri",
        },
        headers=_hdr(expert),
    )


def _analyzed_case(client: TestClient, vet: str, **overrides) -> str:
    created = client.post("/api/v1/cases", json=_case_body(**overrides), headers=_hdr(vet))
    assert created.status_code == 201, created.text
    case_id = created.json()["case_id"]
    analyze = client.post(f"/api/v1/cases/{case_id}/analyze", headers=_hdr(vet))
    assert analyze.status_code == 200, analyze.text
    return case_id


# --- #87 pet owners are not platform users ------------------------------------------


def test_owner_demo_account_cannot_sign_in(tmp_path: Path) -> None:
    client = _client(_container(tmp_path))
    res = client.post("/api/v1/auth/login", json={"email": "owner@demo.local", "password": "demo1234"})
    assert res.status_code == 401


def test_owner_self_registration_is_rejected(tmp_path: Path) -> None:
    client = _client(_container(tmp_path))
    res = client.post(
        "/api/v1/auth/register",
        json={"email": "new-owner@example.com", "password": "Patiler2026!x", "role": "owner"},
    )
    assert res.status_code == 422
    vet = client.post(
        "/api/v1/auth/register",
        json={"email": "new-vet@example.com", "password": "Patiler2026!x", "role": "vet"},
    )
    assert vet.status_code == 201, vet.text
    assert vet.json()["status"] == "pending_approval"


def test_legacy_owner_account_is_kept_but_cannot_sign_in(tmp_path: Path) -> None:
    container = _container(tmp_path)
    container.workflow_store.save_user(
        ManagedUser(
            email="legacy-owner@example.com",
            role="owner",
            clinic_id="clinic-demo-a",
            display_name="Legacy",
            active=True,
            password_hash=None,
            created_at=datetime.now(timezone.utc),
        )
    )
    container.workflow.sync_auth_directory()
    assert "legacy-owner@example.com" not in container.auth.users
    # The stored row itself is preserved (no automatic deletion of personal data).
    assert container.workflow_store.get_user("legacy-owner@example.com") is not None


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/v1/pets"),
        ("post", "/api/v1/pets"),
        ("get", "/api/v1/submissions"),
        ("post", "/api/v1/submissions"),
        ("get", "/api/v1/owners/search?q=ay"),
        ("post", "/api/v1/payments/intents"),
    ],
)
def test_removed_owner_endpoints_are_gone(tmp_path: Path, method: str, path: str) -> None:
    client = _client(_container(tmp_path))
    vet = _token(client, "vet@demo.local")
    res = getattr(client, method)(path, headers=_hdr(vet))
    assert res.status_code in {404, 405}, (path, res.status_code)


def test_info_request_cannot_target_owner(tmp_path: Path) -> None:
    client = _client(_container(tmp_path))
    vet = _token(client, "vet@demo.local")
    created = client.post("/api/v1/cases", json=_case_body(), headers=_hdr(vet))
    case_id = created.json()["case_id"]
    res = client.post(
        f"/api/v1/cases/{case_id}/info-requests",
        json={"body": "Sahipten bilgi", "to_role": "owner"},
        headers=_hdr(vet),
    )
    assert res.status_code == 422


# --- #88 / #89 direct case creation, optional owner name ------------------------------


def test_case_without_owner_details_is_created(tmp_path: Path) -> None:
    client = _client(_container(tmp_path))
    vet = _token(client, "vet@demo.local")
    res = client.post("/api/v1/cases", json=_case_body(), headers=_hdr(vet))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["owner_contact_name"] is None
    assert body["owner_contact_email"] is None
    assert body["pet_owner_subject"] is None
    # The submitting vet and their clinic come from the account, not the form.
    assert body["owner_subject"] == "vet@demo.local"
    assert body["clinic_id"] == "clinic-demo-a"


def test_owner_name_is_optional_and_email_is_never_stored(tmp_path: Path) -> None:
    client = _client(_container(tmp_path))
    vet = _token(client, "vet@demo.local")
    res = client.post(
        "/api/v1/cases",
        json=_case_body(
            owner_name="  Ayşe   Yılmaz ",
            # Older clients may still send these; they are ignored.
            owner_email="ayse@example.com",
            owner_email_consent=True,
            pet_owner_subject="owner@demo.local",
        ),
        headers=_hdr(vet),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["owner_contact_name"] == "Ayşe Yılmaz"
    assert body["owner_contact_email"] is None
    assert body["owner_email_consent"] is False
    assert body["pet_owner_subject"] is None


def test_owner_name_can_be_set_and_cleared_later(tmp_path: Path) -> None:
    client = _client(_container(tmp_path))
    vet = _token(client, "vet@demo.local")
    case_id = client.post("/api/v1/cases", json=_case_body(), headers=_hdr(vet)).json()["case_id"]
    set_res = client.patch(f"/api/v1/cases/{case_id}/owner", json={"owner_name": "Mehmet"}, headers=_hdr(vet))
    assert set_res.status_code == 200, set_res.text
    assert set_res.json()["owner_contact_name"] == "Mehmet"
    cleared = client.patch(f"/api/v1/cases/{case_id}/owner", json={"owner_name": ""}, headers=_hdr(vet))
    assert cleared.status_code == 200
    assert cleared.json()["owner_contact_name"] is None


def test_radiologist_questions_are_kept_with_the_case(tmp_path: Path) -> None:
    client = _client(_container(tmp_path))
    vet = _token(client, "vet@demo.local")
    res = client.post(
        "/api/v1/cases",
        json=_case_body(
            clinical_history=None,
            clinical_history_structured={"complaint": "Nöbet", "radiologist_questions": "Ödem var mı?"},
        ),
        headers=_hdr(vet),
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["clinical_history_structured"]["radiologist_questions"] == "Ödem var mı?"
    assert "Ödem var mı?" in body["clinical_history"]


def test_other_clinic_cannot_open_case(tmp_path: Path) -> None:
    client = _client(_container(tmp_path))
    vet = _token(client, "vet@demo.local")
    vet_b = _token(client, "vet-b@demo.local")
    case_id = client.post("/api/v1/cases", json=_case_body(), headers=_hdr(vet)).json()["case_id"]
    res = client.get(f"/api/v1/cases/{case_id}", headers=_hdr(vet_b))
    assert res.status_code in {403, 404}
    listed = client.get("/api/v1/cases", headers=_hdr(vet_b))
    assert case_id not in {c["case_id"] for c in listed.json()}


# --- #90 report-ready email to the vet ------------------------------------------------


def test_approval_emails_the_submitting_vet_once(tmp_path: Path) -> None:
    container = _container(tmp_path, smtp_host="smtp.example.com")
    mailer = RecordingMailer()
    container.cases._mailer = mailer  # noqa: SLF001 — swap SMTP for a recorder
    client = _client(container)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    case_id = _analyzed_case(client, vet, owner_name="Ayşe Yılmaz")

    # Draft stage: nothing sent yet.
    assert not mailer.outbox

    res = _approve(client, case_id, expert)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "approved"
    assert body["vet_email_delivery_status"] == "sent"
    assert body["vet_email_sent_versions"] == [1]

    assert len(mailer.outbox) == 1
    mail = mailer.outbox[0]
    assert mail.to == "vet@demo.local"
    assert mail.subject == "VetMind AI — Radyoloji Raporunuz Hazır"
    assert f"https://vetmind.example/raporlar/{case_id}" in mail.body
    # Link opens the app (sign-in required) — no token, no patient/owner data.
    assert "token=" not in mail.body
    assert "Pax" not in mail.body and "Ayşe" not in mail.body

    # Same version again (retry of the hook) → no second email.
    case = container.repo.get_case(case_id)
    status = deliver_vet_report_email(
        case,
        report_version=1,
        mailer=mailer,
        smtp_configured=True,
        public_base_url="https://vetmind.example",
    )
    assert status == "sent"
    assert len(mailer.outbox) == 1


def test_smtp_failure_is_retried_and_never_undoes_approval(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    container = _container(tmp_path, smtp_host="smtp.example.com")
    mailer = RecordingMailer(fail_times=99)
    container.cases._mailer = mailer  # noqa: SLF001
    client = _client(container)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    case_id = _analyzed_case(client, vet)

    import app.services.report_email as report_email

    monkeypatch.setattr(report_email, "RETRY_BACKOFF_S", (0.0, 0.0))
    res = _approve(client, case_id, expert)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "approved"
    assert body["vet_email_delivery_status"] == "failed"
    assert body["vet_email_delivery_attempts"] == report_email.MAX_ATTEMPTS
    assert mailer.calls == report_email.MAX_ATTEMPTS

    notes = client.get("/api/v1/notifications", headers=_hdr(vet)).json()["items"]
    assert any(n["kind"] == "report_email_failed" for n in notes)


def test_retry_succeeds_after_transient_failure(tmp_path: Path) -> None:
    container = _container(tmp_path, smtp_host="smtp.example.com")
    case = container.cases.create_case(CaseCreate(**_case_body()), principal=None)
    case.owner_subject = "vet@demo.local"
    mailer = RecordingMailer(fail_times=1)
    status = deliver_vet_report_email(
        case,
        report_version=2,
        mailer=mailer,
        smtp_configured=True,
        public_base_url="https://vetmind.example",
        sleep=lambda _s: None,
    )
    assert status == "sent"
    assert mailer.calls == 2
    assert case.vet_email_sent_versions == [2]


def test_without_smtp_nothing_is_delivered_but_status_is_visible(tmp_path: Path) -> None:
    container = _container(tmp_path, smtp_host=None)
    client = _client(container)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    case_id = _analyzed_case(client, vet)
    res = _approve(client, case_id, expert)
    assert res.status_code == 200, res.text
    assert res.json()["vet_email_delivery_status"] == "not_configured"
    # Owner email path is gone: legacy owner status stays untouched.
    assert res.json()["owner_email_delivery_status"] is None


def test_approved_report_is_not_visible_to_another_clinic(tmp_path: Path) -> None:
    container = _container(tmp_path, smtp_host="smtp.example.com")
    container.cases._mailer = RecordingMailer()  # noqa: SLF001
    client = _client(container)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    vet_b = _token(client, "vet-b@demo.local")
    case_id = _analyzed_case(client, vet)
    assert _approve(client, case_id, expert).status_code == 200
    # The emailed link points at the case; another clinic's vet still cannot open it.
    assert client.get(f"/api/v1/cases/{case_id}", headers=_hdr(vet_b)).status_code in {403, 404}
    assert client.get(f"/api/v1/cases/{case_id}/report/pdf", headers=_hdr(vet_b)).status_code in {403, 404}


# --- #93 / #94 staff messaging ------------------------------------------------------


def test_vet_recipients_are_own_clinic_radiologists_and_support(tmp_path: Path) -> None:
    client = _client(_container(tmp_path))
    vet = _token(client, "vet@demo.local")
    res = client.get("/api/v1/messages/recipients", headers=_hdr(vet))
    assert res.status_code == 200, res.text
    subjects = {r["subject"]: r for r in res.json()}
    assert "expert@demo.local" in subjects
    assert "expert-b@demo.local" not in subjects  # other clinic
    assert subjects["support"]["channel"] == "admin"
    filtered = client.get("/api/v1/messages/recipients?q=destek", headers=_hdr(vet)).json()
    assert [r["subject"] for r in filtered] == ["support"]


def test_vet_starts_conversation_with_radiologist(tmp_path: Path) -> None:
    client = _client(_container(tmp_path))
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    expert_b = _token(client, "expert-b@demo.local")

    created = client.post(
        "/api/v1/messages/threads",
        json={
            "channel": "radiologist",
            "recipient_subject": "expert@demo.local",
            "subject": "Vaka sorusu",
            "body": "Merhaba hocam",
        },
        headers=_hdr(vet),
    )
    assert created.status_code == 201, created.text
    thread = created.json()["thread"]
    thread_id = thread["thread_id"]
    assert thread["recipient_subject"] == "expert@demo.local"
    assert thread["counterpart_role"] == "expert"

    # Persisted: listed again for both participants.
    assert thread_id in {t["thread_id"] for t in client.get("/api/v1/messages/threads", headers=_hdr(vet)).json()}
    assert thread_id in {t["thread_id"] for t in client.get("/api/v1/messages/threads", headers=_hdr(expert)).json()}

    # Not a participant → cannot see it.
    assert client.get(f"/api/v1/messages/threads/{thread_id}", headers=_hdr(expert_b)).status_code == 404

    reply = client.post(
        f"/api/v1/messages/threads/{thread_id}/messages", json={"body": "Buyurun"}, headers=_hdr(expert)
    )
    assert reply.status_code == 200, reply.text


def test_conversation_rules(tmp_path: Path) -> None:
    client = _client(_container(tmp_path))
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    admin = _token(client, "admin@demo.local")

    # Other clinic's radiologist is not reachable.
    blocked = client.post(
        "/api/v1/messages/threads",
        json={"channel": "radiologist", "recipient_subject": "expert-b@demo.local", "subject": "x", "body": "y"},
        headers=_hdr(vet),
    )
    assert blocked.status_code == 404
    # Radiologist channel needs a recipient.
    missing = client.post(
        "/api/v1/messages/threads",
        json={"channel": "radiologist", "subject": "x", "body": "y"},
        headers=_hdr(vet),
    )
    assert missing.status_code == 404
    # Blank message is rejected.
    blank = client.post(
        "/api/v1/messages/threads",
        json={"channel": "admin", "subject": "Destek", "body": "   "},
        headers=_hdr(vet),
    )
    assert blank.status_code == 422
    # Radiologists answer; they do not open new conversations.
    by_expert = client.post(
        "/api/v1/messages/threads",
        json={"channel": "admin", "subject": "Destek", "body": "Merhaba"},
        headers=_hdr(expert),
    )
    assert by_expert.status_code == 403

    support = client.post(
        "/api/v1/messages/threads",
        json={"channel": "admin", "subject": "Destek", "body": "Şifre sorunu"},
        headers=_hdr(vet),
    )
    assert support.status_code == 201, support.text
    thread_id = support.json()["thread"]["thread_id"]
    assert thread_id in {t["thread_id"] for t in client.get("/api/v1/messages/threads", headers=_hdr(admin)).json()}
    # The radiologist does not see support conversations.
    assert client.get(f"/api/v1/messages/threads/{thread_id}", headers=_hdr(expert)).status_code == 404
    empty_reply = client.post(
        f"/api/v1/messages/threads/{thread_id}/messages", json={"body": "  "}, headers=_hdr(admin)
    )
    assert empty_reply.status_code == 422


def test_vet_flow_activity_and_approved_pdf(tmp_path: Path) -> None:
    """Direct vet flow end to end: create → analyze → approve → PDF for the vet."""
    container = _container(tmp_path, smtp_host="smtp.example.com")
    container.cases._mailer = RecordingMailer()  # noqa: SLF001
    client = _client(container)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    case_id = _analyzed_case(client, vet)
    assert _approve(client, case_id, expert).status_code == 200

    act = client.get(f"/api/v1/cases/{case_id}/activity", headers=_hdr(vet))
    assert act.status_code == 200
    kinds = {e["kind"] for e in act.json()}
    assert {"report_approved", "vet_report_email_sent"} <= kinds

    pdf = client.get(f"/api/v1/cases/{case_id}/report/pdf", headers=_hdr(vet))
    assert pdf.status_code == 200, pdf.text
    assert pdf.content[:4] == b"%PDF"

    notes = client.get("/api/v1/notifications", headers=_hdr(vet)).json()["items"]
    assert any(n["kind"] == "report_approved" for n in notes)
