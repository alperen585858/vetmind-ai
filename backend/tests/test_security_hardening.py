"""Regression tests for the security audit fixes (auth, docs/health exposure, uploads, headers)."""

from __future__ import annotations

import socket
import struct
import threading
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.api.auth as auth_api
from app.auth.security import DEFAULT_JWT_SECRET
from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings, validate_security_settings
from app.storage.malware_scan import ClamdScanner, ScanResult

API_KEY = "test-api-key"


def _settings(tmp_path: Path, **kwargs) -> Settings:
    base = dict(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key=API_KEY,
        jwt_secret="k" * 32,
        async_analyze_delay_ms=0,
        rag_backend="embedding",
        tenant_isolation=True,
        deployment_mode="protected",
        malware_scan_required=True,
        dicom_identity_scrub=True,
        self_registration_enabled=False,
        demo_accounts=True,
        auth_rate_limit_enabled=False,
        audit_log_path=tmp_path / "audit.jsonl",
        max_concurrent_analyze=4,
        analyze_gate_path=tmp_path / "analyze_gate.count",
    )
    base.update(kwargs)
    return Settings(**base)


def _client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch | None = None, **kwargs) -> TestClient:
    if monkeypatch is not None:
        monkeypatch.setenv("VETMIND_MALWARE_SCANNER", "fake_clean")
    return TestClient(
        create_app(AppContainer(repo=InMemoryCaseRepository(), settings=_settings(tmp_path, **kwargs)))
    )


def _demo_client(tmp_path: Path) -> TestClient:
    return _client(
        tmp_path,
        auth_enabled=False,
        deployment_mode="demo",
        malware_scan_required=False,
        dicom_identity_scrub=False,
        tenant_isolation=False,
    )


def _bearer(client: TestClient, email: str) -> dict[str, str]:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


# --- login timing -------------------------------------------------------------


def test_unknown_email_still_runs_a_password_hash_check(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = _client(tmp_path, monkeypatch)
    calls: list[str] = []
    real = auth_api.verify_password

    def counting(provided: str, expected: str) -> bool:
        calls.append(expected)
        return real(provided, expected)

    monkeypatch.setattr(auth_api, "verify_password", counting)
    res = client.post("/api/v1/auth/login", json={"email": "nobody@nowhere.test", "password": "whatever1"})
    assert res.status_code == 401
    assert calls and calls[0].startswith("scrypt$")


# --- JWT secret ---------------------------------------------------------------


def test_default_jwt_secret_refused_whenever_auth_is_on(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="public demo default"):
        validate_security_settings(
            _settings(tmp_path, deployment_mode="demo", jwt_secret=DEFAULT_JWT_SECRET, allow_insecure_demo=True)
        )


def test_insecure_demo_flag_refused_in_protected_mode(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VETMIND_MALWARE_SCANNER", "fake_clean")
    with pytest.raises(RuntimeError, match="ALLOW_INSECURE_DEMO"):
        validate_security_settings(_settings(tmp_path, allow_insecure_demo=True))


# --- API docs and health ------------------------------------------------------


def test_api_docs_hidden_when_auth_is_on(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(tmp_path, monkeypatch)
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path


def test_api_docs_available_in_local_demo(tmp_path: Path) -> None:
    assert _demo_client(tmp_path).get("/openapi.json").status_code == 200


def test_health_details_only_for_admins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(tmp_path, monkeypatch)
    anonymous = client.get("/api/v1/health").json()
    assert anonymous["status"] == "ok"
    assert "llm_provider" not in anonymous and "storage" not in anonymous
    vet = client.get("/api/v1/health", headers=_bearer(client, "vet@demo.local")).json()
    assert "llm_provider" not in vet
    admin = client.get("/api/v1/health", headers=_bearer(client, "admin@demo.local")).json()
    assert "llm_provider" in admin
    assert "llm_provider" in client.get("/api/v1/health", headers={"X-API-Key": API_KEY}).json()


# --- security headers ---------------------------------------------------------


def test_api_responses_carry_security_headers(tmp_path: Path) -> None:
    res = _demo_client(tmp_path).get("/api/v1/health")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["X-Frame-Options"] == "DENY"
    assert res.headers["Cache-Control"] == "no-store"


# --- malware scanning ---------------------------------------------------------


def _fake_clamd(reply: bytes) -> tuple[int, threading.Thread]:
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    port = server.getsockname()[1]

    def serve() -> None:
        conn, _ = server.accept()
        with conn:
            buf = b""
            while not buf.endswith(struct.pack("!I", 0)):
                part = conn.recv(65536)
                if not part:
                    break
                buf += part
            assert buf.startswith(b"zINSTREAM\0")
            conn.sendall(reply)
        server.close()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    return port, thread


def test_clamd_clean_reply() -> None:
    port, thread = _fake_clamd(b"stream: OK\0")
    result = ClamdScanner(host="127.0.0.1", port=port, timeout_s=5).scan(b"hello", filename="a.pdf")
    thread.join(5)
    assert result.clean and not result.infected


def test_clamd_detection_reply() -> None:
    port, thread = _fake_clamd(b"stream: Eicar-Test-Signature FOUND\0")
    result = ClamdScanner(host="127.0.0.1", port=port, timeout_s=5).scan(b"X5O!P%@AP", filename="a.pdf")
    thread.join(5)
    assert not result.clean and result.infected
    assert "Eicar-Test-Signature" in result.detail


def test_clamd_unreachable_fails_closed() -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    result = ClamdScanner(host="127.0.0.1", port=port, timeout_s=1).scan(b"x", filename="a.pdf")
    assert not result.clean and not result.infected


def test_protected_mode_refuses_always_clean_scanner(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VETMIND_MALWARE_SCANNER", "fake_clean")
    monkeypatch.delenv("VETMIND_ALLOW_TEST_SCANNER", raising=False)
    with pytest.raises(RuntimeError, match="clamav"):
        validate_security_settings(_settings(tmp_path))
    monkeypatch.setenv("VETMIND_MALWARE_SCANNER", "clamav")
    validate_security_settings(_settings(tmp_path))


class _InfectedScanner:
    def scan(self, data: bytes, *, filename: str) -> ScanResult:
        return ScanResult(clean=False, engine="test", detail="malware detected (Test)", infected=True)


class _DownScanner:
    def scan(self, data: bytes, *, filename: str) -> ScanResult:
        return ScanResult(clean=False, engine="test", detail="scanner unreachable")


@pytest.mark.parametrize(("scanner", "expected"), [(_InfectedScanner(), 422), (_DownScanner(), 503)])
def test_document_uploads_are_scanned(tmp_path: Path, scanner: object, expected: int) -> None:
    client = _demo_client(tmp_path)
    client.app.state.container.documents._malware_scanner = scanner  # type: ignore[attr-defined]
    res = client.post(
        "/api/v1/documents/upload",
        data={"patient_name": "Pax", "species": "canine"},
        files=[("files", ("note.txt", b"history", "text/plain"))],
        headers={"X-VetMind-Demo-Role": "vet"},
    )
    assert res.status_code == expected, res.text


def test_oversized_upload_is_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.api.documents as documents_api

    monkeypatch.setattr(documents_api, "_MAX_FILE_BYTES", 10)
    res = _demo_client(tmp_path).post(
        "/api/v1/documents/upload",
        data={"patient_name": "Pax", "species": "canine"},
        files=[("files", ("note.txt", b"x" * 1000, "text/plain"))],
        headers={"X-VetMind-Demo-Role": "vet"},
    )
    assert res.status_code == 413


# --- report links -------------------------------------------------------------


def test_report_link_token_not_accepted_in_query_string(tmp_path: Path) -> None:
    client = _demo_client(tmp_path)
    assert client.get("/api/v1/public/report-view?token=abcdefghijkl").status_code == 405
    assert client.post("/api/v1/public/report-view", json={"token": "abcdefghijkl"}).status_code == 404


# --- admin account takeover ---------------------------------------------------


def test_admin_cannot_take_over_another_admin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(tmp_path, monkeypatch)
    key = {"X-API-Key": API_KEY}
    created = client.post(
        "/api/v1/admin/users",
        headers=key,
        json={"email": "second-admin@clinic.test", "password": "Str0ng-pass!", "role": "admin"},
    )
    assert created.status_code in (200, 201), created.text
    admin = _bearer(client, "admin@demo.local")
    target = "/api/v1/admin/users/second-admin@clinic.test"
    assert client.post(f"{target}/reset-link", headers=admin).status_code == 403
    assert client.post(f"{target}/mfa-reset", headers=admin).status_code == 403
    assert client.patch(target, headers=admin, json={"password": "An0ther-pass!"}).status_code == 403
    # Non-admin targets and the operator API key keep working.
    assert client.post("/api/v1/admin/users/vet@demo.local/reset-link", headers=admin).status_code == 200
    assert client.post(f"{target}/reset-link", headers=key).status_code == 200


def test_settings_replace_keeps_dataclass_usable(tmp_path: Path) -> None:
    # Guard for the new demo_accounts field: dataclasses.replace still works on Settings.
    assert replace(_settings(tmp_path), demo_accounts=False).demo_accounts is False
