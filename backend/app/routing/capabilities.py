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
    """Production-default capability table for Phase 2A mock adapters.

    Secondary conflict-demo adapters are registered in the model registry but are
    not enabled here; ScenarioRoutingPolicy may add them for synthetic demos only.
    """
    canine_feline = frozenset({Species.CANINE, Species.FELINE})
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
    ]
