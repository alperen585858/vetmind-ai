import math

import pytest
from pydantic import ValidationError

from app.evaluation.metrics import (
    AnatomicalFinding,
    BoundingBox,
    ClinicalClassificationMetrics,
    ConfusionMatrixStats,
    MedicalHallucinationDetector,
    RadiologyReportPayload,
    SpatialAndSymmetryEvaluator,
    TemplateAdherenceEvaluator,
)
from app.schemas.case import CaseRecord
from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    Modality,
    ModelExecutionStatus,
    Species,
)
from app.schemas.findings import Finding, StructuredFindings
from app.schemas.model_outputs import BoundingBox2D
from app.schemas.report import DraftReport, GenerationMetadata, ReportSection


def test_clinical_metrics_perfect_and_worst_scores() -> None:
    evaluator = ClinicalClassificationMetrics()
    perfect = evaluator.evaluate_class_metrics(
        ConfusionMatrixStats(true_positive=50, true_negative=50)
    )
    assert perfect.sensitivity == perfect.specificity == perfect.ppv == 1.0
    assert perfect.f1_score == perfect.f2_score == perfect.mcc == 1.0

    inverted = evaluator.evaluate_class_metrics(
        ConfusionMatrixStats(false_positive=50, false_negative=50)
    )
    assert inverted.sensitivity == inverted.specificity == inverted.ppv == 0.0
    assert inverted.f1_score == 0.0
    assert inverted.mcc == -1.0


def test_clinical_metrics_zero_denominators_and_known_values() -> None:
    evaluator = ClinicalClassificationMetrics()
    empty = evaluator.evaluate_class_metrics(ConfusionMatrixStats())
    assert empty.sensitivity == empty.specificity == empty.ppv == empty.npv == 0.0
    assert empty.f1_score == empty.f2_score == empty.mcc == 0.0
    assert (empty.sensitivity_ci_lower, empty.sensitivity_ci_upper) == (0.0, 0.0)

    result = evaluator.evaluate_class_metrics(
        ConfusionMatrixStats(
            true_positive=5,
            false_positive=1,
            true_negative=9,
            false_negative=2,
        )
    )
    assert result.sensitivity == pytest.approx(5 / 7)
    assert result.specificity == pytest.approx(0.9)
    assert result.ppv == pytest.approx(5 / 6)
    assert result.npv == pytest.approx(9 / 11)
    assert result.f1_score == pytest.approx(10 / 13)
    assert result.f2_score == pytest.approx(25 / 34)
    assert result.mcc == pytest.approx(0.6326266278)


def test_wilson_interval_and_invalid_inputs() -> None:
    evaluator = ClinicalClassificationMetrics()
    lower, upper = evaluator.calculate_wilson_score_interval(p=0.8, n=100)
    assert lower == pytest.approx(0.7112, abs=0.001)
    assert upper == pytest.approx(0.8666, abs=0.001)
    assert 0.0 <= lower <= upper <= 1.0
    assert evaluator.calculate_wilson_score_interval(p=0.0, n=10)[0] == 0.0
    assert evaluator.calculate_wilson_score_interval(p=1.0, n=10)[1] == 1.0
    for proportion, count in ((-0.1, 1), (1.1, 1), (math.nan, 1), (0.5, -1)):
        with pytest.raises(ValueError):
            evaluator.calculate_wilson_score_interval(proportion, count)
    with pytest.raises(ValueError):
        ClinicalClassificationMetrics(0.0)


@pytest.mark.parametrize(
    "values",
    [
        {"true_positive": -1},
        {"false_positive": 1.5},
        {"true_negative": True},
    ],
)
def test_confusion_matrix_rejects_invalid_counts(values: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        ConfusionMatrixStats(**values)


def test_hallucination_detector_avoids_double_counting_critical_error() -> None:
    detector = MedicalHallucinationDetector()
    predicted = RadiologyReportPayload(
        patient_breed="Chihuahua",
        skull_morphotype="mesaticephalic",
        findings=[
            AnatomicalFinding(
                finding_name="Severe calvarium fracture",
                confidence=0.9,
            )
        ],
        full_report_text="Fracture noted.",
    )
    truth = RadiologyReportPayload(
        patient_breed="Chihuahua",
        skull_morphotype="mesaticephalic",
        findings=[AnatomicalFinding(finding_name="Open fontanel", confidence=1.0)],
        full_report_text="Normal fontanel.",
    )
    result = detector.calculate_mhi(predicted, truth)
    assert result.critical_pitfalls_detected == 1
    assert result.minor_hallucinations_detected == 0
    assert result.mhi_score == 75.0
    assert any("CRITICAL PITFALL" in detail for detail in result.penalty_details)


def test_hallucination_detector_counts_minor_once_and_matches_normalized_names() -> None:
    detector = MedicalHallucinationDetector()
    prediction = RadiologyReportPayload(
        patient_breed="Golden Retriever",
        skull_morphotype="mesaticephalic",
        findings=[
            AnatomicalFinding("Otitis Media"),
            AnatomicalFinding("unverified lesion"),
        ],
        full_report_text="",
    )
    truth = RadiologyReportPayload(
        patient_breed="Golden Retriever",
        skull_morphotype="mesaticephalic",
        findings=[AnatomicalFinding("otitis-media")],
        full_report_text="",
    )
    result = detector.calculate_mhi(prediction, truth)
    assert result.critical_pitfalls_detected == 0
    assert result.minor_hallucinations_detected == 1
    assert result.mhi_score == 95.0


def test_hallucination_detector_brachycephalic_pitfall_and_score_floor() -> None:
    detector = MedicalHallucinationDetector()
    prediction = RadiologyReportPayload(
        "Pug",
        "brachycephalic",
        [AnatomicalFinding("otitis media") for _ in range(5)],
        "",
    )
    truth = RadiologyReportPayload("Pug", "brachycephalic", [], "")
    result = detector.calculate_mhi(prediction, truth)
    assert result.critical_pitfalls_detected == 1
    assert result.minor_hallucinations_detected == 0
    assert result.mhi_score == 75.0

    many = RadiologyReportPayload(
        "Other",
        "mesaticephalic",
        [AnatomicalFinding(f"finding {index}") for index in range(25)],
        "",
    )
    assert detector.calculate_mhi(many, truth).mhi_score == 0.0


def test_hallucination_detector_confirmed_pitfall_and_yorkshire_rule() -> None:
    detector = MedicalHallucinationDetector()
    confirmed = RadiologyReportPayload(
        "Chihuahua",
        "mesaticephalic",
        [AnatomicalFinding("skull fracture")],
        "",
    )
    confirmed_truth = RadiologyReportPayload(
        "Chihuahua",
        "mesaticephalic",
        [AnatomicalFinding("skull fracture")],
        "",
    )
    assert detector.calculate_mhi(confirmed, confirmed_truth).critical_pitfalls_detected == 0

    predicted = RadiologyReportPayload(
        "Yorkshire Terrier",
        "mesaticephalic",
        [AnatomicalFinding("mandibular symphyseal fracture")],
        "",
    )
    truth = RadiologyReportPayload("Yorkshire Terrier", "mesaticephalic", [], "")
    result = detector.calculate_mhi(predicted, truth)
    assert result.critical_pitfalls_detected == 1
    assert result.minor_hallucinations_detected == 0
    assert detector.normalize_string("Sutura coronalis — Çene") == "sutura coronalis cene"


def test_spatial_metrics_perfect_partial_disjoint_and_degenerate_boxes() -> None:
    evaluator = SpatialAndSymmetryEvaluator()
    same = BoundingBox(0, 0, 10, 10)
    assert evaluator.calculate_iou(same, same) == 1.0
    assert evaluator.calculate_giou(same, same) == 1.0
    assert evaluator.calculate_dsc(same, same) == 1.0
    assert evaluator.calculate_euclidean_distance(same, same) == 0.0

    overlap = BoundingBox(5, 5, 15, 15)
    assert evaluator.calculate_iou(same, overlap) == pytest.approx(1 / 7)
    assert evaluator.calculate_dsc(same, overlap) == pytest.approx(0.25)

    disjoint = BoundingBox(20, 20, 30, 30)
    assert evaluator.calculate_iou(same, disjoint) == 0.0
    assert evaluator.calculate_giou(same, disjoint) < 0.0
    assert evaluator.calculate_dsc(same, disjoint) == 0.0
    assert evaluator.calculate_euclidean_distance(same, disjoint) == math.sqrt(800)

    point = BoundingBox(0, 0, 0, 0)
    assert evaluator.calculate_iou(point, point) == 0.0
    assert evaluator.calculate_giou(point, point) == 0.0
    assert evaluator.calculate_dsc(point, point) == 0.0


def test_spatial_evaluator_accepts_project_detection_boxes() -> None:
    project_box = BoundingBox2D(x_min=1, y_min=2, x_max=5, y_max=8)
    assert BoundingBox.from_model_output(project_box) == BoundingBox(1, 2, 5, 8)


@pytest.mark.parametrize(
    "coordinates",
    [
        (2, 0, 1, 1),
        (0, 2, 1, 1),
        (0, 0, math.inf, 1),
    ],
)
def test_bounding_box_rejects_invalid_coordinates(
    coordinates: tuple[float, float, float, float],
) -> None:
    with pytest.raises(ValueError):
        BoundingBox(*coordinates)


def test_laterality_accuracy_and_finding_validation() -> None:
    evaluator = SpatialAndSymmetryEvaluator()
    assert evaluator.calculate_laterality_accuracy(
        AnatomicalFinding("finding", affected_side="left"),
        AnatomicalFinding("finding", affected_side="left"),
    ) == 1.0
    assert evaluator.calculate_laterality_accuracy(
        AnatomicalFinding("finding", is_bilateral=True),
        AnatomicalFinding("finding", affected_side="right"),
    ) == 0.0
    assert evaluator.calculate_laterality_accuracy(
        AnatomicalFinding("finding"),
        AnatomicalFinding("finding"),
    ) == 0.0
    with pytest.raises(ValueError):
        AnatomicalFinding("finding", confidence=1.1)
    with pytest.raises(ValueError):
        AnatomicalFinding("finding", affected_side="middle")


def _draft_report(
    technique: str = "MR",
    findings: str = "No findings",
    impression: str = "No impression",
    recommendations: str = "Review",
) -> DraftReport:
    return DraftReport(
        report_id="report-1",
        case_id="case-1",
        generation=GenerationMetadata(
            provider_id="mock",
            model_id="test",
            model_version="1",
        ),
        technique=ReportSection(text=technique),
        findings=ReportSection(text=findings),
        impression=ReportSection(text=impression),
        recommendations=ReportSection(text=recommendations),
    )


def test_template_evaluator_checks_project_sections_and_text_headings() -> None:
    evaluator = TemplateAdherenceEvaluator()
    assert evaluator.evaluate_structural_integrity(_draft_report()) == {
        "template_completion_ratio": 100.0,
        "missing_sections": [],
        "is_valid_structure": True,
    }
    incomplete = evaluator.evaluate_structural_integrity(
        _draft_report(recommendations=" ")
    )
    assert incomplete["template_completion_ratio"] == 75.0
    assert incomplete["missing_sections"] == ["Recommendations"]
    assert incomplete["is_valid_structure"] is False

    text = (
        "Technique: MR\nFindings: Normal\nImpression: No acute change\n"
        "Recommendations: Follow up"
    )
    assert evaluator.evaluate_structural_integrity(text)["is_valid_structure"] is True
    assert evaluator.evaluate_structural_integrity("Findings only") == {
        "template_completion_ratio": 0.0,
        "missing_sections": [
            "Technique",
            "Findings",
            "Impression",
            "Recommendations",
        ],
        "is_valid_structure": False,
    }
    assert evaluator.calculate_terminology_density(
        "The rostral aspect is radiolucent and caudal margin shows lysis."
    ) == 40.0
    assert evaluator.calculate_terminology_density("") == 0.0


def test_project_payload_adapter_and_id_validation() -> None:
    case = CaseRecord(
        case_id="case-1",
        patient_name="Pax",
        species=Species.CANINE,
        breed="Golden Retriever",
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
    )
    findings = StructuredFindings(
        case_id="case-1",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        source_model_id="mock",
        source_model_version="1",
        execution_status=ModelExecutionStatus.SUCCESS,
        findings=[
            Finding(
                finding_id="f1",
                finding_code="X",
                description="mild mass effect",
                anatomical_location="brain",
                finding_status=FindingStatus.SUSPECTED,
                source_model="mock",
                model_confidence=0.8,
            )
        ],
    )
    report = _draft_report()
    payload = RadiologyReportPayload.from_project(
        case=case,
        findings=findings,
        report=report,
        skull_morphotype="mesaticephalic",
    )
    assert payload.patient_breed == "Golden Retriever"
    assert payload.findings[0].finding_name == "mild mass effect"
    assert payload.findings[0].confidence == 0.8
    assert "Recommendations" not in payload.full_report_text
    assert payload.full_report_text.endswith("Review")
    without_report = RadiologyReportPayload.from_project(
        case=case,
        findings=findings,
    )
    assert without_report.full_report_text == ""

    wrong_case = case.model_copy(update={"case_id": "other"})
    with pytest.raises(ValueError):
        RadiologyReportPayload.from_project(case=wrong_case, findings=findings)
    with pytest.raises(ValueError):
        RadiologyReportPayload.from_project(
            case=case,
            findings=findings,
            report=report.model_copy(update={"case_id": "other"}),
        )
