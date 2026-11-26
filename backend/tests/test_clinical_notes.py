"""Clinical notes added after a case was sent (#68)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.llm.gateway import build_rag_query, compose_history
from app.main import create_app
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, ModelExecutionStatus, Species
from app.schemas.findings import StructuredFindings
from app.schemas.workflow import ClinicalNoteEntry
from app.llm.clinical_notes import clinical_notes_text, history_with_notes, strip_note_stamps
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings

LEGACY = (
    "Arka bacaklarda güçsüzlük.\n\n"
    "[2026-11-23T12:04:39.984157+00:00 · anonymous] aaa\n\n"
    "[2026-11-23T13:10:00+00:00 · vet@demo.local] Derin ağrı var.\nİkinci satır."
)


def _note(body: str, kind: str = "clinical") -> ClinicalNoteEntry:
    return ClinicalNoteEntry(body=body, author_subject="vet@demo.local", author_role="vet", kind=kind)


def _case(history: str, notes: list[ClinicalNoteEntry]) -> CaseRecord:
    now = datetime.now(timezone.utc)
    return CaseRecord(
        case_id="case-notes",
        created_at=now,
        updated_at=now,
        patient_name="Pisi",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.THORACOLUMBAR,
        clinical_history=history,
        clinical_notes_log=notes,
    )


def test_legacy_stamps_are_stripped_and_other_text_kept():
    assert strip_note_stamps(LEGACY) == "Arka bacaklarda güçsüzlük."
    assert strip_note_stamps("[2026-11-23T12:04:39+00:00 · x] tek not") == ""
    assert strip_note_stamps("Normal öykü [köşeli parantez] içerir.") == "Normal öykü [köşeli parantez] içerir."
    assert strip_note_stamps(None) == ""


def test_notes_section_lists_clinical_notes_only():
    case = _case("Öykü.", [_note("Derin ağrı var."), _note("Uzman içi not", kind="internal")])
    assert clinical_notes_text(case) == "Vaka gönderildikten sonra eklenen klinik bilgi:\n- Derin ağrı var."
    assert clinical_notes_text(_case("Öykü.", [])) == ""
    assert history_with_notes(case).startswith("Öykü.\n\nVaka gönderildikten sonra")


def test_models_read_notes_as_their_own_section_without_stamps():
    case = _case(LEGACY, [_note("aaa"), _note("Derin ağrı var.")])
    history = compose_history(case)
    assert "anonymous" not in history and "2026-11-23T" not in history
    assert history.startswith("Arka bacaklarda güçsüzlük.")
    assert history.rstrip().endswith("- aaa\n- Derin ağrı var.")

    findings = StructuredFindings(
        case_id="case-notes",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.THORACOLUMBAR,
        source_model_id="mock",
        source_model_version="1",
        execution_status=ModelExecutionStatus.SUCCESS,
    )
    query = build_rag_query(case, findings)
    assert "Derin ağrı var." in query and "2026-11-23T" not in query


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-notes-68",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def _hdr(client: TestClient, email: str) -> dict[str, str]:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_api_note_keeps_history_and_records_author_name(tmp_path: Path):
    client = _client(tmp_path)
    vet = _hdr(client, "vet@demo.local")
    created = client.post(
        "/api/v1/cases",
        json={"patient_name": "Rex", "species": "canine", "modality": "MR", "anatomical_region": "BRAIN",
              "clinical_history": "Başlangıç öykü"},
        headers=vet,
    )
    assert created.status_code == 201, created.text
    cid = created.json()["case_id"]

    # No display name saved yet: only the e-mail is known, so no name is stored.
    first = client.post(f"/api/v1/cases/{cid}/clinical-notes", json={"body": "İlk not"}, headers=vet).json()
    assert first["clinical_history"] == "Başlangıç öykü"
    assert first["clinical_notes_log"][0]["author_name"] is None

    assert client.put("/api/v1/settings/me", json={"display_name": "Dr. Elif Kaya"}, headers=vet).status_code == 200
    second = client.post(f"/api/v1/cases/{cid}/clinical-notes", json={"body": "İkinci not"}, headers=vet).json()
    log = second["clinical_notes_log"]
    assert [n["body"] for n in log] == ["İlk not", "İkinci not"]
    assert log[1]["author_name"] == "Dr. Elif Kaya" and log[1]["author_role"] == "vet"
    assert second["clinical_history"] == "Başlangıç öykü"
