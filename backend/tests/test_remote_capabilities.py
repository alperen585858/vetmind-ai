"""F3: configurable remote Vision capabilities (no hardcoded footprint)."""

from pathlib import Path

import pytest

from app.container import AppContainer
from app.routing.remote_config import VisionConfigError, remote_capability_from_settings
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, SourceKind, Species
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _settings(tmp_path: Path, **kwargs) -> Settings:
    base = dict(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        async_analyze_delay_ms=0,
        vision_endpoint="http://127.0.0.1:9/infer",
        vision_model_id="remote-vision-v1",
        vision_modalities=("MR",),
        vision_regions=("BRAIN",),
        vision_species=("canine", "feline"),
        vision_priority=1,
        vision_enabled=True,
        vision_source_kind="real",
        vision_execution_policy="exclusive_real",
    )
    base.update(kwargs)
    return Settings(**base)


def _case(**kwargs) -> CaseRecord:
    data = dict(
        case_id="case-f3",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
    )
    data.update(kwargs)
    return CaseRecord(**data)


def test_remote_capability_requires_explicit_modalities_and_regions(tmp_path: Path) -> None:
    with pytest.raises(VisionConfigError, match="vision_modalities"):
        remote_capability_from_settings(
            _settings(tmp_path, vision_modalities=(), vision_regions=("BRAIN",))
        )
    with pytest.raises(VisionConfigError, match="vision_regions"):
        remote_capability_from_settings(
            _settings(tmp_path, vision_modalities=("MR",), vision_regions=())
        )


def test_unknown_modality_fails_at_config(tmp_path: Path) -> None:
    with pytest.raises(VisionConfigError, match="Unknown vision_modalities"):
        remote_capability_from_settings(_settings(tmp_path, vision_modalities=("PET",)))


def test_no_endpoint_leaves_mock_routing(tmp_path: Path) -> None:
    settings = _settings(tmp_path, vision_endpoint=None, vision_modalities=(), vision_regions=())
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    decision = container.execution_policy.apply(container.router.route(_case()))
    assert decision.model_ids == ["mock-brain-mri-v1"]
    assert remote_capability_from_settings(settings) is None


def test_config_changes_routing_without_code_edit(tmp_path: Path) -> None:
    # Remote only covers cervical → brain MR stays on mock under exclusive policy
    # when remote does not match.
    cervical_only = _settings(
        tmp_path,
        vision_modalities=("MR",),
        vision_regions=("CERVICAL",),
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=cervical_only)
    brain = container.execution_policy.apply(container.router.route(_case()))
    assert brain.model_ids == ["mock-brain-mri-v1"]

    cervical = container.execution_policy.apply(
        container.router.route(_case(anatomical_region=AnatomicalRegion.CERVICAL))
    )
    assert cervical.model_ids == ["remote-vision-v1"]

    # Expand remote to brain → exclusive selects remote for brain MR
    brain_remote = _settings(
        tmp_path,
        vision_modalities=("MR",),
        vision_regions=("BRAIN",),
    )
    container2 = AppContainer(repo=InMemoryCaseRepository(), settings=brain_remote)
    routed = container2.execution_policy.apply(container2.router.route(_case()))
    assert routed.model_ids == ["remote-vision-v1"]


def test_disabled_remote_capability_not_routed(tmp_path: Path) -> None:
    settings = _settings(tmp_path, vision_enabled=False)
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    decision = container.router.route(_case())
    assert "remote-vision-v1" not in decision.model_ids
    assert decision.model_ids == ["mock-brain-mri-v1"]


def test_parsed_capability_fields(tmp_path: Path) -> None:
    cap = remote_capability_from_settings(
        _settings(
            tmp_path,
            vision_modalities=("MR", "CT"),
            vision_regions=("BRAIN", "THORAX"),
            vision_species=("canine",),
            vision_priority=3,
            vision_source_kind="real",
        )
    )
    assert cap is not None
    assert cap.model_id == "remote-vision-v1"
    assert cap.modalities == frozenset({Modality.MR, Modality.CT})
    assert cap.regions == frozenset({AnatomicalRegion.BRAIN, AnatomicalRegion.THORAX})
    assert cap.species == frozenset({Species.CANINE})
    assert cap.priority == 3
    assert cap.enabled is True
    assert cap.source_kind == SourceKind.REAL
