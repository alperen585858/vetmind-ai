"""Phase 14 — pet owner submissions, vet verification, ACL, admin users."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from helpers_payment import approve_demo_payment


def _client(tmp_path: Path, *, isolation: bool = True) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-phase14",
        tenant_isolation=isolation,
        async_analyze_delay_ms=0,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def _token(client: TestClient, email: str) -> str:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _hdr(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_owner_pet_submission_vet_accept_and_owner_report_acl(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")

    pet = client.post(
        "/api/v1/pets",
        json={
            "name": "Pamuk",
            "species": "feline",
            "breed": "Tekir",
            "age_years": 4,
            "medical_history": "Önceki otitis",
        },
        headers=_hdr(owner),
    )
    assert pet.status_code == 201, pet.text
    pet_id = pet.json()["pet_id"]

    # Owner cannot create clinical cases directly
    denied = client.post(
        "/api/v1/cases",
        json={
            "patient_name": "Hack",
            "species": "feline",
            "modality": "MR",
            "anatomical_region": "BRAIN",
        },
        headers=_hdr(owner),
    )
    assert denied.status_code == 403

    sub = client.post(
        "/api/v1/submissions",
        json={"pet_id": pet_id, "chief_complaint": "Topallık", "clinical_notes": "3 gündür"},
        headers=_hdr(owner),
    )
    assert sub.status_code == 201, sub.text
    sub_id = sub.json()["submission_id"]
    assert sub.json()["status"] == "draft"
    approve_demo_payment(client, sub_id, _hdr(owner))
    finalized = client.get(f"/api/v1/submissions/{sub_id}", headers=_hdr(owner))
    assert finalized.status_code == 200
    assert finalized.json()["status"] == "pending_verification"

    # Vet requests missing info
    need = client.post(
        f"/api/v1/submissions/{sub_id}/vet-action",
        json={"action": "request_info", "missing_info_request": "Nöro muayene notu eksik"},
        headers=_hdr(vet),
    )
    assert need.status_code == 200
    assert need.json()["status"] == "needs_info"

    # Owner updates notes → back to pending
    upd = client.patch(
        f"/api/v1/submissions/{sub_id}",
        json={"clinical_notes": "Nöro: ataksi var"},
        headers=_hdr(owner),
    )
    assert upd.status_code == 200
    assert upd.json()["status"] == "pending_verification"

    accepted = client.post(
        f"/api/v1/submissions/{sub_id}/vet-action",
        json={"action": "accept", "assigned_reviewer_id": "expert@demo.local", "run_analyze": True},
        headers=_hdr(vet),
    )
    assert accepted.status_code == 200, accepted.text
    case = accepted.json()
    assert case["pet_owner_subject"] == "owner@demo.local"
    assert case["vet_verified"] is True
    case_id = case["case_id"]

    # Owner cannot see non-approved case
    hidden = client.get(f"/api/v1/cases/{case_id}", headers=_hdr(owner))
    assert hidden.status_code == 404

    # Ensure awaiting_review then expert approves
    if case["status"] != "awaiting_review":
        client.post(f"/api/v1/cases/{case_id}/analyze", headers=_hdr(vet))
    ok = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert", "action": "approve", "comment": "ok"},
        headers=_hdr(expert),
    )
    assert ok.status_code == 200, ok.text

    visible = client.get(f"/api/v1/cases/{case_id}", headers=_hdr(owner))
    assert visible.status_code == 200
    assert visible.json()["status"] == "approved"

    # Other clinic owner cannot see
    # (same clinic demo owner is the only owner — create second pet path covered by isolation)


def test_owner_cannot_list_clinic_drafts(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    owner = _token(client, "owner@demo.local")
    created = client.post(
        "/api/v1/cases",
        json={
            "patient_name": "ClinicDog",
            "species": "canine",
            "modality": "MR",
            "anatomical_region": "BRAIN",
            "clinical_history": "vet-created",
        },
        headers=_hdr(vet),
    )
    assert created.status_code == 201
    listed = client.get("/api/v1/cases", headers=_hdr(owner))
    assert listed.status_code == 200
    assert all(r["status"] == "approved" for r in listed.json())
    assert created.json()["case_id"] not in {r["case_id"] for r in listed.json()}


def test_vet_can_assign_radiologist(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    created = client.post(
        "/api/v1/cases",
        json={
            "patient_name": "AssignMe",
            "species": "canine",
            "modality": "MR",
            "anatomical_region": "BRAIN",
        },
        headers=_hdr(vet),
    )
    case_id = created.json()["case_id"]
    assigned = client.patch(
        f"/api/v1/cases/{case_id}/assignment",
        json={"assigned_reviewer_id": "expert@demo.local", "priority": "stat"},
        headers=_hdr(vet),
    )
    assert assigned.status_code == 200
    assert assigned.json()["assigned_reviewer_id"] == "expert@demo.local"
    assert assigned.json()["priority"] == "stat"


def test_admin_user_management(tmp_path: Path) -> None:
    client = _client(tmp_path)
    admin = _token(client, "admin@demo.local")
    created = client.post(
        "/api/v1/admin/users",
        json={
            "email": "newvet@demo.local",
            "password": "demo1234",
            "role": "vet",
            "clinic_id": "clinic-demo-a",
            "display_name": "New Vet",
        },
        headers=_hdr(admin),
    )
    assert created.status_code == 201, created.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "newvet@demo.local", "password": "demo1234"},
    )
    assert login.status_code == 200
    assert login.json()["role"] == "vet"

    users = client.get("/api/v1/admin/users", headers=_hdr(admin))
    assert users.status_code == 200
    assert any(u["email"] == "newvet@demo.local" for u in users.json())
    assert all(u.get("password") is None for u in users.json())


def test_clinic_owner_stats(tmp_path: Path) -> None:
    client = _client(tmp_path)
    co = _token(client, "clinic-owner@demo.local")
    stats = client.get("/api/v1/clinic/stats", headers=_hdr(co))
    assert stats.status_code == 200
    assert stats.json()["clinic_id"] == "clinic-demo-a"


def test_owner_can_attach_dicom_but_cannot_confirm_case(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")

    pet = client.post(
        "/api/v1/pets",
        json={"name": "Pax", "species": "canine"},
        headers=_hdr(owner),
    ).json()
    sub = client.post(
        "/api/v1/submissions",
        json={"pet_id": pet["pet_id"], "chief_complaint": "Öksürük"},
        headers=_hdr(owner),
    ).json()
    assert sub.get("dicom_ingest_id") in (None, "")

    dicom = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "Pax", "species": "canine", "clinical_history": "Owner attach"},
        headers=_hdr(owner),
    )
    assert dicom.status_code == 201, dicom.text
    ingest_id = dicom.json()["ingest_id"]

    linked = client.patch(
        f"/api/v1/submissions/{sub['submission_id']}",
        json={"dicom_ingest_id": ingest_id},
        headers=_hdr(owner),
    )
    assert linked.status_code == 200
    assert linked.json()["dicom_ingest_id"] == ingest_id
    assert linked.json()["pet_owner_subject"] == "owner@demo.local"

    # Owner can inspect their own ingest metadata + quarantine files.
    meta = client.get(f"/api/v1/dicom/ingestions/{ingest_id}", headers=_hdr(owner))
    assert meta.status_code == 200, meta.text
    assert meta.json()["ingest_id"] == ingest_id
    assert meta.json()["owner_subject"] == "owner@demo.local"
    assert meta.json()["study"] is not None

    listing = client.get(f"/api/v1/dicom/ingestions/{ingest_id}/files", headers=_hdr(owner))
    assert listing.status_code == 200, listing.text
    assert len(listing.json()["files"]) >= 1
    dl = client.get(f"/api/v1/dicom/ingestions/{ingest_id}/files/0", headers=_hdr(owner))
    assert dl.status_code == 200
    assert len(dl.content) > 100

    # Owners must not open a clinical case via confirm (vet verification required).
    denied = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={
            "accept_suggestion": True,
            "imaging_source_permission_verified": True,
            "imaging_analysis_consent_verified": True,
        },
        headers=_hdr(owner),
    )
    assert denied.status_code == 403


def test_vet_accept_binds_owner_dicom_via_confirm(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "owner@demo.local")
    vet = _token(client, "vet@demo.local")

    pet = client.post(
        "/api/v1/pets",
        json={"name": "Duman", "species": "canine", "breed": "Golden"},
        headers=_hdr(owner),
    ).json()
    sub = client.post(
        "/api/v1/submissions",
        json={"pet_id": pet["pet_id"], "chief_complaint": "Ataksi"},
        headers=_hdr(owner),
    ).json()

    dicom = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={
            "patient_name": "Duman",
            "species": "canine",
            "clinical_history": "Owner upload",
            "referring_clinic": "clinic-demo-a",
        },
        headers=_hdr(owner),
    )
    assert dicom.status_code == 201, dicom.text
    ingest_id = dicom.json()["ingest_id"]
    assert ingest_id
    assert dicom.json()["blocked"] is False

    linked = client.patch(
        f"/api/v1/submissions/{sub['submission_id']}",
        json={"dicom_ingest_id": ingest_id},
        headers=_hdr(owner),
    )
    assert linked.status_code == 200
    assert linked.json()["dicom_ingest_id"] == ingest_id

    approve_demo_payment(client, sub["submission_id"], _hdr(owner))

    accepted = client.post(
        f"/api/v1/submissions/{sub['submission_id']}/vet-action",
        json={"action": "accept", "run_analyze": False, "assigned_reviewer_id": "expert@demo.local"},
        headers=_hdr(vet),
    )
    assert accepted.status_code == 200, accepted.text
    case = accepted.json()
    assert case["dicom_ingest_id"] == ingest_id
    assert case["dicom_study"] is not None
    assert case["classification_confirmed"] is True
    assert case["pet_owner_subject"] == "owner@demo.local"
    assert case["owner_subject"] == "owner@demo.local"
    assert case["modality"] in {"MR", "CT", "XR"}

    files = client.get(f"/api/v1/cases/{case['case_id']}/dicom/files", headers=_hdr(vet))
    assert files.status_code == 200
    assert len(files.json()["files"]) >= 1
