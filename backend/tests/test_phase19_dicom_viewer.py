"""Phase 19 — multi-ingest case DICOM listing for advanced viewer."""

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
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    vet = _token(client, "vet@demo.local")

    pet = client.post(
        "/api/v1/pets",
        json={"name": "Scout", "species": "canine"},
        headers=_hdr(owner),
    ).json()
    sub = client.post(
        "/api/v1/submissions",
        json={"pet_id": pet["pet_id"], "chief_complaint": "Ataksi"},
        headers=_hdr(owner),
    ).json()
    sid = sub["submission_id"]

    d1 = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "Scout", "species": "canine", "clinical_history": "A"},
        headers=_hdr(owner),
    )
    assert d1.status_code in (200, 201), d1.text
    ingest1 = d1.json()["ingest_id"]
    assert (
        client.post(
            f"/api/v1/submissions/{sid}/attachments",
            json={"kind": "dicom", "ingest_id": ingest1},
            headers=_hdr(owner),
        ).status_code
        == 200
    )

    d2 = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "Scout", "species": "canine", "clinical_history": "B"},
        headers=_hdr(owner),
    )
    assert d2.status_code in (200, 201), d2.text
    ingest2 = d2.json()["ingest_id"]
    assert (
        client.post(
            f"/api/v1/submissions/{sid}/attachments",
            json={"kind": "dicom", "ingest_id": ingest2},
            headers=_hdr(owner),
        ).status_code
        == 200
    )

    accepted = client.post(
        f"/api/v1/submissions/{sid}/vet-action",
        json={"action": "accept", "assigned_reviewer_id": "expert@demo.local"},
        headers=_hdr(vet),
    )
    assert accepted.status_code == 200, accepted.text
    case = accepted.json()
    assert case["case_id"]
    assert case["dicom_ingest_id"] == ingest1
    dicom_atts = [a for a in case.get("attachment_refs") or [] if a["kind"] == "dicom"]
    assert {a["ingest_id"] for a in dicom_atts} >= {ingest1, ingest2}

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
