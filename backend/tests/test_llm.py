from app.llm.gateway import LLMGateway
from app.llm.mock_provider import MockLLMProvider, SYNTHETIC_BANNER
from app.llm.stub_provider import DeterministicStubLLMProvider, STUB_BANNER
from app.models.mock_vision import MockBrainMriModel
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, MockScenario, Modality, Species


def test_gateway_uses_injected_provider() -> None:
    case = CaseRecord(
        case_id="case-1",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
    )
    findings = MockBrainMriModel().analyze(case)
    gateway = LLMGateway(MockLLMProvider())
    report = gateway.generate_draft(case, findings)
    assert report.generation.provider_id == "mock-llm"
    assert report.synthetic is True
    assert report.clinically_validated is False
    assert SYNTHETIC_BANNER in report.findings.text
    assert findings.findings[0].finding_id in report.findings.cited_finding_ids
    assert report.generation.source_kind.value == "mock"


def test_gateway_set_provider_swaps_implementations() -> None:
    case = CaseRecord(
        case_id="case-1",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
    )
    findings = MockBrainMriModel().analyze(case)
    gateway = LLMGateway(MockLLMProvider())
    gateway.set_provider(DeterministicStubLLMProvider())
    report = gateway.generate_draft(case, findings)
    assert report.generation.provider_id == "stub-llm"
    assert STUB_BANNER in report.impression.text
