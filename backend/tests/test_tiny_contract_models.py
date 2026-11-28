"""CT/MR "monai" entrypoints are tiny contract models and must be labelled as such.

Runs without torch: only configuration, readiness, /health and the architecture page
are exercised. Entry-point behaviour with real checkpoints is covered when torch exists.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.models.model_kind import (
    TINY_CONTRACT,
    TRAINED_NETWORK,
    entrypoint_model_kind,
    is_contract_only_entrypoint,
    is_tiny_architecture,
)
from app.routing.capabilities import AVAILABILITY_SYNTHETIC
from app.routing.local_config import local_capability_from_settings
from app.schemas.enums import SourceKind
from app.services.architecture_status import build_architecture
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings

CT_ENTRY = "app.models.entrypoints.ct_monai:build_entrypoint"
MRI_ENTRY = "app.models.entrypoints.mri_monai:build_entrypoint"
XR_ENTRY = "app.models.entrypoints.xray_monai:build_entrypoint"


def _settings(tmp_path: Path, entrypoint: str, **overrides) -> Settings:
    weights = tmp_path / "model.pt"
    weights.write_bytes(b"not-a-real-checkpoint")
    modality = "CT" if "ct_monai" in entrypoint else ("MR" if "mri_monai" in entrypoint else "XR")
    region = "THORAX" if modality == "XR" else "BRAIN"
    fields = dict(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        async_analyze_delay_ms=0,
        rag_backend="lexical",
        auth_enabled=False,
        tenant_isolation=False,
        malware_scan_required=False,
        analyze_gate_path=tmp_path / "gate.count",
        pixel_analysis_opt_in=True,
        local_torch_model_id="vet-local-v1",
        local_torch_entrypoint=entrypoint,
        local_torch_weights_path=str(weights),
        local_torch_modalities=(modality,),
        local_torch_regions=(region,),
        local_torch_window_center=40.0,
        local_torch_window_width=80.0,
    )
    return Settings(**{**fields, **overrides})


def _container(settings: Settings) -> AppContainer:
    return AppContainer(repo=InMemoryCaseRepository(), settings=settings)


def test_model_kind_helpers() -> None:
    assert is_contract_only_entrypoint(CT_ENTRY)
    assert is_contract_only_entrypoint(MRI_ENTRY)
    assert not is_contract_only_entrypoint(XR_ENTRY)
    assert not is_contract_only_entrypoint(None)
    assert entrypoint_model_kind(CT_ENTRY) == TINY_CONTRACT
    assert entrypoint_model_kind(XR_ENTRY) == TRAINED_NETWORK
    assert is_tiny_architecture("tiny_ct_classifier")
    assert is_tiny_architecture("TINY_XR_CLASSIFIER")
    assert not is_tiny_architecture("txrv_densenet121")
    assert not is_tiny_architecture("monai_segresnet")


@pytest.mark.parametrize("entrypoint", [CT_ENTRY, MRI_ENTRY])
def test_contract_entrypoint_is_mock_probe_not_routed(tmp_path: Path, entrypoint: str) -> None:
    # Default VETMIND_LOCAL_TORCH_SOURCE_KIND is "real": it must be refused for a tiny model.
    cap = local_capability_from_settings(_settings(tmp_path, entrypoint))
    assert cap is not None
    assert cap.source_kind == SourceKind.MOCK
    assert cap.availability == AVAILABILITY_SYNTHETIC
    assert cap.enabled is False
    assert "Tiny contract" in cap.description


def test_xr_entrypoint_stays_real(tmp_path: Path) -> None:
    cap = local_capability_from_settings(_settings(tmp_path, XR_ENTRY))
    assert cap is not None
    assert cap.source_kind == SourceKind.REAL
    assert cap.enabled is True


@pytest.mark.parametrize("entrypoint", [CT_ENTRY, MRI_ENTRY])
def test_router_never_selects_tiny_contract_model(tmp_path: Path, entrypoint: str) -> None:
    c = _container(_settings(tmp_path, entrypoint))
    caps = {cap.model_id: cap for cap in c.router.list_capabilities()}
    assert caps["vet-local-v1"].enabled is False
    # The adapter is still registered (contract probes), but readiness is honest.
    adapter = c.models["vet-local-v1"]
    assert adapter.model_kind == TINY_CONTRACT
    readiness = adapter.describe_readiness()
    assert readiness["model_kind"] == TINY_CONTRACT
    assert readiness["source_kind"] == "mock"


@pytest.mark.parametrize("entrypoint", [CT_ENTRY, MRI_ENTRY])
def test_readiness_and_health_label_tiny_model(tmp_path: Path, entrypoint: str) -> None:
    client = TestClient(create_app(_container(_settings(tmp_path, entrypoint))))

    ready = client.get("/api/v1/models/readiness")
    assert ready.status_code == 200, ready.text
    row = next(m for m in ready.json()["models"] if m["model_id"] == "vet-local-v1")
    assert row["source_kind"] == "mock"
    assert row["model_kind"] == TINY_CONTRACT
    assert row["availability"] == AVAILABILITY_SYNTHETIC
    assert "tiny_contract_model_not_trained" in row["blockers"]
    assert row["ready_for_real_integration"] is False

    health = client.get("/api/v1/health").json()
    assert health["local_torch"] == {
        "model_id": "vet-local-v1",
        "model_kind": TINY_CONTRACT,
        "source_kind": "mock",
        "routed": False,
        "availability": AVAILABILITY_SYNTHETIC,
    }


def test_health_local_torch_absent_by_default(tmp_path: Path) -> None:
    settings = _settings(
        tmp_path,
        XR_ENTRY,
        local_torch_model_id=None,
        local_torch_entrypoint=None,
        local_torch_weights_path=None,
    )
    health = TestClient(create_app(_container(settings))).get("/api/v1/health").json()
    assert health["local_torch"] is None


def test_architecture_page_lists_tiny_ct_model_as_mock(tmp_path: Path) -> None:
    arch = build_architecture(_container(_settings(tmp_path, CT_ENTRY)))
    ct = arch["nodes"]["ct"]
    assert ct["status"] == "mock"  # still only mock CT models; the tiny probe does not count as real
    assert "vet-local-v1" in ct["info"]
    assert "tiny sözleşme modeli (mock)" in ct["info"]["vet-local-v1"]
    assert "analize alınmaz" in ct["info"]["vet-local-v1"]


@pytest.mark.skipif(
    __import__("importlib").util.find_spec("torch") is None,
    reason="torch not installed (requirements-vision optional)",
)
@pytest.mark.parametrize("module_name", ["ct_monai", "mri_monai"])
def test_entrypoint_refuses_non_tiny_architecture(tmp_path: Path, module_name: str) -> None:
    import importlib

    import torch

    from app.models.errors import ModelUnavailableError

    mod = importlib.import_module(f"app.models.entrypoints.{module_name}")
    ckpt = tmp_path / "net.pt"
    torch.save({"architecture": "monai_segresnet", "label_names": ["A"], "state_dict": {}}, ckpt)
    entry = mod.build_entrypoint(model_id="m", version="1", weights_path=str(ckpt))
    with pytest.raises(ModelUnavailableError, match="tiny contract classifier"):
        entry.load()


@pytest.mark.skipif(
    __import__("importlib").util.find_spec("torch") is None,
    reason="torch not installed (requirements-vision optional)",
)
def test_tiny_mri_outputs_are_mock(tmp_path: Path) -> None:
    import numpy as np

    from app.imaging.contracts import TransformProvenance
    from app.models.entrypoint import InferenceRequest, PreparedTensorBundle
    from app.models.entrypoints.mri_monai import build_entrypoint, save_tiny_checkpoint
    from app.schemas.enums import AnatomicalRegion, Modality, Species
    from app.schemas.model_input import ImagingModelInput

    ckpt = tmp_path / "mri.pt"
    save_tiny_checkpoint(str(ckpt))
    entry = build_entrypoint(model_id="vet-mri", version="0.0.1", weights_path=str(ckpt))
    entry.load()
    vol = np.random.rand(4, 16, 16).astype(np.float32)
    req = InferenceRequest(
        case_id="c1",
        model_id="vet-mri",
        model_version="0.0.1",
        model_input=ImagingModelInput(
            case_id="c1", species=Species.CANINE, modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
        ),
        prepared=PreparedTensorBundle(
            layout="dhw", tensor_shape=tuple(vol.shape),
            provenance=TransformProvenance(contract_id="x", steps=()), tensor=vol,
        ),
        species="canine",
        modality="MR",
        anatomical_region="BRAIN",
    )
    out = entry.infer(req)
    assert out.source_kind == SourceKind.MOCK
    assert out.processing_metadata["model_kind"] == TINY_CONTRACT
    assert any("Tiny contract model" in w for w in out.warnings)
