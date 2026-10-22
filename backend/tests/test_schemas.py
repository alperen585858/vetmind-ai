import pytest
from pydantic import ValidationError

from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    Modality,
    ModelExecutionStatus,
    SourceKind,
    Species,
)
from app.schemas.findings import FINDINGS_SCHEMA_VERSION, Finding, StructuredFindings
from app.schemas.report import DraftReport, GenerationMetadata, ReportSection


def test_structured_findings_requires_core_fields() -> None:
    with pytest.raises(ValidationError):
        StructuredFindings(  # type: ignore[call-arg]
            case_id="case-1",
        )


def test_structured_findings_preserves_uncertainty() -> None:
    payload = StructuredFindings(
        case_id="case-1",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        source_model_id="mock-brain-mri-v1",
        source_model_version="0.1.0",
        source_kind=SourceKind.MOCK,
        execution_status=ModelExecutionStatus.SUCCESS,
        no_findings_returned=True,
        absences_not_confirmed=True,
        findings=[],
    )
    assert payload.schema_version == FINDINGS_SCHEMA_VERSION
    assert payload.absences_not_confirmed is True
    assert payload.review_required is True
    assert payload.findings == []


def test_finding_status_does_not_include_absent() -> None:
    assert "absent" not in FindingStatus._value2member_map_


def test_draft_report_requires_sections() -> None:
    report = DraftReport(
        report_id="rpt-1",
        case_id="case-1",
        generation=GenerationMetadata(
            provider_id="mock-llm",
            model_id="mock-report-generator",
            model_version="0.1.0",
        ),
        technique=ReportSection(text="technique"),
        findings=ReportSection(text="findings", cited_finding_ids=["f1"]),
        impression=ReportSection(text="impression", cited_finding_ids=["f1"]),
        recommendations=ReportSection(text="recs"),
    )
    assert report.synthetic is True
    assert report.clinically_validated is False
    assert report.findings.cited_finding_ids == ["f1"]


def test_finding_model_roundtrip() -> None:
    finding = Finding(
        finding_id="f1",
        finding_code="MOCK-BRAIN-MASS-EFFECT",
        description="SYNTHETIC MOCK FINDING",
        anatomical_location="brain",
        finding_status=FindingStatus.SUSPECTED,
        source_model="mock-brain-mri-v1",
    )
    assert finding.requires_review is True
    assert finding.synthetic is True
