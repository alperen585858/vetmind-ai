import pytest

from app.models.mock_vision import MockBrainMriModel, MockCervicalMriModel, MockVisionError
from app.models.normalizer import normalize_outputs
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, FindingStatus, MockScenario, Modality, ModelExecutionStatus, Species


def _case(**kwargs) -> CaseRecord:
    base = dict(
        case_id="case-1",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
    )
    base.update(kwargs)
    return CaseRecord(**base)


def test_brain_adapter_returns_labeled_mock_finding() -> None:
    out = MockBrainMriModel().analyze(_case())
    assert out.source_kind.value == "mock"
    assert out.execution_status == ModelExecutionStatus.SUCCESS
    assert out.findings[0].finding_code == "MOCK-BRAIN-MASS-EFFECT"
    assert out.findings[0].finding_status == FindingStatus.SUSPECTED
    assert "kitle etkisi" in out.findings[0].description.lower()
    assert out.absences_not_confirmed is True


def test_cervical_adapter_returns_labeled_mock_finding() -> None:
    out = MockCervicalMriModel().analyze(
        _case(anatomical_region=AnatomicalRegion.CERVICAL, scenario=MockScenario.CERVICAL_MRI_SUSPECTED)
    )
    assert out.findings[0].finding_code == "MOCK-CERVICAL-CORD-COMPRESSION"


def test_no_findings_is_not_disease_absence() -> None:
    out = MockBrainMriModel().analyze(_case(scenario=MockScenario.NO_FINDINGS))
    assert out.findings == []
    assert out.no_findings_returned is True
    assert out.absences_not_confirmed is True
    assert any("hastalığın olmadığının" in w.lower() for w in out.warnings)


def test_model_failure_is_deterministic() -> None:
    with pytest.raises(MockVisionError):
        MockBrainMriModel().analyze(_case(scenario=MockScenario.MODEL_FAILURE))


def test_normalizer_preserves_conflicts() -> None:
    from app.models.mock_vision import MockBrainMriAltModel

    a = MockBrainMriModel().analyze(_case(scenario=MockScenario.CONFLICTING))
    b = MockBrainMriAltModel().analyze(_case(scenario=MockScenario.CONFLICTING))
    merged = normalize_outputs([a, b])
    codes = {f.finding_code for f in merged.findings}
    assert "MOCK-BRAIN-MASS-EFFECT" in codes
    assert "MOCK-BRAIN-NO-MASS-EFFECT" in codes
    assert merged.potential_conflicts
    assert any("OLASI ÇELİŞKİ KORUNDU" in w for w in merged.warnings)
    assert all(f.source_model_version == "0.1.0" for f in merged.findings)
