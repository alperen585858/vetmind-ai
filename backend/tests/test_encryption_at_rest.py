"""#126: quarantine files encrypted on disk with AES-256-GCM; old plaintext still readable."""

from __future__ import annotations

import base64
import importlib.util
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.dicom.fixtures import brain_mri_study_files
from app.main import create_app
from app.settings import Settings, validate_security_settings
from app.storage.encryption import MAGIC, AesGcmEncryptor, NullEncryptor, open_blob
from app.storage.quarantine import QuarantineStore

KEY = base64.urlsafe_b64encode(os.urandom(32)).decode()


@pytest.fixture
def encrypted_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VETMIND_ENCRYPTION_AT_REST", "aes-gcm")
    monkeypatch.setenv("VETMIND_BLOB_KEY", KEY)


def test_files_are_ciphertext_on_disk_and_plaintext_through_the_store(tmp_path: Path, encrypted_env: None) -> None:
    store = QuarantineStore(tmp_path)
    (ref,) = store.store_files("ing-1", [("a.dcm", b"DICM-secret-pixels")])
    on_disk = (tmp_path / ref.relative_path).read_bytes()
    assert on_disk.startswith(MAGIC)
    assert b"secret" not in on_disk
    _name, data = store.read_file(ref.relative_path, expected_sha256=ref.sha256)  # sha256 = plaintext
    assert data == b"DICM-secret-pixels"
    assert open_blob(on_disk) == b"DICM-secret-pixels"  # direct readers (decoder) decrypt too


def test_plaintext_written_before_encryption_still_reads(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (ref,) = QuarantineStore(tmp_path, encryptor=NullEncryptor()).store_files("ing-2", [("a.dcm", b"old")])
    monkeypatch.setenv("VETMIND_ENCRYPTION_AT_REST", "aes-gcm")
    monkeypatch.setenv("VETMIND_BLOB_KEY", KEY)
    assert QuarantineStore(tmp_path).read_file(ref.relative_path)[1] == b"old"


def test_wrong_key_or_missing_key_never_returns_ciphertext(tmp_path: Path, encrypted_env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    (ref,) = QuarantineStore(tmp_path).store_files("ing-3", [("a.dcm", b"x" * 100)])
    other = AesGcmEncryptor(os.urandom(32))
    with pytest.raises(ValueError, match="authentication"):
        QuarantineStore(tmp_path, encryptor=other).read_file(ref.relative_path)
    monkeypatch.delenv("VETMIND_ENCRYPTION_AT_REST")
    with pytest.raises(RuntimeError, match="encrypted"):
        QuarantineStore(tmp_path).read_file(ref.relative_path)


def test_settings_refuse_bad_mode_or_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    base = dict(storage_backend="memory", sqlite_path=tmp_path / "x", quarantine_root=tmp_path / "q")
    with pytest.raises(RuntimeError, match="not supported"):
        validate_security_settings(Settings(**base, encryption_at_rest="rot13"))
    monkeypatch.setenv("VETMIND_BLOB_KEY", "too-short")
    with pytest.raises(RuntimeError, match="valid key"):
        validate_security_settings(Settings(**base, encryption_at_rest="aes-gcm"))
    monkeypatch.setenv("VETMIND_BLOB_KEY", KEY)
    validate_security_settings(Settings(**base, encryption_at_rest="aes-gcm"))


def test_upload_and_viewer_work_with_encryption(tmp_path: Path, encrypted_env: None) -> None:
    settings = Settings(
        storage_backend="memory", sqlite_path=tmp_path / "x", quarantine_root=tmp_path / "q",
        encryption_at_rest="aes-gcm",
    )
    container = AppContainer(settings=settings)
    client = TestClient(create_app(container))
    files = brain_mri_study_files(1)
    up = client.post(
        "/api/v1/dicom/upload",
        data={"patient_name": "Pax", "species": "canine"},
        files=[("files", (n, d, "application/dicom")) for n, d in files],
    )
    assert up.status_code == 201, up.text
    stored = [p for p in (tmp_path / "q").rglob("*") if p.is_file() and p.name != "manifest.json"]
    assert stored and all(p.read_bytes().startswith(MAGIC) for p in stored)
    assert container.encryption.mode == "aes-256-gcm"


def test_migration_script_encrypts_old_files_once(tmp_path: Path, encrypted_env: None) -> None:
    (ref,) = QuarantineStore(tmp_path, encryptor=NullEncryptor()).store_files("ing-4", [("a.dcm", b"plain")])
    spec = importlib.util.spec_from_file_location(
        "encrypt_quarantine", Path(__file__).resolve().parents[1] / "scripts" / "encrypt_quarantine.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.encrypt_tree(tmp_path, dry_run=True) == (1, 0)
    assert mod.encrypt_tree(tmp_path) == (1, 0)
    assert mod.encrypt_tree(tmp_path) == (0, 1)
    assert (tmp_path / ref.relative_path).read_bytes().startswith(MAGIC)
    assert QuarantineStore(tmp_path).read_file(ref.relative_path, expected_sha256=ref.sha256)[1] == b"plain"
