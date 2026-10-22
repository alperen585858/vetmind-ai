"""F8: capability ↔ registry consistency at startup."""

from pathlib import Path

import pytest

from app.container import AppContainer
from app.models.mock_vision import default_model_registry
from app.routing.capabilities import ModelCapability, default_capabilities
from app.routing.model_router import ModelRouter
from app.routing.registry_validation import RegistryConsistencyError, validate_registry_capabilities
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, SourceKind, Species
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def test_orphan_capability_fails_validation() -> None:
    caps = [
        ModelCapability(
            model_id="missing-adapter-v1",
            modalities=frozenset({Modality.MR}),
            regions=frozenset({AnatomicalRegion.BRAIN}),
            priority=1,
            source_kind=SourceKind.REAL,
        )
    ]
    with pytest.raises(RegistryConsistencyError, match="missing-adapter-v1"):
        validate_registry_capabilities(caps, default_model_registry())


def test_disabled_orphan_capability_allowed() -> None:
    caps = [
        ModelCapability(
            model_id="missing-adapter-v1",
            modalities=frozenset({Modality.MR}),
            regions=frozenset({AnatomicalRegion.BRAIN}),
            enabled=False,
            source_kind=SourceKind.REAL,
        ),
        *default_capabilities(),
    ]
    validate_registry_capabilities(caps, default_model_registry())  # no raise
    router = ModelRouter(capabilities=caps)
    decision = router.route(
        CaseRecord(
            case_id="c1",
            patient_name="Pax",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
        )
    )
    assert "missing-adapter-v1" not in decision.model_ids
    assert decision.model_ids == ["mock-brain-mri-v1"]


def test_incompatible_duplicate_capabilities_fail() -> None:
    caps = [
        ModelCapability(
            model_id="mock-brain-mri-v1",
            modalities=frozenset({Modality.MR}),
            regions=frozenset({AnatomicalRegion.BRAIN}),
            priority=10,
        ),
        ModelCapability(
            model_id="mock-brain-mri-v1",
            modalities=frozenset({Modality.CT}),
            regions=frozenset({AnatomicalRegion.BRAIN}),
            priority=10,
        ),
    ]
    with pytest.raises(RegistryConsistencyError, match="Incompatible duplicate"):
        validate_registry_capabilities(caps, default_model_registry())


def test_mock_only_container_startup_ok(tmp_path: Path) -> None:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        async_analyze_delay_ms=0,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    assert "mock-brain-mri-v1" in container.models
    assert "mock-cervical-mri-v1" in container.models


def test_remote_without_capability_declaration_fails_startup(tmp_path: Path) -> None:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        vision_endpoint="http://127.0.0.1:9/infer",
        vision_model_id="remote-vision-v1",
        vision_modalities=(),
        vision_regions=(),
        async_analyze_delay_ms=0,
    )
    with pytest.raises(Exception, match="vision_modalities|VETMIND_VISION_MODALITIES"):
        AppContainer(repo=InMemoryCaseRepository(), settings=settings)
