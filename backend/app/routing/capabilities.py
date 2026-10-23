from dataclasses import dataclass, field
from typing import Optional

from app.schemas.enums import AnatomicalRegion, Modality, SourceKind, Species

# Task heads a Vision adapter may declare (routing + readiness UI).
TASK_STRUCTURED_FINDINGS = "structured_findings"
TASK_CLASSIFICATION = "classification"
TASK_DETECTION = "detection"
TASK_SEGMENTATION = "segmentation"
TASK_MEASUREMENT = "measurement"

# Input requirement tokens. metadata_only is always satisfiable on the default path.
INPUT_METADATA_ONLY = "metadata_only"
INPUT_PIXELS_2D = "pixels_2d"
INPUT_PIXELS_3D = "pixels_3d"

AVAILABILITY_AVAILABLE = "available"
AVAILABILITY_CONFIGURED = "configured"
AVAILABILITY_NOT_CONFIGURED = "not_configured"
AVAILABILITY_SYNTHETIC = "synthetic"


@dataclass(frozen=True)
class ModelCapability:
    """Declarative routing + integration metadata for Vision adapters.

    Does not import concrete adapter classes. Pixel access remains opt-in.
    """

    model_id: str
    modalities: frozenset[Modality]
    regions: frozenset[AnatomicalRegion]
    species: Optional[frozenset[Species]] = None  # None = all species
    priority: int = 100  # lower runs first / listed first
    enabled: bool = True
    description: str = ""
    source_kind: SourceKind = SourceKind.MOCK
    allows_pixel_analysis: bool = False
    # Phase 3 integration declarations (defaults keep mocks honest).
    model_version: str = "1.0.0"
    input_contract_id: str = "imaging-model-input/1.0.0"
    output_schema_version: str = "1.1.0"  # StructuredFindings schema_version
    timeout_s: float = 30.0
    max_instances: int | None = None
    resource_hint: str = "cpu"  # cpu | gpu | remote — advisory only
    # Phase 8 — task heads, input requirements, availability for readiness routing.
    task_capabilities: frozenset[str] = field(
        default_factory=lambda: frozenset({TASK_STRUCTURED_FINDINGS})
    )
    input_requirements: frozenset[str] = field(
        default_factory=lambda: frozenset({INPUT_METADATA_ONLY})
    )
    availability: str = AVAILABILITY_AVAILABLE
    adapter_kind: str = "mock"  # mock | http | local_torch | synthetic | manual
    preprocessing_contract_id: str = ""


def _mock_tasks() -> frozenset[str]:
    return frozenset({TASK_STRUCTURED_FINDINGS})


def default_capabilities() -> list[ModelCapability]:
    """Production-default capability table for mock adapters (MRI / CT / XR / multimodal)."""
    canine_feline = frozenset({Species.CANINE, Species.FELINE})
    neuro = frozenset({AnatomicalRegion.BRAIN, AnatomicalRegion.CERVICAL})
    meta = frozenset({INPUT_METADATA_ONLY})
    return [
        ModelCapability(
            model_id="mock-brain-mri-v1",
            modalities=frozenset({Modality.MR}),
            regions=frozenset({AnatomicalRegion.BRAIN}),
            species=canine_feline,
            priority=10,
            description="Mock Brain MRI (canine/feline)",
            model_version="1.0.0-mock",
            timeout_s=15.0,
            resource_hint="cpu",
            task_capabilities=_mock_tasks(),
            input_requirements=meta,
            availability=AVAILABILITY_AVAILABLE,
            adapter_kind="mock",
        ),
        ModelCapability(
            model_id="mock-cervical-mri-v1",
            modalities=frozenset({Modality.MR}),
            regions=frozenset({AnatomicalRegion.CERVICAL}),
            species=canine_feline,
            priority=10,
            description="Mock Cervical MRI (canine/feline)",
            model_version="1.0.0-mock",
            timeout_s=15.0,
            task_capabilities=_mock_tasks(),
            input_requirements=meta,
            availability=AVAILABILITY_AVAILABLE,
            adapter_kind="mock",
        ),
        ModelCapability(
            model_id="mock-ct-3d-v1",
            modalities=frozenset({Modality.CT}),
            regions=neuro,
            species=canine_feline,
            priority=20,
            description="Mock CT 3D volume stub (brain/cervical)",
            model_version="1.0.0-mock",
            timeout_s=20.0,
            task_capabilities=_mock_tasks(),
            input_requirements=meta,
            availability=AVAILABILITY_AVAILABLE,
            adapter_kind="mock",
        ),
        ModelCapability(
            model_id="mock-xr-vision-v1",
            modalities=frozenset({Modality.XR}),
            regions=frozenset({AnatomicalRegion.THORAX}),
            species=canine_feline,
            priority=20,
            description="Mock X-Ray vision stub (thorax)",
            model_version="1.0.0-mock",
            timeout_s=10.0,
            task_capabilities=_mock_tasks(),
            input_requirements=meta,
            availability=AVAILABILITY_AVAILABLE,
            adapter_kind="mock",
        ),
        ModelCapability(
            model_id="mock-multimodal-vlm-v1",
            modalities=frozenset({Modality.OTHER}),
            regions=frozenset({AnatomicalRegion.UNKNOWN, AnatomicalRegion.OTHER}),
            species=canine_feline,
            priority=50,
            description="Mock multimodal VLM stub (document + text context)",
            model_version="1.0.0-mock",
            timeout_s=15.0,
            task_capabilities=_mock_tasks(),
            input_requirements=meta,
            availability=AVAILABILITY_AVAILABLE,
            adapter_kind="mock",
        ),
        # Disabled by default — used for contract verification / readiness UI only.
        ModelCapability(
            model_id="synthetic-contract-sim-v1",
            modalities=frozenset({Modality.MR, Modality.CT, Modality.XR}),
            regions=frozenset(
                {
                    AnatomicalRegion.BRAIN,
                    AnatomicalRegion.CERVICAL,
                    AnatomicalRegion.THORAX,
                }
            ),
            species=canine_feline,
            priority=90,
            enabled=False,
            description="Synthetic contract simulator (integration probe, not clinical)",
            model_version="0.1.0-sim",
            timeout_s=5.0,
            source_kind=SourceKind.MOCK,
            task_capabilities=frozenset(
                {
                    TASK_STRUCTURED_FINDINGS,
                    TASK_CLASSIFICATION,
                    TASK_DETECTION,
                    TASK_SEGMENTATION,
                    TASK_MEASUREMENT,
                }
            ),
            input_requirements=meta,
            availability=AVAILABILITY_SYNTHETIC,
            adapter_kind="synthetic",
        ),
    ]
