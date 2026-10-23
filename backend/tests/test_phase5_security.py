"""Phase 5 — security, tenancy, quarantine, retention, audit."""

from __future__ import annotations

import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth.security import DEFAULT_JWT_SECRET, create_access_token, decode_token
from app.container import AppContainer
from app.main import create_app
from app.security.redaction import redact_text
from app.security.retention import RetentionPolicy, plan_case_retention
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings, validate_security_settings
from app.storage.quarantine import QuarantineStore, validate_ingest_id
from tests.conftest import make_payload


def _settings(tmp_path: Path, **kwargs) -> Settings:
    base = dict(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-phase5",
        async_analyze_delay_ms=0,
        rag_backend="embedding",
        tenant_isolation=True,
        deployment_mode="demo",
        malware_scan_required=False,
        audit_log_path=tmp_path / "audit.jsonl",
        max_concurrent_analyze=4,
        analyze_gate_path=tmp_path / "analyze_gate.count",
    )
    base.update(kwargs)
    return Settings(**base)


def _client(tmp_path: Path, **kwargs) -> TestClient:
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=_settings(tmp_path, **kwargs))))


def _token(client: TestClient, email: str) -> str:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_invalid_credentials(tmp_path: Path) -> None:
    client = _client(tmp_path)
    bad = client.post("/api/v1/auth/login", json={"email": "vet@demo.local", "password": "wrong"})
    assert bad.status_code == 401


def test_jwt_rejects_wrong_alg() -> None:
    token = create_access_token(subject="x", role="vet", secret="s", ttl_seconds=60)
    # Tamper header alg
    import base64
    import json

    h, p, sig = token.split(".")
    bad_h = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    with pytest.raises(ValueError, match="Unsupported"):
        decode_token(f"{bad_h}.{p}.{sig}", "s")


def test_insecure_default_secret_fail_closed(tmp_path: Path) -> None:
    settings = _settings(tmp_path, jwt_secret=DEFAULT_JWT_SECRET, allow_insecure_demo=False)
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        validate_security_settings(settings)


def test_protected_mode_requires_auth(tmp_path: Path) -> None:
    settings = _settings(tmp_path, auth_enabled=False, deployment_mode="protected", jwt_secret="x" * 32)
    with pytest.raises(RuntimeError, match="Protected deployment requires"):
        validate_security_settings(settings)


def test_cross_tenant_case_access_denied(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet_a = _token(client, "vet@demo.local")
    vet_b = _token(client, "vet-b@demo.local")
    created = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers=_auth(vet_a),
    )
    assert created.status_code == 201
    case_id = created.json()["case_id"]
    assert created.json()["clinic_id"] == "clinic-demo-a"

    denied = client.get(f"/api/v1/cases/{case_id}", headers=_auth(vet_b))
    assert denied.status_code == 404

    listed = client.get("/api/v1/cases", headers=_auth(vet_b)).json()
    assert all(c["case_id"] != case_id for c in listed)

    allowed = client.get(f"/api/v1/cases/{case_id}", headers=_auth(vet_a))
    assert allowed.status_code == 200


def test_cross_tenant_report_history_denied(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet_a = _token(client, "vet@demo.local")
    vet_b = _token(client, "vet-b@demo.local")
    case_id = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers=_auth(vet_a),
    ).json()["case_id"]
    client.post(f"/api/v1/cases/{case_id}/analyze", headers=_auth(vet_a))
    denied = client.get(f"/api/v1/cases/{case_id}/report/versions", headers=_auth(vet_b))
    assert denied.status_code == 404


def test_same_clinic_expert_can_review(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    case_id = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers=_auth(vet),
    ).json()["case_id"]
    client.post(f"/api/v1/cases/{case_id}/analyze", headers=_auth(vet))
    ok = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "spoofed", "action": "approve", "comment": "ok"},
        headers=_auth(expert),
    )
    assert ok.status_code == 200, ok.text
    # Reviewer bound to JWT subject
    assert ok.json()["draft_report"]["reviewed_by"] == "expert@demo.local"


def test_cross_tenant_expert_approval_denied(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    expert_b = _token(client, "expert-b@demo.local")
    case_id = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers=_auth(vet),
    ).json()["case_id"]
    client.post(f"/api/v1/cases/{case_id}/analyze", headers=_auth(vet))
    denied = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-b", "action": "approve"},
        headers=_auth(expert_b),
    )
    assert denied.status_code == 404


def test_unauthorized_job_cancel(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet_a = _token(client, "vet@demo.local")
    vet_b = _token(client, "vet-b@demo.local")
    case_id = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers=_auth(vet_a),
    ).json()["case_id"]
    job = client.post(f"/api/v1/cases/{case_id}/analyze/async", headers=_auth(vet_a)).json()
    denied = client.post(f"/api/v1/jobs/{job['job_id']}/cancel", headers=_auth(vet_b))
    assert denied.status_code == 404


def test_unauthorized_dicom_case_download(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet_a = _token(client, "vet@demo.local")
    vet_b = _token(client, "vet-b@demo.local")
    case_id = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers=_auth(vet_a),
    ).json()["case_id"]
    denied = client.get(f"/api/v1/cases/{case_id}/dicom/files", headers=_auth(vet_b))
    assert denied.status_code == 404


def test_legacy_unscoped_default_deny(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    # Create unscoped case directly (simulates pre-Phase-5 row)
    from app.schemas.case import CaseRecord
    from app.schemas.enums import AnatomicalRegion, Modality, Species

    orphan = CaseRecord(
        case_id="case-orphan",
        patient_name="Legacy",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        owner_subject=None,
        clinic_id=None,
    )
    container.repo.save_case(orphan)
    client = TestClient(create_app(container))
    vet = _token(client, "vet@demo.local")
    assert client.get("/api/v1/cases/case-orphan", headers=_auth(vet)).status_code == 404
    admin = _token(client, "admin@demo.local")
    assert client.get("/api/v1/cases/case-orphan", headers=_auth(admin)).status_code == 200


def test_path_traversal_ingest_id(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        validate_ingest_id("../etc")
    with pytest.raises(ValueError):
        validate_ingest_id("a/b")
    store = QuarantineStore(tmp_path / "q")
    with pytest.raises(ValueError):
        store.ingest_dir("..")


def test_hash_integrity_on_read(tmp_path: Path) -> None:
    store = QuarantineStore(tmp_path / "q")
    refs = store.store_files("dicom-abc123", [("a.dcm", b"DICOMBYTES")])
    assert refs[0].sha256
    name, data = store.read_file(refs[0].relative_path, expected_sha256=refs[0].sha256)
    assert data == b"DICOMBYTES"
    with pytest.raises(ValueError, match="integrity"):
        store.read_file(refs[0].relative_path, expected_sha256="0" * 64)


def test_oversized_quarantine_store(tmp_path: Path) -> None:
    store = QuarantineStore(tmp_path / "q", max_file_bytes=10)
    with pytest.raises(ValueError, match="max_file_bytes"):
        store.store_files("dicom-big1", [("big.dcm", b"x" * 20)])


def test_malware_scan_fail_closed(tmp_path: Path) -> None:
    client = _client(tmp_path, malware_scan_required=True)
    vet = _token(client, "vet@demo.local")
    # Even demo fixture upload hits scanner
    res = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={
            "patient_name": "Synth",
            "species": "canine",
        },
        headers=_auth(vet),
    )
    assert res.status_code == 503


def test_sensitive_log_redaction() -> None:
    sample = "patient_name=Pasha Bearer eyJhbGciOiJIUzI1NiJ9.abc api_key=secret123 user@clinic.com"
    red = redact_text(sample)
    assert "Pasha" not in red
    assert "eyJ" not in red
    assert "secret123" not in red
    assert "@clinic.com" not in red
    assert "[REDACTED" in red


def test_retention_preserves_approved_reports() -> None:
    from datetime import datetime, timedelta, timezone

    from app.schemas.case import CaseRecord
    from app.schemas.enums import AnatomicalRegion, Modality, ReportStatus, Species
    from app.schemas.report import DraftReport, GenerationMetadata, ReportSection

    old = datetime.now(timezone.utc) - timedelta(days=400)
    case = CaseRecord(
        case_id="case-old",
        created_at=old,
        patient_name="Synth",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        dicom_ingest_id="dicom-old",
        draft_report=DraftReport(
            report_id="r1",
            case_id="case-old",
            status=ReportStatus.APPROVED,
            immutable=True,
            generation=GenerationMetadata(
                provider_id="mock",
                model_id="m",
                model_version="1",
                generated_at=old,
                source_kind="mock",
            ),
            technique=ReportSection(text="t", cited_finding_ids=[]),
            findings=ReportSection(text="f", cited_finding_ids=[]),
            impression=ReportSection(text="i", cited_finding_ids=[]),
            recommendations=ReportSection(text="r", cited_finding_ids=[]),
        ),
    )
    plan = plan_case_retention([case], RetentionPolicy(dicom_days=30, reports_days=30))
    assert any(i.blocked for i in plan if i.kind == "dicom_ingest")
    assert any(i.blocked for i in plan if i.kind == "report")


def test_demo_mode_compatibility(client: TestClient) -> None:
    """Auth off: anonymous create still works (Phase 1–4 demo)."""
    status = client.get("/api/v1/auth/status").json()
    assert status["auth_enabled"] is False
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    assert created.status_code == 201
    assert created.json().get("clinic_id") is None


def test_report_immutability_regression(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    case_id = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers=_auth(vet),
    ).json()["case_id"]
    client.post(f"/api/v1/cases/{case_id}/analyze", headers=_auth(vet))
    client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert", "action": "approve"},
        headers=_auth(expert),
    )
    again = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert", "action": "approve"},
        headers=_auth(expert),
    )
    assert again.status_code == 409


def test_audit_records_login_and_case(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"), headers=_auth(vet))
    # Read via container on app
    container: AppContainer = client.app.state.container  # type: ignore[attr-defined]
    events = container.audit.list_events()
    types = {e["event_type"] for e in events}
    assert "auth.login" in types
    assert "case.create" in types
    # No patient name in audit payloads
    blob = str(events)
    assert "Pax" not in blob


def test_concurrent_analyze_limit(tmp_path: Path) -> None:
    """Semaphore rejects when max concurrent analyses exceeded (unit-level gate)."""
    settings = _settings(tmp_path, max_concurrent_analyze=1)
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    client = TestClient(create_app(container))
    vet = _token(client, "vet@demo.local")
    # Hold the durable gate so a second sync analyze gets 429
    assert container.cases._analyze_gate.try_acquire()  # noqa: SLF001
    case_id = client.post(
        "/api/v1/cases",
        json=make_payload().model_dump(mode="json"),
        headers=_auth(vet),
    ).json()["case_id"]
    res = client.post(f"/api/v1/cases/{case_id}/analyze", headers=_auth(vet))
    assert res.status_code == 429
    container.cases._analyze_gate.release()  # noqa: SLF001
