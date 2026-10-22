"""F5: adapters must not mutate CaseRecord / ImagingModelInput."""

import copy

import httpx
import pytest

from app.models.http_vision import HttpRemoteVisionModel
from app.models.interfaces import ImagingAdapterError
from app.models.mock_vision import MockBrainMriModel, MockCervicalMriModel
from app.models.model_input_builder import build_imaging_model_input, require_model_input
from app.orchestration.orchestrator import AIOrchestrator
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, MockScenario, Modality, Species
from app.container import AppContainer
from app.services.repository import InMemoryCaseRepository


def _case(**kwargs) -> CaseRecord:
    data = dict(
        case_id="case-imm",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
    )
    data.update(kwargs)
    return CaseRecord(**data)


def test_require_model_input_does_not_attach() -> None:
    case = _case()
    assert case.model_input is None
    with pytest.raises(ImagingAdapterError, match="missing"):
        require_model_input(case)
    assert case.model_input is None


def test_build_imaging_model_input_does_not_mutate_case() -> None:
    case = _case()
    before = case.model_dump(mode="json")
    pkg = build_imaging_model_input(case)
    assert case.model_input is None
    assert case.model_dump(mode="json") == before
    assert pkg.case_id == case.case_id
    with pytest.raises(Exception):
        pkg.case_id = "mutated"  # type: ignore[misc]


def test_mock_adapter_does_not_mutate_case() -> None:
    case = _case()
    case.model_input = build_imaging_model_input(case)
    snapshot = copy.deepcopy(case.model_dump(mode="json"))
    MockBrainMriModel().analyze(case)
    after = case.model_dump(mode="json")
    assert after == snapshot


def test_cervical_mock_adapter_does_not_mutate_case() -> None:
    case = _case(
        anatomical_region=AnatomicalRegion.CERVICAL,
        scenario=MockScenario.CERVICAL_MRI_SUSPECTED,
    )
    case.model_input = build_imaging_model_input(case)
    snapshot = copy.deepcopy(case.model_dump(mode="json"))
    MockCervicalMriModel().analyze(case)
    assert case.model_dump(mode="json") == snapshot


def test_http_adapter_does_not_mutate_case() -> None:
    case = _case()
    case.model_input = build_imaging_model_input(case)
    snapshot = copy.deepcopy(case.model_dump(mode="json"))
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={"execution_status": "success", "source_kind": "real", "findings": []},
        )
    )
    model = HttpRemoteVisionModel(model_id="remote-vision-v1", endpoint="http://vision.test/infer")
    original = httpx.Client

    class Patched(original):  # type: ignore[misc,valid-type]
        def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    import app.models.http_vision as hv

    hv.httpx.Client = Patched  # type: ignore[assignment]
    try:
        model.analyze(case)
    finally:
        hv.httpx.Client = original  # type: ignore[assignment]
    assert case.model_dump(mode="json") == snapshot


def test_orchestrator_attaches_model_input_then_adapters_read_only() -> None:
    container = AppContainer(repo=InMemoryCaseRepository())
    case = _case()
    assert case.model_input is None
    result = container.orchestrator.run(case, AIOrchestrator.new_job(case.case_id))
    assert result.findings is not None
    assert case.model_input is not None
    # Re-run analyze path on attached input: mock must not rewrite model_input identity fields
    mi_dump = case.model_input.model_dump(mode="json")
    MockBrainMriModel().analyze(case)
    assert case.model_input.model_dump(mode="json") == mi_dump
