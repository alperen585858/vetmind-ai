"""Public contact form → founder inbox."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-contact",
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


def test_public_submit_and_founder_inbox(tmp_path: Path) -> None:
    client = _client(tmp_path)

    created = client.post(
        "/api/v1/public/contact",
        json={
            "name": "Dr. Ayşe Klinik",
            "email": "ayse@klinik.example",
            "phone": "+90 555 000 00 00",
            "organization": "Ayşe Veteriner",
            "topic": "license",
            "message": "Kliniğimiz için lisans ve demo görüşmesi istiyoruz.",
        },
    )
    assert created.status_code == 201, created.text
    inquiry_id = created.json()["inquiry_id"]
    assert created.json()["status"] == "received"

    admin = _token(client, "admin@demo.local")
    denied = client.get("/api/v1/founder/contact-inquiries", headers=_hdr(admin))
    assert denied.status_code == 403

    founder = _token(client, "founder@demo.local")
    listed = client.get("/api/v1/founder/contact-inquiries", headers=_hdr(founder))
    assert listed.status_code == 200, listed.text
    assert any(i["inquiry_id"] == inquiry_id and i["status"] == "new" for i in listed.json())

    count = client.get("/api/v1/founder/contact-inquiries/new-count", headers=_hdr(founder))
    assert count.status_code == 200
    assert count.json()["new_count"] >= 1

    patched = client.patch(
        f"/api/v1/founder/contact-inquiries/{inquiry_id}",
        headers=_hdr(founder),
        json={"status": "read"},
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "read"
