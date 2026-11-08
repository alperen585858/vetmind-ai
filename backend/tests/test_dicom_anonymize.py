"""P0.5 — DICOM identity scrub."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from pydicom import dcmread

from app.dicom.anonymize import scrub_dicom_bytes
from app.dicom.fixtures import brain_mri_study_files
from app.storage.quarantine import QuarantineStore


def test_scrub_clears_patient_name() -> None:
    _name, data = brain_mri_study_files(1)[0]
    ds0 = dcmread(BytesIO(data))
    assert str(ds0.PatientName)
    scrubbed = scrub_dicom_bytes(data)
    ds = dcmread(BytesIO(scrubbed))
    assert str(ds.PatientName) in {"ANONYMIZED", ""}
    assert str(ds.PatientID) == "ANON"


def test_quarantine_scrub_on_store(tmp_path: Path) -> None:
    store = QuarantineStore(tmp_path / "q", scrub_identity=True)
    files = brain_mri_study_files(1)
    refs = store.store_files("dicom-anon", files, content_kinds=["dicom"])
    _n, data = store.read_file(refs[0].relative_path)
    ds = dcmread(BytesIO(data))
    assert str(ds.PatientName) in {"ANONYMIZED", ""}
