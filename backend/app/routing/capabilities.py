from dataclasses import dataclass
from typing import Optional

from app.schemas.enums import AnatomicalRegion, Modality, Species


@dataclass(frozen=True)
class ModelCapability:
    """Declarative routing metadata. Router matches study properties to these capabilities.

    Does not import or reference concrete adapter classes.
    """

    model_id: str
    modalities: frozenset[Modality]
    regions: frozenset[AnatomicalRegion]
    species: Optional[frozenset[Species]] = None  # None = all species
    priority: int = 100  # lower runs first / listed first
    enabled: bool = True
    description: str = ""


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
        ),
        ModelCapability(
            model_id="mock-cervical-mri-v1",
            modalities=frozenset({Modality.MR}),
            regions=frozenset({AnatomicalRegion.CERVICAL}),
            species=canine_feline,
            priority=10,
            description="Mock Cervical MRI (canine/feline)",
        ),
        ModelCapability(
            model_id="mock-ct-3d-v1",
            modalities=frozenset({Modality.CT}),
            regions=neuro,
            species=canine_feline,
            priority=20,
            description="Mock CT 3D volume stub (brain/cervical)",
        ),
        ModelCapability(
            model_id="mock-xr-vision-v1",
            modalities=frozenset({Modality.XR}),
            regions=frozenset({AnatomicalRegion.THORAX}),
            species=canine_feline,
            priority=20,
            description="Mock X-Ray vision stub (thorax)",
        ),
        ModelCapability(
            model_id="mock-multimodal-vlm-v1",
            modalities=frozenset({Modality.OTHER}),
            regions=frozenset({AnatomicalRegion.UNKNOWN, AnatomicalRegion.OTHER}),
            species=canine_feline,
            priority=50,
            description="Mock multimodal VLM stub (document + text context)",
        ),
    ]
