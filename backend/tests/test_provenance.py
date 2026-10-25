"""F7: synthetic / source_kind provenance regressions."""

from app.models.mock_vision import MockBrainMriModel
from app.models.normalizer import normalize_outputs
from app.schemas.case import CaseRecord
from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    MockScenario,
    Modality,
    ModelExecutionStatus,
    SourceKind,
    Species,
)
from app.schemas.findings import Finding, StructuredFindings, StudyInfo


def _case() -> CaseRecord:
    return CaseRecord(
        case_id="case-prov",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
    )


def test_finding_schema_default_is_not_synthetic() -> None:
    finding = Finding(
        finding_id="f1",
        finding_code="REAL-ISH",
        description="Default synthetic must not force mock labeling",
        anatomical_location="brain",
        finding_status=FindingStatus.SUSPECTED,
        source_model="adapter-x",
    )
    assert finding.synthetic is False


def test_mock_output_remains_synthetic_and_mock() -> None:
    out = MockBrainMriModel().analyze(_case())
    assert out.source_kind == SourceKind.MOCK
    assert out.contributing_source_kinds == [SourceKind.MOCK]
    assert out.findings
    assert all(f.synthetic for f in out.findings)
    assert all(f.source_model == "mock-brain-mri-v1" for f in out.findings)
    assert all(f.source_model_version == "0.1.0" for f in out.findings)


def test_real_output_not_synthetic_by_default() -> None:
    real = StructuredFindings(
        case_id="case-prov",
        study=StudyInfo(),
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        source_model_id="future-real-adapter",
        source_model_version="1.0.0",
        source_kind=SourceKind.REAL,
        execution_status=ModelExecutionStatus.SUCCESS,
        findings=[
            Finding(
                finding_id="f-real",
                finding_code="REAL-STUB",
                description="Real adapter finding",
                anatomical_location="brain",
                finding_status=FindingStatus.UNCERTAIN,
                source_model="future-real-adapter",
                source_model_version="1.0.0",
            )
        ],
        contributing_model_ids=["future-real-adapter"],
        contributing_source_kinds=[SourceKind.REAL],
        warnings=[],
    )
    assert real.findings[0].synthetic is False
    merged = normalize_outputs([real])
    assert merged.source_kind == SourceKind.REAL
    assert merged.findings[0].synthetic is False
    assert merged.findings[0].source_model == "future-real-adapter"
    assert merged.findings[0].source_model_version == "1.0.0"
    assert any("klinik doğrulama anlamına gelmez" in w for w in merged.warnings)


def test_mixed_fusion_retains_per_finding_identity() -> None:
    mock = MockBrainMriModel().analyze(_case())
    real = StructuredFindings(
        case_id="case-prov",
        study=StudyInfo(),
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        source_model_id="future-real-adapter",
        source_model_version="2.0.0",
        source_kind=SourceKind.REAL,
        execution_status=ModelExecutionStatus.SUCCESS,
        findings=[
            Finding(
                finding_id="f-real",
                finding_code="REAL-STUB",
                description="Real adapter finding",
                anatomical_location="brain / other",
                finding_status=FindingStatus.POSSIBLE,
                source_model="future-real-adapter",
                source_model_version="2.0.0",
                synthetic=False,
            )
        ],
        contributing_model_ids=["future-real-adapter"],
        contributing_source_kinds=[SourceKind.REAL],
        warnings=[],
    )
    merged = normalize_outputs([mock, real])
    assert merged.source_kind == SourceKind.MIXED
    by_id = {f.finding_id: f for f in merged.findings}
    mock_f = next(f for f in merged.findings if f.source_model == "mock-brain-mri-v1")
    real_f = by_id["f-real"]
    assert mock_f.synthetic is True
    assert mock_f.source_model_version == "0.1.0"
    assert real_f.synthetic is False
    assert real_f.source_model_version == "2.0.0"
    assert set(merged.contributing_model_ids) == {"mock-brain-mri-v1", "future-real-adapter"}
    assert set(merged.contributing_source_kinds) == {SourceKind.MOCK, SourceKind.REAL}


def test_contradictory_provenance_flagged_not_rewritten() -> None:
    contradictory = StructuredFindings(
        case_id="case-prov",
        study=StudyInfo(),
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        source_model_id="future-real-adapter",
        source_model_version="1.0.0",
        source_kind=SourceKind.REAL,
        execution_status=ModelExecutionStatus.SUCCESS,
        findings=[
            Finding(
                finding_id="f-bad",
                finding_code="REAL-BUT-SYNTHETIC",
                description="Contradictory flags",
                anatomical_location="brain",
                finding_status=FindingStatus.UNCERTAIN,
                source_model="future-real-adapter",
                source_model_version="1.0.0",
                synthetic=True,
            )
        ],
        contributing_model_ids=["future-real-adapter"],
        contributing_source_kinds=[SourceKind.REAL],
        warnings=[],
    )
    merged = normalize_outputs([contradictory])
    assert merged.findings[0].synthetic is True  # not rewritten
    assert merged.source_kind == SourceKind.REAL
    assert any("çelişkili kaynak bilgisi" in w for w in merged.warnings)
