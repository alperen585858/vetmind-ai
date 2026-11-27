"""Demo-only endpoints must refuse protected deployment mode."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _settings(tmp_path: Path, **kwargs) -> Settings:
    base = dict(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="k" * 32,
        async_analyze_delay_ms=0,
        rag_backend="embedding",
        tenant_isolation=True,
        deployment_mode="demo",
        malware_scan_required=False,
        dicom_identity_scrub=False,
        audit_log_path=tmp_path / "audit.jsonl",
        max_concurrent_analyze=4,
        analyze_gate_path=tmp_path / "analyze_gate.count",
    )
    base.update(kwargs)
    return Settings(**base)


def _client(tmp_path: Path, **kwargs) -> TestClient:
    import os

    # Protected mode now requires an explicit scanner name (no UnavailableScanner-only boot).
    if kwargs.get("deployment_mode") == "protected":
        os.environ.setdefault("VETMIND_MALWARE_SCANNER", "fake_clean")
    return TestClient(
        create_app(AppContainer(repo=InMemoryCaseRepository(), settings=_settings(tmp_path, **kwargs)))
    )


def _auth(client: TestClient, email: str = "vet@demo.local") -> dict[str, str]:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_demo_dicom_forbidden_in_protected(tmp_path: Path) -> None:
    client = _client(
        tmp_path,
        deployment_mode="protected",
        malware_scan_required=True,
        dicom_identity_scrub=True,
        self_registration_enabled=False,
        # Signs in with a seed vet; protected mode only has them when asked for explicitly.
        demo_accounts=True,
    )
    res = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "Pax", "species": "canine"},
        headers=_auth(client),
    )
    assert res.status_code == 403
