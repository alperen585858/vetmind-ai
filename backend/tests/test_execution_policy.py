"""F2: exclusive real vs explicit mixed Vision execution policy."""

from pathlib import Path

from app.container import AppContainer
from app.routing.capabilities import ModelCapability, default_capabilities
from app.routing.execution_policy import ModelExecutionPolicy, VisionExecutionMode
from app.routing.model_router import ModelRouter, RouteDecision
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, SourceKind, Species
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _case(**kwargs) -> CaseRecord:
    base = dict(
        case_id="case-exec",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
    )
    base.update(kwargs)
    return CaseRecord(**base)


def _remote_cap(model_id: str = "remote-vision-v1") -> ModelCapability:
    return ModelCapability(
        model_id=model_id,
        modalities=frozenset({Modality.MR, Modality.CT, Modality.XR}),
        regions=frozenset(
            {AnatomicalRegion.BRAIN, AnatomicalRegion.CERVICAL, AnatomicalRegion.THORAX}
        ),
        species=frozenset({Species.CANINE, Species.FELINE}),
        priority=1,
        description="test remote",
        source_kind=SourceKind.REAL,
    )


def test_mock_only_when_no_remote_endpoint(tmp_path: Path) -> None:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        vision_endpoint=None,
        async_analyze_delay_ms=0,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    decision = container.execution_policy.apply(container.router.route(_case()))
    assert decision.supported is True
    assert decision.model_ids == ["mock-brain-mri-v1"]
    assert all(
        c.source_kind == SourceKind.MOCK
        for c in container.router.list_capabilities()
        if c.model_id in decision.model_ids
    )


def test_exclusive_real_drops_overlapping_mocks() -> None:
    caps = [_remote_cap(), *default_capabilities()]
    router = ModelRouter(capabilities=caps)
    policy = ModelExecutionPolicy(mode=VisionExecutionMode.EXCLUSIVE_REAL, capabilities=caps)
    decision = policy.apply(router.route(_case()))
    assert decision.model_ids == ["remote-vision-v1"]
    assert "mock-brain-mri-v1" not in decision.model_ids
    assert "exclusive_real" in decision.reason


def test_mixed_policy_allows_real_and_mock_overlap() -> None:
    caps = [_remote_cap(), *default_capabilities()]
    router = ModelRouter(capabilities=caps)
    policy = ModelExecutionPolicy(mode=VisionExecutionMode.MIXED, capabilities=caps)
    decision = policy.apply(router.route(_case()))
    assert "remote-vision-v1" in decision.model_ids
    assert "mock-brain-mri-v1" in decision.model_ids


def test_exclusive_keeps_mocks_when_no_real_match() -> None:
    """Remote covers brain/cervical/thorax — multimodal OTHER stays mock-only."""
    caps = [_remote_cap(), *default_capabilities()]
    router = ModelRouter(capabilities=caps)
    policy = ModelExecutionPolicy(mode=VisionExecutionMode.EXCLUSIVE_REAL, capabilities=caps)
    decision = policy.apply(
        router.route(
            _case(modality=Modality.OTHER, anatomical_region=AnatomicalRegion.UNKNOWN)
        )
    )
    assert decision.supported is True
    assert decision.model_ids == ["mock-multimodal-vlm-v1"]


def test_unsupported_still_manual_review_with_remote() -> None:
    caps = [_remote_cap(), *default_capabilities()]
    router = ModelRouter(capabilities=caps)
    policy = ModelExecutionPolicy(mode=VisionExecutionMode.EXCLUSIVE_REAL, capabilities=caps)
    decision = policy.apply(
        router.route(_case(species=Species.OTHER, modality=Modality.MR))
    )
    assert decision.supported is False
    assert decision.model_ids == ["manual-review"]


def test_container_default_exclusive_when_remote_configured(tmp_path: Path) -> None:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        vision_endpoint="http://127.0.0.1:9/infer",
        vision_model_id="remote-vision-v1",
        vision_modalities=("MR", "CT", "XR"),
        vision_regions=("BRAIN", "CERVICAL", "THORAX"),
        vision_species=("canine", "feline"),
        vision_execution_policy="exclusive_real",
        async_analyze_delay_ms=0,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    assert container.vision_execution_mode == VisionExecutionMode.EXCLUSIVE_REAL
    routed = container.execution_policy.apply(container.router.route(_case()))
    assert routed.model_ids == ["remote-vision-v1"]


def test_container_mixed_setting_allows_overlap(tmp_path: Path) -> None:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        vision_endpoint="http://127.0.0.1:9/infer",
        vision_model_id="remote-vision-v1",
        vision_modalities=("MR", "CT", "XR"),
        vision_regions=("BRAIN", "CERVICAL", "THORAX"),
        vision_species=("canine", "feline"),
        vision_execution_policy="mixed",
        async_analyze_delay_ms=0,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    assert container.vision_execution_mode == VisionExecutionMode.MIXED
    routed = container.execution_policy.apply(container.router.route(_case()))
    assert "remote-vision-v1" in routed.model_ids
    assert "mock-brain-mri-v1" in routed.model_ids


def test_execution_policy_noop_on_unsupported() -> None:
    policy = ModelExecutionPolicy(mode=VisionExecutionMode.EXCLUSIVE_REAL, capabilities=[])
    decision = RouteDecision(
        supported=False,
        model_ids=["manual-review"],
        reason="unsupported",
        rule_id="fallback.manual_review",
    )
    assert policy.apply(decision) is decision or policy.apply(decision).model_ids == ["manual-review"]
