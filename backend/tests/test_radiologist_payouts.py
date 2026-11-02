"""Admin radiologist payout ledger — fixed fee × approved cases."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.schemas.radiologist_payout import RADIOLOGIST_CASE_FEE
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-rpay",
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


def test_ledger_lists_experts_and_tracks_fixed_fee(tmp_path: Path) -> None:
    client = _client(tmp_path)
    admin = _token(client, "admin@demo.local")
    expert = _token(client, "expert@demo.local")
    vet = _token(client, "vet@demo.local")

    ledger = client.get("/api/v1/admin/radiologist-payouts", headers=_hdr(admin))
    assert ledger.status_code == 200, ledger.text
    body = ledger.json()
    assert body["fee_per_case"] == RADIOLOGIST_CASE_FEE
    assert body["currency"] == "EUR"
    emails = {r["radiologist_subject"] for r in body["radiologists"]}
    assert "expert@demo.local" in emails

    # Non-admin cannot read ledger
    denied = client.get("/api/v1/admin/radiologist-payouts", headers=_hdr(expert))
    assert denied.status_code == 403

    # Create + analyze + approve a case
    created = client.post(
        "/api/v1/cases",
        json={
            "patient_name": "Payout Dog",
            "species": "canine",
            "breed": "Mix",
            "modality": "MR",
            "anatomical_region": "BRAIN",
            "clinical_history": "Ataksi",
        },
        headers=_hdr(vet),
    )
    assert created.status_code == 201, created.text
    case_id = created.json()["case_id"]

    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze", headers=_hdr(vet))
    assert analyzed.status_code == 200, analyzed.text
    assert analyzed.json().get("report") is not None

    review = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={
            "action": "approve",
            "reviewer_id": "expert@demo.local",
            "comment": "OK",
            "edited_impression": "Reviewed synthetic impression — payout tracking demo.",
        },
        headers=_hdr(expert),
    )
    assert review.status_code == 200, review.text
    assert review.json()["status"] == "approved"

    ledger2 = client.get("/api/v1/admin/radiologist-payouts", headers=_hdr(admin))
    assert ledger2.status_code == 200
    row = next(r for r in ledger2.json()["radiologists"] if r["radiologist_subject"] == "expert@demo.local")
    assert row["unpaid_cases"] >= 1
    assert row["amount_owed"] >= RADIOLOGIST_CASE_FEE
    assert ledger2.json()["total_unpaid_cases"] >= 1

    detail = client.get("/api/v1/admin/radiologist-payouts/expert@demo.local", headers=_hdr(admin))
    assert detail.status_code == 200
    assert any(p["case_id"] == case_id and p["status"] == "owed" for p in detail.json()["payouts"])

    # Change fee — unpaid rows rewrite to new amount
    fee_put = client.put(
        "/api/v1/admin/radiologist-payouts/settings",
        json={"fee_per_case": 55, "apply_to_unpaid": True},
        headers=_hdr(admin),
    )
    assert fee_put.status_code == 200, fee_put.text
    assert fee_put.json()["fee_per_case"] == 55

    detail2 = client.get("/api/v1/admin/radiologist-payouts/expert@demo.local", headers=_hdr(admin))
    owed = next(p for p in detail2.json()["payouts"] if p["case_id"] == case_id)
    assert owed["status"] == "owed"
    assert owed["amount"] == 55
    assert detail2.json()["summary"]["amount_owed"] == 55

    ledger3 = client.get("/api/v1/admin/radiologist-payouts", headers=_hdr(admin))
    assert ledger3.json()["fee_per_case"] == 55

    paid = client.post(
        "/api/v1/admin/radiologist-payouts/expert@demo.local/mark-paid",
        json={},
        headers=_hdr(admin),
    )
    assert paid.status_code == 200, paid.text
    assert paid.json()["summary"]["unpaid_cases"] == 0
    assert paid.json()["summary"]["amount_owed"] == 0
    assert all(p["status"] == "paid" for p in paid.json()["payouts"] if p["case_id"] == case_id)
