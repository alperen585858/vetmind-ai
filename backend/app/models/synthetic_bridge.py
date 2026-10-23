"""Synthetic end-to-end integration bridge example (no real inference)."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from app.dicom.fixtures import (
    brain_ct_study_files,
    brain_mri_study_files,
    thorax_xr_study_files,
)
from app.imaging.profiles import profile_for_modality
from app.models.bridge_resources import ResourceLimits
from app.models.bridge_runner import BridgeAdapterConfig, IntegrationBridge
from app.models.entrypoint import InferenceRequest
from app.models.model_input_builder import build_imaging_model_input
from app.models.pixel_bridge import attach_in_memory_dicom_bytes
from app.models.synthetic_simulator import SYNTHETIC_MODEL_ID, SYNTHETIC_VERSION
from app.routing.capabilities import (
    AVAILABILITY_SYNTHETIC,
    INPUT_PIXELS_2D,
    INPUT_PIXELS_3D,
    TASK_CLASSIFICATION,
    TASK_DETECTION,
    TASK_MEASUREMENT,
    TASK_SEGMENTATION,
    TASK_STRUCTURED_FINDINGS,
    ModelCapability,
)
from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta
from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    Modality,
    ModelExecutionStatus,
    SourceKind,
    Species,
)
from app.schemas.findings import StructuredFindings, StudyInfo
from app.schemas.model_outputs import (
    BoundingBox2D,
    ClassificationLabel,
    ClassificationOutput,
    DetectionOutput,
    MeasurementOutput,
    MeasurementValue,
    ModelTaskOutputs,
    SegmentationOutput,
    SegmentationRegion,
)
from app.storage.quarantine import QuarantineStore


class SyntheticBridgeEntrypoint:
    """Entrypoint used only for bridge contract verification.

    Reads prepared tensor metadata (shape/layout) and emits clearly synthetic
    ModelTaskOutputs. Never invents clinical confidence scores.
    """

    def __init__(
        self,
        *,
        model_id: str = SYNTHETIC_MODEL_ID,
        version: str = SYNTHETIC_VERSION,
        weights_path: str | None = None,
        device: str = "cpu",
        timeout_s: float = 5.0,
    ) -> None:
        self.model_id = model_id
        self.version = version
        self._ready = False
        _ = (weights_path, device, timeout_s)

    def load(self) -> None:
        self._ready = True

    def is_ready(self) -> bool:
        return self._ready

    def infer(self, request: InferenceRequest) -> ModelTaskOutputs:
        shape = ()
        layout = "none"
        if request.prepared is not None:
            shape = request.prepared.tensor_shape
            layout = request.prepared.layout
        return ModelTaskOutputs(
            model_id=self.model_id,
            model_version=self.version,
            case_id=request.case_id,
            execution_status=ModelExecutionStatus.SUCCESS,
            source_kind=SourceKind.MOCK,
            classification=ClassificationOutput(
                labels=[
                    ClassificationLabel(
                        label="SYNTHETIC_BRIDGE_PROBE",
                        score=None,
                        finding_status=FindingStatus.NOT_ASSESSED,
                    )
                ],
                top_label="SYNTHETIC_BRIDGE_PROBE",
            ),
            detection=DetectionOutput(
                boxes=[
                    BoundingBox2D(
                        x_min=0.0,
                        y_min=0.0,
                        x_max=1.0,
                        y_max=1.0,
                        label="SYNTHETIC_BRIDGE_BOX",
                        score=None,
                        frame_index=0,
                    )
                ]
            ),
            segmentation=SegmentationOutput(
                regions=[
                    SegmentationRegion(
                        region_id="syn-bridge-1",
                        label="SYNTHETIC_BRIDGE_MASK",
                        mask_encoding="none",
                        score=None,
                    )
                ]
            ),
            measurements=MeasurementOutput(
                measurements=[
                    MeasurementValue(
                        measurement_id="syn-bridge-meas",
                        name="tensor_rank",
                        value=float(len(shape)),
                        unit="dim",
                        anatomical_location=request.anatomical_region,
                        note="Synthetic tensor-rank probe — not a clinical measurement.",
                    )
                ]
            ),
            warnings=[
                "SYNTHETIC BRIDGE E2E — not medical image interpretation.",
                f"Observed prepared layout={layout} shape={shape}.",
                "Scores intentionally omitted (never invented).",
            ],
            processing_metadata={
                "adapter": "synthetic_bridge_entrypoint",
                "layout": layout,
                "tensor_shape": "x".join(str(x) for x in shape) if shape else "none",
            },
        )


def synthetic_pixel_capability(*, modality: Modality) -> ModelCapability:
    """REAL-shaped capability flags for pixel auth tests; source_kind remains MOCK on outputs."""
    regions = frozenset({AnatomicalRegion.BRAIN, AnatomicalRegion.THORAX, AnatomicalRegion.CERVICAL})
    req = frozenset({INPUT_PIXELS_3D}) if modality in {Modality.MR, Modality.CT} else frozenset({INPUT_PIXELS_2D})
    return ModelCapability(
        model_id=SYNTHETIC_MODEL_ID,
        modalities=frozenset({modality}),
        regions=regions,
        species=frozenset({Species.CANINE, Species.FELINE}),
        priority=1,
        enabled=True,
        description="Synthetic bridge E2E (pixel probe)",
        source_kind=SourceKind.REAL,  # required so pixel auth is not DENIED_MOCK_ADAPTER
        allows_pixel_analysis=True,
        model_version=SYNTHETIC_VERSION,
        task_capabilities=frozenset(
            {
                TASK_STRUCTURED_FINDINGS,
                TASK_CLASSIFICATION,
                TASK_DETECTION,
                TASK_SEGMENTATION,
                TASK_MEASUREMENT,
            }
        ),
        input_requirements=req,
        availability=AVAILABILITY_SYNTHETIC,
        adapter_kind="synthetic",
    )


def _case_from_files(
    *,
    modality: Modality,
    region: AnatomicalRegion,
    files: list[tuple[str, bytes]],
    quarantine: QuarantineStore | None,
) -> tuple[CaseRecord, list[bytes]]:
    study_uid = "1.2.840.10008.9.9.1"
    series_uid = "1.2.840.10008.9.9.2"
    instances: list[DicomInstanceMeta] = []
    blobs: list[bytes] = []
    ingest_id = "bridge-e2e-syn"
    refs = []
    if quarantine is not None:
        refs = quarantine.store_files(ingest_id, files)

    for i, (name, data) in enumerate(files, start=1):
        blobs.append(data)
        rel = refs[i - 1].relative_path if refs else None
        instances.append(
            DicomInstanceMeta(
                sop_instance_uid=f"1.2.840.10008.9.9.3.{i}",
                instance_number=i,
                filename=name,
                has_pixel_data=True,
                quarantine_relative_path=rel,
                rows=128,
                columns=128,
                image_position_patient=f"0\\0\\{i - 1}",
                pixel_spacing="0.5\\0.5",
                transfer_syntax_uid="1.2.840.10008.1.2.1",
            )
        )

    case = CaseRecord(
        case_id="case-bridge-e2e",
        patient_name="SYNTHETIC^BRIDGE",
        species=Species.CANINE,
        modality=modality,
        anatomical_region=region,
        classification_confirmed=True,
        imaging_source_permission_verified=True,
        imaging_analysis_consent_verified=True,
        study=StudyInfo(
            study_instance_uid=study_uid,
            dicom_available=True,
            metadata_only=False,
        ),
        dicom_study=DicomStudyMeta(
            study_instance_uid=study_uid,
            series=[
                DicomSeriesMeta(
                    series_instance_uid=series_uid,
                    modality=modality,
                    instances=instances,
                )
            ],
        ),
        quarantine_dir=ingest_id if quarantine is not None else None,
    )
    return case, blobs


def run_synthetic_bridge_e2e(
    *,
    modality: Modality = Modality.XR,
    quarantine_root: Path | None = None,
    artifact_root: Path | None = None,
) -> StructuredFindings:
    """One-shot synthetic bridge: authorize → profile prep → entrypoint → findings."""
    if modality == Modality.MR:
        files = brain_mri_study_files(3)
        region = AnatomicalRegion.BRAIN
        window = (None, None)
    elif modality == Modality.CT:
        files = brain_ct_study_files(3)
        region = AnatomicalRegion.BRAIN
        window = (40.0, 80.0)  # explicit probe WW/WC — not a clinical preset claim
    else:
        files = thorax_xr_study_files(1)
        region = AnatomicalRegion.THORAX
        modality = Modality.XR
        window = (1000.0, 2000.0)

    quarantine = QuarantineStore(quarantine_root) if quarantine_root is not None else None
    case, blobs = _case_from_files(
        modality=modality, region=region, files=files, quarantine=quarantine
    )
    cap = synthetic_pixel_capability(modality=modality)
    case.model_input = build_imaging_model_input(case, capabilities=[cap])
    attach_in_memory_dicom_bytes(case, blobs)

    entry = SyntheticBridgeEntrypoint(model_id=SYNTHETIC_MODEL_ID, version=SYNTHETIC_VERSION)
    contract = profile_for_modality(
        modality,
        SYNTHETIC_MODEL_ID,
        version=SYNTHETIC_VERSION,
        regions=frozenset({region}),
        species=frozenset({Species.CANINE}),
    )
    if artifact_root is None:
        if quarantine is not None:
            artifact_root = quarantine.root / "_bridge_tmp"
        else:
            artifact_root = Path(tempfile.mkdtemp(prefix="vetmind_bridge_"))

    bridge = IntegrationBridge(
        capabilities=[cap],
        quarantine=quarantine,
        limits=ResourceLimits(max_instances=64, max_tensor_bytes=64 * 1024 * 1024),
        artifact_root=artifact_root,
    )
    return bridge.analyze(
        case,
        BridgeAdapterConfig(
            model_id=SYNTHETIC_MODEL_ID,
            version=SYNTHETIC_VERSION,
            entrypoint=entry,
            requires_pixels=True,
            capability=cap,
            window_center=window[0],
            window_width=window[1],
            keep_tensor_in_memory=True,
            contract=contract,
        ),
    )


def build_synthetic_bridge_entrypoint(**kwargs: Any) -> SyntheticBridgeEntrypoint:
    return SyntheticBridgeEntrypoint(**kwargs)
