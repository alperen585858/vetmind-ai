from dataclasses import dataclass
from typing import Optional

from app.schemas.enums import AnatomicalRegion, Modality, SourceKind, Species


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


def default_capabilities() -> list[ModelCapability]:
    """Production-default capability table for mock adapters (MRI / CT / XR / multimodal)."""
    canine_feline = frozenset({Species.CANINE, Species.FELINE})
    neuro = frozenset({AnatomicalRegion.BRAIN, AnatomicalRegion.CERVICAL})
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
        ),
    ]
