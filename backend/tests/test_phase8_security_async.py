"""Phase 8 — JWT role binding, async concurrency gate, report integrity."""

from __future__ import annotations

import base64
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth.security import (
    DEMO_USERS,
    JWT_AUDIENCE,
    JWT_ISSUER,
    create_access_token,
    decode_token,
    resolve_jwt_identity,
)
from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from app.workers.analyze_gate import AnalyzeGate
from tests.conftest import make_payload
from tests.test_phase5_security import _auth, _client, _settings, _token


def _forge_signed_token(*, subject: str, role: str, secret: str, clinic_id: str | None = None) -> str:
    """Create a HS256 token bypassing create_access_token role checks (attack simulation)."""
    import hashlib
    import hmac
    import time as _time

    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    now = int(_time.time())
    payload_obj = {
        "sub": subject,
        "role": role,
        "iat": now,
        "exp": now + 3600,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
    }
    if clinic_id:
        payload_obj["clinic_id"] = clinic_id
    payload = b64(json.dumps(payload_obj, separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload}.{b64(sig)}"


def test_decode_rejects_role_demo() -> None:
    with pytest.raises(ValueError, match="not allowed"):
        # Even a well-formed forged payload must fail at decode when role=demo.
        # Use forge helper then decode — create_access_token refuses to issue demo.
        token = _forge_signed_token(subject="vet@demo.local", role="demo", secret="s")
        decode_token(token, "s")


def test_decode_rejects_role_service() -> None:
    token = _forge_signed_token(subject="vet@demo.local", role="service", secret="s")
    with pytest.raises(ValueError, match="not allowed"):
        decode_token(token, "s")


def test_decode_requires_iss_aud() -> None:
    # Minimal handcrafted token without iss/aud
    import hashlib
    import hmac
    import time as _time

    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    now = int(_time.time())
    payload = b64(
        json.dumps(
            {"sub": "vet@demo.local", "role": "vet", "iat": now, "exp": now + 60},
            separators=(",", ":"),
        ).encode()
    )
    sig = hmac.new(b"s", f"{header}.{payload}".encode(), hashlib.sha256).digest()
    token = f"{header}.{payload}.{b64(sig)}"
    with pytest.raises(ValueError, match="issuer"):
        decode_token(token, "s")


def test_resolve_jwt_identity_binds_seed_role_not_claim() -> None:
    payload = {
        "sub": "vet@demo.local",
        "role": "admin",  # forged claim
        "clinic_id": "clinic-evil",
    }
    subject, role, clinic = resolve_jwt_identity(payload, DEMO_USERS)
    assert subject == "vet@demo.local"
    assert role == "vet"
    assert clinic == "clinic-demo-a"


def test_forged_demo_role_jwt_rejected_by_api(tmp_path: Path) -> None:
    client = _client(tmp_path)
    secret = "test-secret-phase5"
    forged = _forge_signed_token(subject="vet@demo.local", role="demo", secret=secret)
    denied = client.get("/api/v1/cases", headers=_auth(forged))
    assert denied.status_code == 401


def test_forged_admin_claim_on_vet_subject_stays_vet(tmp_path: Path) -> None:
    """Privilege escalation via role claim must not elevate a seed vet user."""
    client = _client(tmp_path)
    secret = "test-secret-phase5"
    forged = _forge_signed_token(
        subject="vet@demo.local",
        role="admin",
        secret=secret,
        clinic_id="clinic-demo-b",
    )
    me = client.get("/api/v1/auth/me", headers=_auth(forged))
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["role"] == "vet"
    assert body["clinic_id"] == "clinic-demo-a"
    # Still tenant-scoped: cannot read other clinic cases as "admin"
    vet_b = _token(client, "vet-b@demo.local")
    case_b = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers=_auth(vet_b),
    ).json()["case_id"]
    denied = client.get(f"/api/v1/cases/{case_b}", headers=_auth(forged))
    assert denied.status_code == 404


def test_legitimate_roles_still_login(tmp_path: Path) -> None:
    client = _client(tmp_path)
    for email, expected in [
        ("vet@demo.local", "vet"),
        ("expert@demo.local", "expert"),
        ("owner@demo.local", "owner"),
        ("admin@demo.local", "admin"),
    ]:
        token = _token(client, email)
        me = client.get("/api/v1/auth/me", headers=_auth(token)).json()
        assert me["role"] == expected


def test_async_analyze_respects_concurrency_gate(tmp_path: Path) -> None:
    settings = _settings(tmp_path, max_concurrent_analyze=1, async_analyze_delay_ms=300)
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    client = TestClient(create_app(container))
    vet = _token(client, "vet@demo.local")
    a = client.post(
        "/api/v1/cases", json=make_payload().model_dump(mode="json"), headers=_auth(vet)
    ).json()["case_id"]
    b = client.post(
        "/api/v1/cases", json=make_payload().model_dump(mode="json"), headers=_auth(vet)
    ).json()["case_id"]
    first = client.post(f"/api/v1/cases/{a}/analyze/async", headers=_auth(vet))
    assert first.status_code == 202, first.text
    second = client.post(f"/api/v1/cases/{b}/analyze/async", headers=_auth(vet))
    assert second.status_code == 429, second.text
    # Allow first job to finish and release slot
    job_id = first.json()["job_id"]
    deadline = time.time() + 5
    while time.time() < deadline:
        st = client.get(f"/api/v1/jobs/{job_id}", headers=_auth(vet)).json()["status"]
        if st in {"completed", "failed", "cancelled", "timed_out"}:
            break
        time.sleep(0.05)
    retry = client.post(f"/api/v1/cases/{b}/analyze/async", headers=_auth(vet))
    assert retry.status_code == 202, retry.text


def test_analyze_gate_file_lock_shared(tmp_path: Path) -> None:
    path = tmp_path / "shared.count"
    g1 = AnalyzeGate(max_concurrent=1, path=path)
    g2 = AnalyzeGate(max_concurrent=1, path=path)
    assert g1.try_acquire() is True
    assert g2.try_acquire() is False
    g1.release()
    assert g2.try_acquire() is True
    g2.release()


def test_cancel_preserves_prior_draft(tmp_path: Path) -> None:
    settings = _settings(
        tmp_path,
        auth_enabled=False,
        tenant_isolation=False,
        async_analyze_delay_ms=400,
        max_concurrent_analyze=4,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    client = TestClient(create_app(container))
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()[
        "case_id"
    ]
    assert client.post(f"/api/v1/cases/{case_id}/analyze").status_code == 200
    draft_id = client.get(f"/api/v1/cases/{case_id}/report").json()["report_id"]
    job = client.post(f"/api/v1/cases/{case_id}/analyze/async").json()
    cancelled = client.post(f"/api/v1/jobs/{job['job_id']}/cancel")
    assert cancelled.status_code == 200
    deadline = time.time() + 5
    while time.time() < deadline:
        st = client.get(f"/api/v1/jobs/{job['job_id']}").json()["status"]
        if st in {"cancelled", "failed", "completed", "timed_out"}:
            break
        time.sleep(0.05)
    case = client.get(f"/api/v1/cases/{case_id}").json()
    assert case["draft_report"] is not None
    assert case["draft_report"]["report_id"] == draft_id
    assert case["status"] == "awaiting_review"


def test_sqlite_approved_report_survives_reanalyze_attempt(tmp_path: Path) -> None:
    db = tmp_path / "phase8.sqlite3"
    settings = Settings(
        storage_backend="sqlite",
        sqlite_path=db,
        quarantine_root=tmp_path / "q",
        async_analyze_delay_ms=0,
        rag_backend="lexical",
        auth_enabled=False,
        analyze_gate_path=tmp_path / "gate.count",
        max_concurrent_analyze=4,
    )
    client = TestClient(create_app(AppContainer(settings=settings)))
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()[
        "case_id"
    ]
    assert client.post(f"/api/v1/cases/{case_id}/analyze").status_code == 200
    approved = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert", "action": "approve"},
    )
    assert approved.status_code == 200, approved.text
    report_id = approved.json()["draft_report"]["report_id"]
    blocked = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert blocked.status_code == 409
    # Fresh process / container against same sqlite
    client2 = TestClient(create_app(AppContainer(settings=settings)))
    case = client2.get(f"/api/v1/cases/{case_id}").json()
    assert case["status"] == "approved"
    assert case["draft_report"]["immutable"] is True
    assert case["draft_report"]["report_id"] == report_id
