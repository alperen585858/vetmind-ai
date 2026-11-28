"""Single-use report view links (legacy owner links stay revocable after the B2B switch)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.report_view_tokens import (
    InMemoryReportViewTokenStore,
    ReportViewRecord,
    ReportViewTokenError,
    ReportViewTokenService,
    _hash,
)
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path, *, smtp_host: str | None = None) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-owner-contact",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
        smtp_host=smtp_host,
        public_base_url="http://localhost:5173",
        report_view_token_ttl_seconds=3600,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


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
        "owner_name": "Ayşe Yılmaz",
        "owner_email": "guest-owner@example.com",
        "owner_email_consent": True,
    }
    body.update(overrides)
    return body


def test_report_view_token_consume_revoke_expire() -> None:
    store = InMemoryReportViewTokenStore()
    svc = ReportViewTokenService(store, ttl_seconds=60)
    raw = svc.issue(case_id="case-1", report_version=1)
    peeked = svc.peek(raw)
    assert peeked.case_id == "case-1"
    consumed = svc.consume(raw)
    assert consumed.case_id == "case-1"
    try:
        svc.consume(raw)
        raise AssertionError("expected used")
    except ReportViewTokenError as exc:
        assert exc.reason == "used"

    raw2 = svc.issue(case_id="case-1", report_version=1)
    n = svc.revoke_case("case-1")
    assert n >= 1
    try:
        svc.consume(raw2)
        raise AssertionError("expected revoked")
    except ReportViewTokenError as exc:
        assert exc.reason == "revoked"

    # Expired (ttl floor is 60s; write a past-dated record directly).
    raw3 = "expired-token-raw-value-xxxxxxxx"
    store.save(
        ReportViewRecord(
            token_hash=_hash(raw3),
            case_id="case-2",
            report_version=1,
            created_at=1.0,
            expires_at=2.0,
        )
    )
    try:
        svc.consume(raw3)
        raise AssertionError("expected expired")
    except ReportViewTokenError as exc:
        assert exc.reason == "expired"


def test_public_report_view_and_revoke_endpoint(tmp_path: Path) -> None:
    client = _client(tmp_path, smtp_host="smtp.example.com")
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")

    created = client.post(
        "/api/v1/cases",
        json=_case_body(owner_email="guest-only@example.com", pet_owner_subject=None),
        headers=_hdr(vet),
    )
    case_id = created.json()["case_id"]
    analyze = client.post(f"/api/v1/cases/{case_id}/analyze", headers=_hdr(vet))
    assert analyze.status_code == 200, analyze.text
    review = client.post(
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
    assert review.status_code == 200, review.text

    container = client.app.state.container  # type: ignore[attr-defined]
    raw = container.report_view_tokens.issue(case_id=case_id, report_version=1)

    # #84: checking the link returns no report content and does not count as a view.
    status_res = client.post("/api/v1/public/report-link", json={"token": raw})
    assert status_res.status_code == 200, status_res.text
    assert status_res.json()["report_version"] == 1
    assert "findings" not in status_res.json()
    views = lambda: [e for e in container.audit.list_events(limit=200) if e["event_type"] == "report_link.view"]  # noqa: E731
    assert views() == []

    # The report can be opened again (refresh / second click) until expiry or revoke.
    for _ in range(3):
        ok = client.post("/api/v1/public/report-view", json={"token": raw})
        assert ok.status_code == 200, ok.text
        assert ok.json()["patient_name"] == "Pax"
    assert len(views()) == 3

    raw2 = container.report_view_tokens.issue(case_id=case_id, report_version=1)
    revoked = client.post(f"/api/v1/cases/{case_id}/report-view-links/revoke", headers=_hdr(vet))
    assert revoked.status_code == 200, revoked.text
    gone = client.post("/api/v1/public/report-view", json={"token": raw2})
    assert gone.status_code == 410
    assert gone.json()["detail"]["code"] == "report_link_revoked"
    assert client.post("/api/v1/public/report-link", json={"token": raw2}).status_code == 410


def test_expired_link_is_refused(tmp_path: Path) -> None:
    client = _client(tmp_path)
    container = client.app.state.container  # type: ignore[attr-defined]
    raw = container.report_view_tokens.issue(case_id="case-x", report_version=1)
    rec = container.report_view_tokens._store.get(_hash(raw))  # noqa: SLF001
    container.report_view_tokens._store.save(ReportViewRecord(**{**rec.__dict__, "expires_at": 0.0}))  # noqa: SLF001
    res = client.post("/api/v1/public/report-view", json={"token": raw})
    assert res.status_code == 410
    assert res.json()["detail"]["code"] == "report_link_expired"
    assert client.post("/api/v1/public/report-link", json={"token": raw}).status_code == 410
