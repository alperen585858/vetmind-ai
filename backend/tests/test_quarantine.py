"""Quarantine store + DICOM upload path retention."""

from pathlib import Path

from fastapi.testclient import TestClient

from app.dicom.fixtures import brain_mri_study_files
from app.schemas.enums import Species
from app.storage.quarantine import QuarantineStore


def test_quarantine_store_writes_manifest(tmp_path: Path) -> None:
    store = QuarantineStore(tmp_path / "q")
    refs = store.store_files("ingest-1", [("a.dcm", b"hello"), ("b.dcm", b"world")], content_kinds=["dicom", "dicom"])
    assert len(refs) == 2
    assert (tmp_path / "q" / "ingest-1" / "manifest.json").is_file()
    assert Path(refs[0].absolute_path).read_bytes() == b"hello"


def test_api_upload_retains_quarantine(client: TestClient) -> None:
    files = brain_mri_study_files(2)
    upload = client.post(
        "/api/v1/dicom/upload",
        data={"patient_name": "Quarantine Demo", "species": Species.CANINE.value},
        files=[("files", (name, data, "application/dicom")) for name, data in files],
    )
    assert upload.status_code == 201, upload.text
    body = upload.json()
    assert body["quarantined_file_count"] == 2
    assert body["quarantine_dir"]
    qdir = Path(body["quarantine_dir"])
    assert qdir.is_dir()
    assert (qdir / "manifest.json").is_file()

    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{body['ingest_id']}/confirm",
        json={"accept_suggestion": True},
    )
    assert confirmed.status_code == 200
    case = confirmed.json()
    assert case["quarantine_dir"]
    assert case["model_input"]["quarantined_instance_count"] == 2
    assert any(f.get("quarantine_relative_path") for s in case["model_input"]["series"] for f in s["frames"])
