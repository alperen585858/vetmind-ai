"""A configured local torch XR model must actually run end to end (skips without torch)."""

from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("torch")

from fastapi.testclient import TestClient  # noqa: E402

from app.container import AppContainer  # noqa: E402
from app.imaging.pixel_ops import TRANSFORM_HU_WINDOW  # noqa: E402
from app.imaging.profiles import xray_2d_profile  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.entrypoints.xray_monai import save_tiny_checkpoint  # noqa: E402
from app.models.weight_cache import cached_file_sha256  # noqa: E402
from app.services.repository import InMemoryCaseRepository  # noqa: E402
from app.settings import Settings  # noqa: E402


def _client(tmp_path: Path, **overrides) -> TestClient:
    weights = Path(save_tiny_checkpoint(str(tmp_path / "xr.pt")))
    fields = dict(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        async_analyze_delay_ms=0,
        rag_backend="embedding",
        auth_enabled=False,
        tenant_isolation=False,
        malware_scan_required=False,
        analyze_gate_path=tmp_path / "gate.count",
        pixel_analysis_opt_in=True,
        local_torch_model_id="vet-xr-thorax-v1",
        local_torch_entrypoint="app.models.entrypoints.xray_monai:build_entrypoint",
        local_torch_weights_path=str(weights),
        local_torch_weights_sha256=cached_file_sha256(weights),
        local_torch_modalities=("XR",),
        local_torch_regions=("THORAX",),
    )
    settings = Settings(**{**fields, **overrides})
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def _analyze_demo_thorax(client: TestClient) -> dict:
    up = client.post(
        "/api/v1/dicom/demo/thorax_xr",
        data={"patient_name": "Synth", "species": "canine", "clinical_history": "Synthetic test."},
    )
    assert up.status_code == 201, up.text
    conf = client.post(
        f"/api/v1/dicom/ingestions/{up.json()['ingest_id']}/confirm",
        json={
            "accept_suggestion": True,
            "imaging_source_permission_verified": True,
            "imaging_analysis_consent_verified": True,
        },
    )
    assert conf.status_code == 200, conf.text
    an = client.post(f"/api/v1/cases/{conf.json()['case_id']}/analyze")
    assert an.status_code == 200, an.text
    return an.json()


def test_configured_xr_model_runs_on_pixels(tmp_path: Path) -> None:
    # Used to fail with DENIED_MODEL_NOT_PIXEL_CAPABLE (capability registered after the adapter
    # copied the list) and then with hu_window demanding a CT window for a radiograph.
    body = _analyze_demo_thorax(_client(tmp_path))
    assert body["outcome"] == "success", body["job"].get("error_message")
    assert body["job"]["routed_model_ids"] == ["vet-xr-thorax-v1"]
    assert body["findings"]["source_kind"] == "real"


def test_wrong_weights_pin_is_enforced_on_the_configured_path(tmp_path: Path) -> None:
    body = _analyze_demo_thorax(_client(tmp_path, local_torch_weights_sha256="0" * 64))
    assert body["outcome"] == "failed"
    assert "pinned sha-256" in (body["job"].get("error_message") or "").lower()


def test_xray_profile_has_no_hu_window() -> None:
    assert TRANSFORM_HU_WINDOW not in xray_2d_profile("m").allowed_transforms
