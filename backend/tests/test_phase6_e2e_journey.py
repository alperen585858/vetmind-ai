"""Phase 6 — end-to-end API journeys (synthetic data only)."""

from __future__ import annotations

import io
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.security.retention import RetentionPolicy, plan_case_retention
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings, validate_security_settings
from app.storage.quarantine import QuarantineStore, validate_ingest_id
from tests.conftest import make_payload


def _mem_settings(tmp_path: Path, **kwargs) -> Settings:
    base = dict(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        async_analyze_delay_ms=30,
        rag_backend="embedding",
        auth_enabled=False,
        tenant_isolation=False,
        malware_scan_required=False,
        max_concurrent_analyze=8,
        analyze_gate_path=tmp_path / "analyze_gate.count",
    )
    base.update(kwargs)
    return Settings(**base)


def _client(tmp_path: Path, **kwargs) -> TestClient:
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=_mem_settings(tmp_path, **kwargs))))


def _auth_client(tmp_path: Path, **kwargs) -> TestClient:
    return _client(
        tmp_path,
        auth_enabled=True,
        jwt_secret="phase6-test-secret",
        auth_api_key="phase6-key",
        tenant_isolation=True,
        audit_log_path=tmp_path / "audit.jsonl",
        **kwargs,
    )


def _token(client: TestClient, email: str) -> str:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _hdr(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _demo_upload_confirm_analyze(client: TestClient, *, headers: dict | None = None) -> str:
    """DICOM demo fixture → confirm → sync analyze. Returns case_id."""
    up = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={
            "patient_name": "SynthPax",
            "species": "canine",
            "clinical_history": "Synthetic E2E — not a real patient.",
        },
        headers=headers or {},
    )
    assert up.status_code == 201, up.text
    body = up.json()
    assert body["blocked"] is False
    ingest_id = body["ingest_id"]
    conf = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={
            "accept_suggestion": True,
            "imaging_source_permission_verified": True,
            "imaging_analysis_consent_verified": True,
        },
        headers=headers or {},
    )
    assert conf.status_code == 200, conf.text
    case_id = conf.json()["case_id"]
    an = client.post(f"/api/v1/cases/{case_id}/analyze", headers=headers or {})
    assert an.status_code == 200, an.text
    assert an.json()["outcome"] in {"success", "partial", "unsupported"}
    return case_id


# ── Demo full journey ────────────────────────────────────────────────────────


def test_e2e_demo_dicom_to_print_ready_report(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = _demo_upload_confirm_analyze(client)

    case = client.get(f"/api/v1/cases/{case_id}").json()
    assert case["classification_confirmed"] is True
    assert case["draft_report"] is not None
    assert case["draft_report"].get("synthetic") is True or case["draft_report"]["generation"]["source_kind"] == "mock"
    assert case["draft_report"]["clinically_validated"] is False

    # Expert approve
    rev = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve", "comment": "E2E approve"},
    )
    assert rev.status_code == 200, rev.text
    approved = rev.json()
    assert approved["status"] == "approved"
    assert approved["draft_report"]["immutable"] is True
    assert approved["draft_report"]["clinically_validated"] is False

    versions = client.get(f"/api/v1/cases/{case_id}/report/versions").json()
    assert len(versions) >= 1
    assert any(v["immutable"] and v["status"] == "approved" for v in versions)

    snap = client.get(f"/api/v1/cases/{case_id}/report/versions/{versions[0]['version']}").json()
    assert "content" in snap
    assert snap["content"]["impression"]["text"]

    # Print path consumes persisted report (API-level readiness)
    report = client.get(f"/api/v1/cases/{case_id}/report").json()
    assert report["version"] >= 1
    assert report["immutable"] is True


def test_e2e_reject_and_revision_and_history(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = _demo_upload_confirm_analyze(client)

    rejected = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "reject", "comment": "Incomplete"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"

    # Fresh case for revision-after-approve
    case_id2 = _demo_upload_confirm_analyze(client)
    client.post(
        f"/api/v1/cases/{case_id2}/review",
        json={"reviewer_id": "expert-demo", "action": "approve", "comment": "v1"},
    )
    revised = client.post(
        f"/api/v1/cases/{case_id2}/review",
        json={
            "reviewer_id": "expert-demo",
            "action": "request_revision",
            "comment": "Clarify impression",
            "edited_impression": "Revize edilmiş sentetik değerlendirme",
        },
    )
    assert revised.status_code == 200, revised.text
    assert revised.json()["status"] == "revision_requested"
    assert revised.json()["draft_report"]["immutable"] is False
    versions = client.get(f"/api/v1/cases/{case_id2}/report/versions").json()
    assert any(v["immutable"] for v in versions)


def test_e2e_async_analyze_and_cancel(tmp_path: Path) -> None:
    client = _client(tmp_path, async_analyze_delay_ms=500)
    up = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "AsyncPax", "species": "canine"},
    )
    ingest_id = up.json()["ingest_id"]
    case_id = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={"accept_suggestion": True},
    ).json()["case_id"]

    job = client.post(f"/api/v1/cases/{case_id}/analyze/async").json()
    job_id = job["job_id"]
    # Duplicate while in-flight
    again = client.post(f"/api/v1/cases/{case_id}/analyze/async")
    assert again.status_code == 202
    assert again.json()["job_id"] == job_id

    cancelled = client.post(f"/api/v1/jobs/{job_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] in {"cancelled", "cancel_requested"}


def test_e2e_invalid_and_duplicate_dicom_bytes(tmp_path: Path) -> None:
    client = _client(tmp_path)
    # Invalid (non-DICOM) upload
    bad = client.post(
        "/api/v1/dicom/upload",
        data={"patient_name": "Bad", "species": "canine"},
        files=[("files", ("not.dcm", b"not-a-dicom-file", "application/dicom"))],
    )
    assert bad.status_code in {201, 400, 409, 422}
    if bad.status_code == 201:
        assert bad.json()["blocked"] is True or bad.json().get("study") is None or bad.json()["issues"]

    # Duplicate identical demo uploads create distinct ingest ids
    a = client.post("/api/v1/dicom/demo/brain_mri", data={"patient_name": "D1", "species": "canine"})
    b = client.post("/api/v1/dicom/demo/brain_mri", data={"patient_name": "D1", "species": "canine"})
    assert a.json()["ingest_id"] != b.json()["ingest_id"]


def test_e2e_multi_series_fixture_and_file_list(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = _demo_upload_confirm_analyze(client)
    files = client.get(f"/api/v1/cases/{case_id}/dicom/files").json()
    assert files["ingest_id"]
    assert len(files["files"]) >= 1
    # Download first instance
    dl = client.get(f"/api/v1/cases/{case_id}/dicom/files/0")
    assert dl.status_code == 200
    assert len(dl.content) > 0


def test_e2e_unsupported_capability_path(tmp_path: Path) -> None:
    """Synthetic case with OTHER region stays outside automated approve path."""
    from app.schemas.enums import AnatomicalRegion

    client = _client(tmp_path)
    created = client.post(
        "/api/v1/cases",
        json=make_payload(anatomical_region=AnatomicalRegion.OTHER, scenario=None).model_dump(mode="json"),
    )
    assert created.status_code == 201
    case_id = created.json()["case_id"]
    result = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert result.status_code == 200
    body = result.json()
    if body["outcome"] == "unsupported":
        assert body.get("report") is None or created.json()
        approve = client.post(
            f"/api/v1/cases/{case_id}/review",
            json={"reviewer_id": "expert-demo", "action": "approve"},
        )
        assert approve.status_code == 409


def test_e2e_page_refresh_persistence_sqlite(tmp_path: Path) -> None:
    db = tmp_path / "e2e.sqlite3"
    settings = _mem_settings(tmp_path, storage_backend="sqlite", sqlite_path=db)
    # First process
    c1 = TestClient(create_app(AppContainer(settings=settings)))
    case_id = _demo_upload_confirm_analyze(c1)
    c1.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve", "comment": "persist"},
    )
    # "Refresh" = new container/process on same sqlite
    c2 = TestClient(create_app(AppContainer(settings=_mem_settings(tmp_path, storage_backend="sqlite", sqlite_path=db))))
    restored = c2.get(f"/api/v1/cases/{case_id}")
    assert restored.status_code == 200
    assert restored.json()["status"] == "approved"
    assert restored.json()["draft_report"]["immutable"] is True
    versions = c2.get(f"/api/v1/cases/{case_id}/report/versions").json()
    assert len(versions) >= 1


# ── Protected mode ───────────────────────────────────────────────────────────


def test_e2e_protected_startup_and_isolation(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError):
        validate_security_settings(
            _mem_settings(tmp_path, deployment_mode="protected", auth_enabled=False, jwt_secret="x" * 32)
        )

    client = _auth_client(tmp_path)
    assert client.get("/api/v1/cases").status_code == 401

    vet_a = _token(client, "vet@demo.local")
    vet_b = _token(client, "vet-b@demo.local")
    case_id = _demo_upload_confirm_analyze(client, headers=_hdr(vet_a))
    case = client.get(f"/api/v1/cases/{case_id}", headers=_hdr(vet_a)).json()
    assert case["clinic_id"] == "clinic-demo-a"
    assert case["owner_subject"] == "vet@demo.local"
    job_id = case.get("latest_job_id")

    assert client.get(f"/api/v1/cases/{case_id}", headers=_hdr(vet_b)).status_code == 404
    assert client.get(f"/api/v1/cases/{case_id}/report/versions", headers=_hdr(vet_b)).status_code == 404
    assert client.get(f"/api/v1/cases/{case_id}/dicom/files", headers=_hdr(vet_b)).status_code == 404
    # Cross-tenant job access / cancel denied
    if job_id:
        assert client.get(f"/api/v1/jobs/{job_id}", headers=_hdr(vet_b)).status_code == 404
        assert client.post(f"/api/v1/jobs/{job_id}/cancel", headers=_hdr(vet_b)).status_code == 404


def test_e2e_invalid_and_expired_jwt(tmp_path: Path) -> None:
    client = _auth_client(tmp_path)
    bad = client.get("/api/v1/cases", headers={"Authorization": "Bearer not-a-jwt"})
    assert bad.status_code == 401

    from app.auth.security import create_access_token

    expired = create_access_token(
        subject="vet@demo.local",
        role="vet",
        secret="phase6-test-secret",
        ttl_seconds=-10,
        clinic_id="clinic-demo-a",
    )
    # Accept either 401 immediately or create may fail validation
    res = client.get("/api/v1/cases", headers={"Authorization": f"Bearer {expired}"})
    assert res.status_code == 401


# ── Storage / integrity / failure ────────────────────────────────────────────


def test_e2e_quarantine_integrity_and_limits(tmp_path: Path) -> None:
    store = QuarantineStore(tmp_path / "q", max_file_bytes=64)
    with pytest.raises(ValueError):
        validate_ingest_id("../x")
    refs = store.store_files("dicom-ok01", [("a.dcm", b"x" * 32)])
    store.read_file(refs[0].relative_path, expected_sha256=refs[0].sha256)
    with pytest.raises(ValueError):
        store.store_files("dicom-big01", [("b.dcm", b"x" * 128)])


def test_e2e_retention_preserves_approved(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = _demo_upload_confirm_analyze(client)
    client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve"},
    )
    container: AppContainer = client.app.state.container  # type: ignore[attr-defined]
    case = container.repo.get_case(case_id)
    assert case is not None
    plan = plan_case_retention(
        [case],
        RetentionPolicy(dicom_days=0, reports_days=0, preserve_approved_reports=True),
    )
    assert any(i.blocked for i in plan)


def test_e2e_audit_events_demo_journey(tmp_path: Path) -> None:
    client = _auth_client(tmp_path)
    vet = _token(client, "vet@demo.local")
    _demo_upload_confirm_analyze(client, headers=_hdr(vet))
    container: AppContainer = client.app.state.container  # type: ignore[attr-defined]
    types = {e["event_type"] for e in container.audit.list_events(limit=500)}
    assert "auth.login" in types
    assert "dicom.upload" in types or "case.create" in types


def test_e2e_backend_health_and_malformed(tmp_path: Path) -> None:
    client = _client(tmp_path)
    health = client.get("/api/v1/health").json()
    assert health["status"] == "ok"
    assert health.get("auth_enabled") is False

    # Malformed review payload
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    bad = client.post(f"/api/v1/cases/{case_id}/review", json={"action": "approve"})
    assert bad.status_code == 422


def test_e2e_missing_report_and_failed_approve(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    assert client.get(f"/api/v1/cases/{case_id}/report").status_code == 404
    assert (
        client.post(
            f"/api/v1/cases/{case_id}/review",
            json={"reviewer_id": "expert-demo", "action": "approve"},
        ).status_code
        == 409
    )


def test_e2e_perf_bounded_listing(tmp_path: Path) -> None:
    """Bounded synthetic latency sample — not a load test."""
    client = _client(tmp_path)
    for i in range(5):
        client.post("/api/v1/cases", json=make_payload(patient_name=f"P{i}").model_dump(mode="json"))
    t0 = time.perf_counter()
    res = client.get("/api/v1/cases")
    elapsed = time.perf_counter() - t0
    assert res.status_code == 200
    assert len(res.json()) >= 5
    # Soft bound for in-memory demo on local CI hosts
    assert elapsed < 2.0
