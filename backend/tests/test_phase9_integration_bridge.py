"""Phase 9 — AI integration bridge (no real model load)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.imaging.profiles import ct_volume_profile, mri_volume_profile, xray_2d_profile
from app.models.bridge_resources import ArtifactWorkspace, ResourceLimits
from app.models.bridge_runner import BridgeAdapterConfig, IntegrationBridge
from app.models.entrypoint import LocalTorchEntrypoint
from app.models.errors import (
    IncompatibleInputError,
    InferenceFailedError,
    ModelUnavailableError,
)
from app.models.local_torch import LocalTorchConfig, LocalTorchVisionAdapter
from app.models.model_input_builder import build_imaging_model_input
from app.models.synthetic_bridge import (
    SyntheticBridgeEntrypoint,
    run_synthetic_bridge_e2e,
    synthetic_pixel_capability,
)
from app.schemas.enums import Modality, SourceKind
from app.schemas.model_outputs import ModelTaskOutputs


def test_modality_profiles_differ() -> None:
    mri = mri_volume_profile("m1")
    ct = ct_volume_profile("m1")
    xr = xray_2d_profile("m1")
    assert mri.output_tensor_layout == "dhw"
    assert ct.output_tensor_layout == "dhw"
    assert "hu_window" in ct.allowed_transforms
    assert "hu_window" not in mri.allowed_transforms
    assert xr.output_tensor_layout == "chw"


def test_local_torch_unavailable_no_mock_fallback() -> None:
    adapter = LocalTorchVisionAdapter(LocalTorchConfig(model_id="local-x"))
    from app.schemas.case import CaseRecord
    from app.schemas.enums import AnatomicalRegion, Species
    from app.schemas.findings import StudyInfo

    case = CaseRecord(
        case_id="c",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.XR,
        anatomical_region=AnatomicalRegion.THORAX,
        study=StudyInfo(),
    )
    case.model_input = build_imaging_model_input(case)
    with pytest.raises(ModelUnavailableError, match="not configured"):
        adapter.analyze(case)


def test_local_torch_entrypoint_without_infer_fn_fails() -> None:
    tmp = Path(".")
    weights = tmp / "_phase9_dummy_weights.bin"
    weights.write_bytes(b"not-a-real-checkpoint")
    try:
        entry = LocalTorchEntrypoint(
            model_id="local-x",
            version="1",
            weights_path=str(weights),
            infer_fn=None,
        )
        entry.load()
        from app.models.entrypoint import InferenceRequest
        from app.schemas.model_input import ImagingModelInput
        from app.schemas.enums import AnatomicalRegion, Species

        req = InferenceRequest(
            case_id="c",
            model_id="local-x",
            model_version="1",
            model_input=ImagingModelInput(
                case_id="c",
                species=Species.CANINE,
                modality=Modality.XR,
                anatomical_region=AnatomicalRegion.THORAX,
            ),
        )
        with pytest.raises(InferenceFailedError, match="no infer_fn"):
            entry.infer(req)
    finally:
        weights.unlink(missing_ok=True)


def test_resource_limit_rejects_too_many_instances(tmp_path: Path) -> None:
    from app.dicom.fixtures import brain_mri_study_files
    from app.models.pixel_bridge import AuthorizedPixelBridge, attach_in_memory_dicom_bytes
    from app.models.synthetic_bridge import _case_from_files
    from app.schemas.enums import AnatomicalRegion

    files = brain_mri_study_files(3)
    cap = synthetic_pixel_capability(modality=Modality.MR)
    case, blobs = _case_from_files(
        modality=Modality.MR,
        region=AnatomicalRegion.BRAIN,
        files=files,
        quarantine=None,
    )
    case.model_input = build_imaging_model_input(case, capabilities=[cap])
    attach_in_memory_dicom_bytes(case, blobs)
    bridge = AuthorizedPixelBridge(
        quarantine=None,
        capabilities=[cap],
        limits=ResourceLimits(max_instances=1),
    )
    with pytest.raises(IncompatibleInputError, match="max_instances"):
        bridge.prepare_for_model(
            case,
            model_id=cap.model_id,
            contract=mri_volume_profile(cap.model_id),
            keep_tensor_in_memory=True,
        )


def test_artifact_workspace_cleanup(tmp_path: Path) -> None:
    root = tmp_path / "artifacts"
    with ArtifactWorkspace(root, case_id="case-1") as ws:
        p = ws.write_bytes("a.txt", b"hello")
        assert p.is_file()
        path = ws.path
    assert not path.exists()


def test_pixel_denied_by_default_on_bridge(tmp_path: Path) -> None:
    from app.schemas.case import CaseRecord
    from app.schemas.enums import AnatomicalRegion, Species
    from app.schemas.findings import StudyInfo
    from app.routing.capabilities import ModelCapability, INPUT_PIXELS_2D
    from app.schemas.enums import SourceKind as SK

    cap = ModelCapability(
        model_id="future-xr",
        modalities=frozenset({Modality.XR}),
        regions=frozenset({AnatomicalRegion.THORAX}),
        source_kind=SK.REAL,
        allows_pixel_analysis=True,
        input_requirements=frozenset({INPUT_PIXELS_2D}),
    )
    case = CaseRecord(
        case_id="c",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.XR,
        anatomical_region=AnatomicalRegion.THORAX,
        classification_confirmed=False,
        study=StudyInfo(),
    )
    case.model_input = build_imaging_model_input(case, capabilities=[cap])
    entry = SyntheticBridgeEntrypoint()
    bridge = IntegrationBridge(capabilities=[cap], artifact_root=tmp_path / "b")
    with pytest.raises(IncompatibleInputError, match="denied|Pixel"):
        bridge.analyze(
            case,
            BridgeAdapterConfig(
                model_id="future-xr",
                version="1",
                entrypoint=entry,
                requires_pixels=True,
                keep_tensor_in_memory=True,
                contract=xray_2d_profile("future-xr"),
                window_center=1000,
                window_width=2000,
            ),
        )


@pytest.mark.parametrize("modality", [Modality.XR, Modality.MR, Modality.CT])
def test_synthetic_bridge_e2e(modality: Modality, tmp_path: Path) -> None:
    findings = run_synthetic_bridge_e2e(
        modality=modality,
        quarantine_root=tmp_path / "q",
        artifact_root=tmp_path / "art",
    )
    assert findings.source_kind == SourceKind.MOCK
    assert findings.execution_status.value == "success"
    assert findings.processing_metadata.get("bridge") == "integration_bridge/1.0.0"
    assert findings.processing_metadata.get("pixels_loaded") == "true"
    assert all(f.synthetic for f in findings.findings)
    assert all(f.model_confidence is None for f in findings.findings)
    # Artifacts cleaned (workspace closed); root may exist empty or absent children.
    art = tmp_path / "art"
    if art.exists():
        leftovers = [p for p in art.iterdir() if p.is_dir() and p.name.startswith("bridge-")]
        assert leftovers == []


def test_bridge_maps_task_outputs_without_inventing_scores(tmp_path: Path) -> None:
    from app.schemas.case import CaseRecord
    from app.schemas.enums import AnatomicalRegion, Species, ModelExecutionStatus
    from app.schemas.findings import StudyInfo
    from app.models.entrypoint import InferenceRequest
    from app.schemas.model_input import ImagingModelInput
    from app.schemas.model_outputs import ClassificationLabel, ClassificationOutput

    class _EP:
        def load(self) -> None:
            self._r = True

        def is_ready(self) -> bool:
            return getattr(self, "_r", False)

        def infer(self, request: InferenceRequest) -> ModelTaskOutputs:
            return ModelTaskOutputs(
                model_id="ep",
                model_version="1",
                case_id=request.case_id,
                execution_status=ModelExecutionStatus.SUCCESS,
                source_kind=SourceKind.MOCK,
                classification=ClassificationOutput(
                    labels=[ClassificationLabel(label="PROBE", score=None)]
                ),
            )

    case = CaseRecord(
        case_id="c-map",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.OTHER,
        anatomical_region=AnatomicalRegion.UNKNOWN,
        study=StudyInfo(),
    )
    case.model_input = ImagingModelInput(
        case_id=case.case_id,
        species=case.species,
        modality=case.modality,
        anatomical_region=case.anatomical_region,
    )
    bridge = IntegrationBridge(capabilities=[], artifact_root=tmp_path / "a")
    out = bridge.analyze(
        case,
        BridgeAdapterConfig(
            model_id="ep",
            version="1",
            entrypoint=_EP(),  # type: ignore[arg-type]
            requires_pixels=False,
        ),
    )
    assert out.findings[0].model_confidence is None
    assert out.findings[0].synthetic is True
