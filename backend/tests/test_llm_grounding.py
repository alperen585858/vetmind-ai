from app.llm.gateway import LLMGateway
from app.llm.grounding import check_grounding
from app.llm.mock_provider import MockLLMProvider
from app.models.mock_vision import MockBrainMriModel
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, MockScenario, Modality, Species
from app.schemas.report import DifferentialDiagnosis, DraftReport, GenerationMetadata, ReportSection
from app.validation.report_validator import ReportValidator


def _report(findings: str, impression: str, citation_map: dict[str, str] | None = None) -> DraftReport:
    return DraftReport(
        report_id="r1",
        case_id="c1",
        generation=GenerationMetadata(
            provider_id="openai", model_id="m", model_version="m", prompt_version="vetmind-report-v1"
        ),
        technique=ReportSection(text="Köpek, beyin MR."),
        findings=ReportSection(text=findings),
        impression=ReportSection(text=impression),
        recommendations=ReportSection(text="Uzman radyolog incelemesi gereklidir."),
        citation_map=citation_map if citation_map is not None else {"F1": "find-1", "F2": "find-2", "S1": "kb-1"},
    )


def test_clean_draft_has_no_grounding_warnings() -> None:
    r = _report(
        "- Sol frontal lobda şüpheli kitle lezyonu izlenmektedir [F1].\n- Hafif perilezyonel ödem olasıdır [F2].",
        "Meningiom olası görünmekle birlikte glioma ekarte edilemez [F1, S1].",
    )
    assert check_grounding(r) == []


def test_marker_after_full_stop_counts_as_cited() -> None:
    r = _report(
        "Olfaktör bulbus bölgesinde şüpheli kitle etkisi izlenmektedir. [F1, S1].\nHafif ödem olasıdır. [F2]",
        "Ekstra-aksiyel neoplazi olası görünmektedir. [F1]",
    )
    assert check_grounding(r) == []


def test_flags_uncited_unknown_and_omitted() -> None:
    r = _report(
        "Sol frontal lobda şüpheli kitle lezyonu izlenmektedir [F1].",
        "Bu görünüm tipik olarak yüksek dereceli gliomu düşündürür. Ayrıca [S4] ile uyumludur.",
    )
    warnings = check_grounding(r)
    text = " | ".join(warnings)
    assert "unknown reference(s) S4" in text
    assert "1 uncited statement(s) in impression" in text and "yüksek dereceli" in text
    assert "not mentioned in the draft: F2 (find-2)" in text


def test_flags_overclaims_but_not_hedged_language() -> None:
    hedged = _report("Şüpheli kitle [F1]. Ödem olası [F2].", "Neoplazi ekarte edilemez; GME dışlanamaz [S1].")
    assert check_grounding(hedged) == []

    r = _report(
        "Kitle izlenmektedir [F1]. Ödem [F2].",
        "Kesin tanı meningiomdur [F1]. Enfeksiyon ekarte edildi [S1]. Başka patoloji saptanmadı [F2].",
    )
    text = " | ".join(check_grounding(r))
    assert "definitive diagnosis" in text
    assert "excluded diagnosis" in text
    assert "absence of disease" in text


def test_english_overclaims() -> None:
    r = _report("Mass [F1]. Edema [F2].", "This definitively represents meningioma and rules out GME [S1].")
    text = " | ".join(check_grounding(r))
    assert "definitive diagnosis" in text and "excluded diagnosis" in text


def test_mock_template_reports_are_not_grounding_checked() -> None:
    case = CaseRecord(
        case_id="case-1",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        scenario=MockScenario.BRAIN_MRI_SUSPECTED,
    )
    findings = MockBrainMriModel().analyze(case)
    report = LLMGateway(MockLLMProvider()).generate_draft(case, findings)
    assert report.generation.prompt_version is None
    assert check_grounding(report) == []


def test_validator_rechecks_after_expert_edit() -> None:
    r = _report("Şüpheli kitle [F1]. Ödem olası [F2].", "Meningiom olası [F1, S1].")
    ReportValidator().validate(r, None)
    assert not [w for w in r.validation_warnings if w.startswith("Grounding")]

    r.impression = ReportSection(text="Kesin tanı meningiomdur ve cerrahi gerekir.")
    ReportValidator().validate(r, None)
    grounding = [w for w in r.validation_warnings if w.startswith("Grounding")]
    assert any("definitive diagnosis" in w for w in grounding)
    assert any("uncited statement" in w for w in grounding)


def test_differentials_are_grounding_checked() -> None:
    r = _report("Şüpheli kitle izlenmektedir [F1]. Ödem olası [F2].", "Meningiom olası görünmektedir [F1, S1].")
    r.differentials = [
        DifferentialDiagnosis(name="Meningiom", likelihood="high", citations=["F1", "S1"]),
        DifferentialDiagnosis(name="Gliom", likelihood="low", citations=[]),
        DifferentialDiagnosis(name="Apse", likelihood="low", citations=["S7"]),
    ]
    text = " | ".join(check_grounding(r))
    assert 'differential(s) without citation: "Gliom"' in text
    assert "differentials cites unknown reference(s) S7" in text


def test_differential_citation_counts_as_mentioning_a_finding() -> None:
    r = _report("Şüpheli kitle izlenmektedir [F1].", "Meningiom olası görünmektedir [F1, S1].")
    assert any("not mentioned" in w for w in check_grounding(r))
    r.differentials = [DifferentialDiagnosis(name="Ödem", likelihood="moderate", citations=["F2"])]
    assert not any("not mentioned" in w for w in check_grounding(r))


def test_placeholder_sections_are_reported_not_flagged_as_uncited() -> None:
    from app.llm.structured_output import EMPTY_SECTION_TEXT

    r = _report(EMPTY_SECTION_TEXT["tr"]["findings"], EMPTY_SECTION_TEXT["tr"]["impression"], citation_map={})
    warnings = check_grounding(r)
    assert warnings == [
        "Grounding: model left section(s) empty: findings, impression — "
        "placeholder or auto-listed findings were inserted; write these sections manually."
    ]
