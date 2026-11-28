"""Phase 19 — multi-ingest case DICOM listing for advanced viewer."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.schemas.workflow import AttachmentRef
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-phase19",
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


def test_case_dicom_lists_all_linked_ingests(tmp_path: Path) -> None:
    """A case with several linked DICOM ingests (primary + attachment_refs) lists them all.

    New cases are opened by the vet directly; rows with extra ingests come from older
    (pre-B2B) data, so the second ingest is linked on the stored record here.
    """
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")

    d1 = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "Scout", "species": "canine", "clinical_history": "A"},
        headers=_hdr(vet),
    )
    assert d1.status_code in (200, 201), d1.text
    ingest1 = d1.json()["ingest_id"]
    d2 = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "Scout", "species": "canine", "clinical_history": "B"},
        headers=_hdr(vet),
    )
    assert d2.status_code in (200, 201), d2.text
    ingest2 = d2.json()["ingest_id"]

    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{ingest1}/confirm",
        json={"accept_suggestion": True, "patient_name": "Scout"},
        headers=_hdr(vet),
    )
    assert confirmed.status_code == 200, confirmed.text
    case = confirmed.json()
    assert case["dicom_ingest_id"] == ingest1

    container = client.app.state.container  # type: ignore[attr-defined]
    record = container.repo.get_case(case["case_id"])
    record.attachment_refs = [
        *record.attachment_refs,
        AttachmentRef(kind="dicom", ingest_id=ingest1, uploaded_by="vet@demo.local"),
        AttachmentRef(kind="dicom", ingest_id=ingest2, uploaded_by="vet@demo.local"),
    ]
    container.repo.save_case(record)

    listing = client.get(f"/api/v1/cases/{case['case_id']}/dicom/files", headers=_hdr(vet))
    assert listing.status_code == 200, listing.text
    body = listing.json()
    assert ingest1 in body["ingest_ids"]
    assert ingest2 in body["ingest_ids"]
    assert len(body["files"]) >= 2
    ingest_ids_in_files = {f["ingest_id"] for f in body["files"]}
    assert ingest1 in ingest_ids_in_files
    assert ingest2 in ingest_ids_in_files

    # Global index download works for a file from the second ingest
    second_idx = next(f["index"] for f in body["files"] if f["ingest_id"] == ingest2)
    dl = client.get(f"/api/v1/cases/{case['case_id']}/dicom/files/{second_idx}", headers=_hdr(vet))
    assert dl.status_code == 200
    assert len(dl.content) > 100
    assert dl.headers.get("X-VetMind-Dicom-Ingest-Id") == ingest2
