"""Issue #108 — clinic patient records, prior studies and case linking."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.schemas.patient import PatientRecord
from app.services.patient_service import fold
from app.services.patient_store import SqlPatientStore
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from app.storage.sql import Database
from tests.conftest import make_payload

PAMUK = {"name": "Pamuk", "species": "feline", "breed": "Van Kedisi", "microchip": "900 1234"}


# --- helpers ---------------------------------------------------------------------------


def _protected(tmp_path: Path) -> tuple[TestClient, AppContainer]:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-patients-123456789012345",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    return TestClient(create_app(container)), container


def _hdr(client: TestClient, email: str) -> dict[str, str]:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _patient(client: TestClient, headers: dict | None = None, **body) -> dict:
    res = client.post("/api/v1/patients", json={**PAMUK, **body}, headers=headers or {})
    assert res.status_code == 201, res.text
    return res.json()


def _case(client: TestClient, headers: dict | None = None, **kw) -> dict:
    res = client.post("/api/v1/cases", json=make_payload(**kw).model_dump(mode="json"), headers=headers or {})
    assert res.status_code == 201, res.text
    return res.json()


def _approve(client: TestClient, case_id: str, headers: dict | None = None) -> None:
    assert client.post(f"/api/v1/cases/{case_id}/analyze", headers=headers or {}).status_code == 200
    res = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve"},
        headers=headers or {},
    )
    assert res.status_code == 200, res.text


# --- model / store ---------------------------------------------------------------------


def test_fold_ignores_case_and_turkish_letters() -> None:
    assert fold("  PAŞA  Çığ ") == "pasa cig"
    assert fold(None) == ""


def test_sql_store_round_trip(tmp_path: Path) -> None:
    store = SqlPatientStore(Database.sqlite(tmp_path / "p.sqlite3").connect())
    p = store.save(PatientRecord(name="Pamuk", species="feline", clinic_id="c1"))
    assert store.get(p.patient_id) == p
    store.save(p.model_copy(update={"breed": "Van"}))
    assert store.get(p.patient_id).breed == "Van"
    assert [x.patient_id for x in store.list()] == [p.patient_id]
    assert store.get("pat-missing") is None


def test_case_without_patient_still_works(client: TestClient) -> None:
    case = _case(client)
    assert case["patient_id"] is None
    res = client.get(f"/api/v1/cases/{case['case_id']}/prior-studies")
    assert res.status_code == 200
    body = res.json()
    assert (body["patient"], body["studies"], body["suggestions"]) == (None, [], [])
    assert body["case_created_at"] and body["case_study_date"] is None


# --- CRUD + search ---------------------------------------------------------------------


def test_create_search_update(client: TestClient) -> None:
    created = _patient(client, name="  Pamuk  ")
    assert created["name"] == "Pamuk" and created["patient_id"].startswith("pat-")
    assert [p["patient_id"] for p in client.get("/api/v1/patients", params={"q": "PAMUK"}).json()] == [
        created["patient_id"]
    ]
    assert client.get("/api/v1/patients", params={"q": "9001234"}).json() == []  # spacing matters inside
    assert len(client.get("/api/v1/patients", params={"q": "900 12"}).json()) == 1
    upd = client.patch(f"/api/v1/patients/{created['patient_id']}", json={"breed": "Tekir", "sex": "dişi"})
    assert upd.status_code == 200 and upd.json()["breed"] == "Tekir"
    assert client.get(f"/api/v1/patients/{created['patient_id']}").json()["sex"] == "dişi"


def test_microchip_and_clinic_no_unique_in_clinic(client: TestClient) -> None:
    first = _patient(client, clinic_patient_no="K-1")
    dup = client.post("/api/v1/patients", json={**PAMUK, "name": "Başka"})
    assert dup.status_code == 409
    assert dup.json()["detail"]["code"] == "patient_microchip_taken"
    assert dup.json()["detail"]["patient_id"] == first["patient_id"]
    # Clinic numbers compare case- and space-insensitively.
    dup_no = client.post("/api/v1/patients", json={**PAMUK, "name": "Başka", "microchip": None, "clinic_patient_no": "k-1 "})
    assert dup_no.status_code == 409
    assert dup_no.json()["detail"]["code"] == "patient_clinic_patient_no_taken"
    # Editing a patient to an existing number is refused as well.
    second = _patient(client, name="Boncuk", microchip=None)
    res = client.patch(f"/api/v1/patients/{second['patient_id']}", json={"microchip": "900 1234"})
    assert res.status_code == 409


def test_unknown_patient_is_404(client: TestClient) -> None:
    assert client.get("/api/v1/patients/pat-nope").status_code == 404
    assert client.get("/api/v1/patients/pat-nope/studies").status_code == 404


# --- linking cases ---------------------------------------------------------------------


def test_new_case_with_patient_and_studies_list(client: TestClient) -> None:
    pat = _patient(client)
    old = _case(client, patient_id=pat["patient_id"], patient_name="Pamuk", species="feline")
    other_region = _case(
        client, patient_id=pat["patient_id"], patient_name="Pamuk", species="feline",
        modality="XR", anatomical_region="THORAX", scenario=None,
    )
    new = _case(client, patient_id=pat["patient_id"], patient_name="Pamuk", species="feline")
    assert new["patient_id"] == pat["patient_id"]

    res = client.get(f"/api/v1/cases/{new['case_id']}/prior-studies").json()
    assert res["patient"]["patient_id"] == pat["patient_id"]
    ids = [s["case_id"] for s in res["studies"]]
    assert new["case_id"] not in ids
    # Same modality + region first, then the rest.
    assert ids == [old["case_id"], other_region["case_id"]]
    assert [s["comparable"] for s in res["studies"]] == [True, False]

    all_studies = client.get(f"/api/v1/patients/{pat['patient_id']}/studies").json()["studies"]
    assert {s["case_id"] for s in all_studies} == {old["case_id"], other_region["case_id"], new["case_id"]}


def test_new_case_with_unknown_patient_is_rejected(client: TestClient) -> None:
    res = client.post("/api/v1/cases", json=make_payload(patient_id="pat-ghost").model_dump(mode="json"))
    assert res.status_code == 404


def test_approved_report_appears_as_excerpt(client: TestClient) -> None:
    pat = _patient(client)
    old = _case(client, patient_id=pat["patient_id"])
    _approve(client, old["case_id"])
    new = _case(client, patient_id=pat["patient_id"])
    row = client.get(f"/api/v1/cases/{new['case_id']}/prior-studies").json()["studies"][0]
    assert row["case_id"] == old["case_id"]
    assert row["approved_report_version"] is not None
    assert row["impression_excerpt"]


def test_link_and_unlink_existing_case(client: TestClient) -> None:
    case = _case(client)
    pat = _patient(client)
    linked = client.put(f"/api/v1/cases/{case['case_id']}/patient", json={"patient_id": pat["patient_id"]})
    assert linked.status_code == 200, linked.text
    assert linked.json()["patient_id"] == pat["patient_id"]
    assert client.get(f"/api/v1/cases/{case['case_id']}").json()["patient_id"] == pat["patient_id"]
    unlinked = client.put(f"/api/v1/cases/{case['case_id']}/patient", json={"patient_id": None})
    assert unlinked.json()["patient_id"] is None


def test_suggestions_by_name_and_species(client: TestClient) -> None:
    pat = _patient(client, name="Paşa", species="canine", microchip=None)
    _patient(client, name="Paşa", species="feline", microchip="1")  # other species: no match
    case = _case(client, patient_name="pasa", species="canine")
    sug = client.get(f"/api/v1/cases/{case['case_id']}/prior-studies").json()["suggestions"]
    assert [(s["patient"]["patient_id"], s["reason"]) for s in sug] == [(pat["patient_id"], "name_species")]
    # Nothing is linked automatically.
    assert client.get(f"/api/v1/cases/{case['case_id']}").json()["patient_id"] is None


def test_suggestion_by_dicom_patient_id(container: AppContainer, client: TestClient) -> None:
    pat = _patient(client, name="Zeytin", microchip=None)
    stored = container.patient_store.get(pat["patient_id"])
    container.patient_store.save(stored.model_copy(update={"dicom_patient_ids": ["VET-77"]}))
    case = _case(client, patient_name="Bambaşka İsim")
    record = container.repo.get_case(case["case_id"])
    from app.schemas.dicom import DicomStudyMeta

    record.dicom_study = DicomStudyMeta(study_instance_uid="1.2.3", patient_id_synthetic="VET-77")
    container.repo.save_case(record)
    sug = client.get(f"/api/v1/cases/{case['case_id']}/prior-studies").json()["suggestions"]
    assert [(s["patient"]["patient_id"], s["reason"]) for s in sug] == [(pat["patient_id"], "dicom_patient_id")]
    # Linking remembers the DICOM id only once.
    client.put(f"/api/v1/cases/{case['case_id']}/patient", json={"patient_id": pat["patient_id"]})
    assert container.patient_store.get(pat["patient_id"]).dicom_patient_ids == ["VET-77"]


# --- merge -----------------------------------------------------------------------------


def test_merge_moves_cases_and_hides_duplicate(client: TestClient) -> None:
    keep = _patient(client, microchip=None)
    dup = _patient(client, name="Pamuk (2)", microchip="555")
    case = _case(client, patient_id=dup["patient_id"])
    res = client.post(f"/api/v1/patients/{keep['patient_id']}/merge", json={"duplicate_patient_id": dup["patient_id"]})
    assert res.status_code == 200, res.text
    assert res.json()["microchip"] == "555"  # filled from the duplicate
    assert client.get(f"/api/v1/cases/{case['case_id']}").json()["patient_id"] == keep["patient_id"]
    assert client.get(f"/api/v1/patients/{dup['patient_id']}").status_code == 404
    assert all(p["patient_id"] != dup["patient_id"] for p in client.get("/api/v1/patients").json())


def test_merge_with_itself_is_rejected(client: TestClient) -> None:
    p = _patient(client)
    res = client.post(f"/api/v1/patients/{p['patient_id']}/merge", json={"duplicate_patient_id": p["patient_id"]})
    assert res.status_code == 422


# --- tenancy and roles (auth on) -------------------------------------------------------


def test_other_clinic_cannot_see_or_use_patient(tmp_path: Path) -> None:
    client, _ = _protected(tmp_path)
    vet_a, vet_b = _hdr(client, "vet@demo.local"), _hdr(client, "vet-b@demo.local")
    pat = _patient(client, vet_a)
    assert pat["clinic_id"] == "clinic-demo-a"
    assert client.get(f"/api/v1/patients/{pat['patient_id']}", headers=vet_b).status_code == 404
    assert client.get("/api/v1/patients", headers=vet_b).json() == []
    # Clinic B cannot attach a new case to clinic A's patient.
    res = client.post(
        "/api/v1/cases", json=make_payload(patient_id=pat["patient_id"]).model_dump(mode="json"), headers=vet_b
    )
    assert res.status_code == 404
    # Microchips are unique per clinic, not globally.
    assert client.post("/api/v1/patients", json=PAMUK, headers=vet_b).status_code == 201


def test_prior_studies_only_from_own_clinic(tmp_path: Path, ) -> None:
    client, container = _protected(tmp_path)
    vet_a = _hdr(client, "vet@demo.local")
    pat = _patient(client, vet_a)
    old = _case(client, vet_a, patient_id=pat["patient_id"])
    new = _case(client, vet_a, patient_id=pat["patient_id"])
    # A foreign-clinic case pointing at the same id (should never happen) stays invisible.
    foreign = container.repo.get_case(old["case_id"]).model_copy(
        update={"case_id": "case-foreign00001", "clinic_id": "clinic-demo-b", "owner_subject": "vet-b@demo.local"}
    )
    container.repo.save_case(foreign)
    ids = [s["case_id"] for s in client.get(f"/api/v1/cases/{new['case_id']}/prior-studies", headers=vet_a).json()["studies"]]
    assert ids == [old["case_id"]]


def test_expert_reads_but_cannot_create_patients(tmp_path: Path) -> None:
    client, _ = _protected(tmp_path)
    vet_a, expert = _hdr(client, "vet@demo.local"), _hdr(client, "expert@demo.local")
    pat = _patient(client, vet_a)
    assert client.get(f"/api/v1/patients/{pat['patient_id']}", headers=expert).status_code == 200
    assert client.post("/api/v1/patients", json={**PAMUK, "microchip": "x"}, headers=expert).status_code == 403


def test_only_owner_or_admin_merges(tmp_path: Path) -> None:
    client, _ = _protected(tmp_path)
    vet_a = _hdr(client, "vet@demo.local")
    a = _patient(client, vet_a, microchip=None)
    b = _patient(client, vet_a, name="Pamuk 2", microchip=None)
    body = {"duplicate_patient_id": b["patient_id"]}
    assert client.post(f"/api/v1/patients/{a['patient_id']}/merge", json=body, headers=vet_a).status_code == 403
    owner = _hdr(client, "clinic-owner@demo.local")
    assert client.post(f"/api/v1/patients/{a['patient_id']}/merge", json=body, headers=owner).status_code == 200


def test_patient_actions_are_audited(client: TestClient, container: AppContainer) -> None:
    pat = _patient(client)
    case = _case(client)
    client.put(f"/api/v1/cases/{case['case_id']}/patient", json={"patient_id": pat["patient_id"]})
    kinds = {e["event_type"] for e in container.audit.list_events(limit=200)}
    assert {"patient.create", "patient.link_case"} <= kinds


# --- backfill --------------------------------------------------------------------------

from app.patients_backfill import backfill_patients  # noqa: E402


def test_backfill_groups_cases_and_skips_ambiguous(client: TestClient, container: AppContainer) -> None:
    a1 = _case(client, patient_name="Pamuk", species="feline", breed="Van")
    a2 = _case(client, patient_name="PAMUK ", species="feline", breed=None)
    b1 = _case(client, patient_name="Karabaş", species="canine", breed="Kangal")
    b2 = _case(client, patient_name="karabas", species="canine", breed="Golden")
    already = _patient(client, name="Zeytin", microchip=None)
    linked = _case(client, patient_name="Zeytin", patient_id=already["patient_id"])

    dry = backfill_patients(container.repo, container.patient_store, dry_run=True)
    assert (dry.created, dry.linked_cases) == (1, 2)
    assert container.repo.get_case(a1["case_id"]).patient_id is None  # dry run changes nothing

    report = backfill_patients(container.repo, container.patient_store)
    assert (report.created, report.linked_cases) == (1, 2)
    assert [(s, b) for _c, _n, s, b in report.ambiguous] == [("canine", ["golden", "kangal"])]
    pid = container.repo.get_case(a1["case_id"]).patient_id
    assert pid and container.repo.get_case(a2["case_id"]).patient_id == pid
    assert container.patient_store.get(pid).breed == "Van"
    assert container.repo.get_case(b1["case_id"]).patient_id is None
    assert container.repo.get_case(b2["case_id"]).patient_id is None
    assert container.repo.get_case(linked["case_id"]).patient_id == already["patient_id"]
    # Running again finds nothing new.
    assert backfill_patients(container.repo, container.patient_store).created == 0
