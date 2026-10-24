"""Demo payment gate before imaging submission finalization."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.schemas.payment import DEMO_DECLINE_CARD_NUMBER
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from helpers_payment import DEMO_CARD, approve_demo_payment


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-demo-pay",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def _token(client: TestClient, email: str) -> str:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _hdr(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _owner_draft(client: TestClient, owner: str) -> tuple[str, str]:
    pet = client.post(
        "/api/v1/pets",
        json={"name": "Pax", "species": "canine"},
        headers=_hdr(owner),
    ).json()
    sub = client.post(
        "/api/v1/submissions",
        json={"pet_id": pet["pet_id"], "chief_complaint": "Ataksi"},
        headers=_hdr(owner),
    )
    assert sub.status_code == 201, sub.text
    assert sub.json()["status"] == "draft"
    return pet["pet_id"], sub.json()["submission_id"]


def test_successful_demo_payment_finalizes_exactly_one_submission(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    vet = _token(client, "vet@demo.local")
    _, sid = _owner_draft(client, owner)

    # Bypass attempt: finalize without payment
    denied = client.post(f"/api/v1/submissions/{sid}/finalize", headers=_hdr(owner))
    assert denied.status_code == 402

    body = approve_demo_payment(client, sid, _hdr(owner))
    assert body["submission_finalized"] is True
    assert body["submission_status"] == "pending_verification"

    got = client.get(f"/api/v1/submissions/{sid}", headers=_hdr(owner))
    assert got.status_code == 200
    assert got.json()["status"] == "pending_verification"
    assert got.json()["payment_status"] == "approved"

    # Exactly one pending submission for this owner
    listed = client.get("/api/v1/submissions", headers=_hdr(owner)).json()
    pending = [s for s in listed if s["submission_id"] == sid]
    assert len(pending) == 1

    # Clinic sees it after finalize (not while draft)
    vet_list = client.get("/api/v1/submissions", headers=_hdr(vet)).json()
    assert any(s["submission_id"] == sid for s in vet_list)


def test_failed_payment_prevents_submission_finalize(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    _, sid = _owner_draft(client, owner)

    intent = client.post(
        "/api/v1/payments/intents",
        json={"submission_id": sid},
        headers=_hdr(owner),
    ).json()
    failed = client.post(
        f"/api/v1/payments/intents/{intent['payment_id']}/confirm-demo",
        json={
            "card_number": DEMO_DECLINE_CARD_NUMBER,
            "expiry": "12/34",
            "cvc": "123",
        },
        headers=_hdr(owner),
    )
    assert failed.status_code == 402

    pay = client.get(
        f"/api/v1/payments/intents/{intent['payment_id']}",
        headers=_hdr(owner),
    ).json()
    assert pay["status"] == "failed"

    fin = client.post(f"/api/v1/submissions/{sid}/finalize", headers=_hdr(owner))
    assert fin.status_code == 402
    sub = client.get(f"/api/v1/submissions/{sid}", headers=_hdr(owner)).json()
    assert sub["status"] == "draft"


def test_duplicate_confirm_is_idempotent(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    _, sid = _owner_draft(client, owner)

    first = approve_demo_payment(client, sid, _hdr(owner))
    payment_id = first["payment"]["payment_id"]

    again = client.post(
        f"/api/v1/payments/intents/{payment_id}/confirm-demo",
        json=DEMO_CARD,
        headers=_hdr(owner),
    )
    assert again.status_code == 200
    assert again.json()["payment"]["status"] == "approved"
    assert again.json()["payment"]["payment_id"] == payment_id

    fin_again = client.post(f"/api/v1/submissions/{sid}/finalize", headers=_hdr(owner))
    assert fin_again.status_code == 200
    assert fin_again.json()["status"] == "pending_verification"

    listed = client.get("/api/v1/submissions", headers=_hdr(owner)).json()
    assert len([s for s in listed if s["submission_id"] == sid]) == 1


def test_refresh_preserves_approved_demo_payment(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    _, sid = _owner_draft(client, owner)
    body = approve_demo_payment(client, sid, _hdr(owner))
    payment_id = body["payment"]["payment_id"]

    # Simulate page refresh: re-fetch by id and by submission
    by_id = client.get(f"/api/v1/payments/intents/{payment_id}", headers=_hdr(owner))
    assert by_id.status_code == 200
    assert by_id.json()["status"] == "approved"

    by_sub = client.get(f"/api/v1/payments/by-submission/{sid}", headers=_hdr(owner))
    assert by_sub.status_code == 200
    assert by_sub.json()["payment_id"] == payment_id
    assert by_sub.json()["status"] == "approved"


def test_user_cannot_approve_another_users_payment(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    # Second owner in same clinic directory — create via admin if needed; use vet as non-payer.
    vet = _token(client, "vet@demo.local")
    _, sid = _owner_draft(client, owner)

    intent = client.post(
        "/api/v1/payments/intents",
        json={"submission_id": sid},
        headers=_hdr(owner),
    ).json()

    # Vet must not confirm owner's payment
    denied = client.post(
        f"/api/v1/payments/intents/{intent['payment_id']}/confirm-demo",
        json=DEMO_CARD,
        headers=_hdr(vet),
    )
    assert denied.status_code in {403, 404}

    # Cross-owner: register another owner and attempt read/confirm
    admin = _token(client, "admin@demo.local")
    created = client.post(
        "/api/v1/admin/users",
        json={
            "email": "owner2@demo.local",
            "password": "demo1234",
            "role": "owner",
            "clinic_id": "clinic-demo-a",
        },
        headers=_hdr(admin),
    )
    assert created.status_code in {200, 201}, created.text
    owner2 = _token(client, "owner2@demo.local")

    peek = client.get(
        f"/api/v1/payments/intents/{intent['payment_id']}",
        headers=_hdr(owner2),
    )
    assert peek.status_code == 404

    steal = client.post(
        f"/api/v1/payments/intents/{intent['payment_id']}/confirm-demo",
        json=DEMO_CARD,
        headers=_hdr(owner2),
    )
    assert steal.status_code == 404


def test_cannot_bypass_payment_via_direct_finalize(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    vet = _token(client, "vet@demo.local")
    _, sid = _owner_draft(client, owner)

    # Direct finalize without payment
    assert client.post(f"/api/v1/submissions/{sid}/finalize", headers=_hdr(owner)).status_code == 402

    # Vet cannot act on unpaid draft
    act = client.post(
        f"/api/v1/submissions/{sid}/vet-action",
        json={"action": "accept"},
        headers=_hdr(vet),
    )
    assert act.status_code == 409

    # Draft hidden from vet list
    vet_list = client.get("/api/v1/submissions", headers=_hdr(vet)).json()
    assert not any(s["submission_id"] == sid for s in vet_list)


def test_no_card_data_stored_or_audited(tmp_path: Path) -> None:
    client = _client(tmp_path)
    container: AppContainer = client.app.state.container  # type: ignore[attr-defined]
    owner = _token(client, "owner@demo.local")
    _, sid = _owner_draft(client, owner)
    body = approve_demo_payment(client, sid, _hdr(owner))
    payment_id = body["payment"]["payment_id"]

    stored = container.payment_store.get_payment(payment_id)
    assert stored is not None
    dumped = stored.model_dump_json()
    assert "4242424242424242" not in dumped
    assert "123" not in dumped or '"cvc"' not in dumped
    assert "card_number" not in dumped
    assert "expiry" not in dumped
    assert "cvc" not in dumped

    events = container.audit.list_events()
    blob = " ".join(f"{e.get('event_type', '')} {e.get('detail') or ''}" for e in events)
    assert "4242424242424242" not in blob
    assert "card_number" not in blob
    assert any(e.get("event_type") == "payment.demo_approved" for e in events)
