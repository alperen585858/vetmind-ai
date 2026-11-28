"""#125: upload limits fit a real MR/CT study, can be changed by env, text fields are bounded."""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.api.dicom as dicom_api
from app.container import AppContainer
from app.dicom.fixtures import brain_mri_study_files
from app.main import create_app
from app.settings import Settings


def test_defaults_fit_a_real_study() -> None:
    assert dicom_api._MAX_FILES >= 1000
    assert dicom_api._MAX_TOTAL_BYTES >= 512 * 1024 * 1024
    assert dicom_api._MAX_FILE_BYTES >= 64 * 1024 * 1024


def test_limits_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VETMIND_DICOM_MAX_FILES", "300")
    monkeypatch.setenv("VETMIND_DICOM_MAX_TOTAL_MB", "2048")
    monkeypatch.setenv("VETMIND_DICOM_MAX_FILE_MB", "not-a-number")
    try:
        mod = importlib.reload(dicom_api)
        assert mod._MAX_FILES == 300
        assert mod._MAX_TOTAL_BYTES == 2048 * 1024 * 1024
        assert mod._MAX_FILE_BYTES == 64 * 1024 * 1024  # bad value -> default
    finally:
        monkeypatch.undo()
        importlib.reload(dicom_api)


def test_overlong_clinical_history_is_rejected(tmp_path: Path) -> None:
    settings = Settings(storage_backend="memory", sqlite_path=tmp_path / "x.sqlite3", quarantine_root=tmp_path / "q")
    client = TestClient(create_app(AppContainer(settings=settings)))
    files = [("files", (n, d, "application/dicom")) for n, d in brain_mri_study_files(1)]
    res = client.post(
        "/api/v1/dicom/upload",
        data={"patient_name": "Pax", "species": "canine", "clinical_history": "x" * 10_001},
        files=files,
    )
    assert res.status_code == 422
