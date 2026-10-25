from app.llm.gateway import LLMGateway
from app.llm.mock_provider import MockLLMProvider
from app.models.mock_vision import MockBrainMriModel
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, MockScenario, Modality, ReportStatus, Species
from app.schemas.report import ReportSection
from app.validation.report_validator import ReportValidator


def _case() -> CaseRecord:
    return CaseRecord(
        case_id="case-1",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
    )


def test_validator_accepts_mock_draft_and_adds_mock_warnings() -> None:
    case = _case()
    findings = MockBrainMriModel().analyze(case)
    report = LLMGateway(MockLLMProvider()).generate_draft(case, findings)
    result = ReportValidator().validate(report, findings)
    assert result.ok is True
    assert report.status == ReportStatus.AWAITING_REVIEW
    assert any("demo" in w.lower() or "sentetik" in w.lower() for w in result.warnings)
    assert any("klinik doğruluğu" in w.lower() for w in result.warnings)


def test_validator_rejects_unknown_finding_references() -> None:
    case = _case()
    findings = MockBrainMriModel().analyze(case)
    report = LLMGateway(MockLLMProvider()).generate_draft(case, findings)
    report.impression.cited_finding_ids.append("does-not-exist")
    result = ReportValidator().validate(report, findings)
    assert result.ok is False
    assert report.status == ReportStatus.VALIDATION_FAILED
    assert any("Geçersiz bulgu atıfları" in e for e in result.errors)


def test_validator_detects_empty_section() -> None:
    case = _case()
    findings = MockBrainMriModel().analyze(case)
    report = LLMGateway(MockLLMProvider()).generate_draft(case, findings)
    report.technique = ReportSection(text="   ")
    result = ReportValidator().validate(report, findings)
    assert result.ok is False
    assert any("Teknik" in e for e in result.errors)


def test_validator_detects_contradictory_no_findings_flag() -> None:
    case = _case()
    findings = MockBrainMriModel().analyze(case)
    findings.no_findings_returned = True
    report = LLMGateway(MockLLMProvider()).generate_draft(case, findings)
    result = ReportValidator().validate(report, findings)
    assert result.ok is False
    assert any("Çelişkili durum" in e for e in result.errors)
