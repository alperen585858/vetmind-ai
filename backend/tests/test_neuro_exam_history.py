"""#72: the neurological exam reaches the AI history, but only the items the vet recorded."""

from __future__ import annotations

from app.llm.gateway import build_rag_query, compose_history
from app.llm.neuro_exam import neuro_exam_text
from app.schemas.case import CaseRecord, StructuredClinicalHistory
from app.schemas.enums import AnatomicalRegion, Modality, ModelExecutionStatus, Species
from app.schemas.findings import StructuredFindings, StudyInfo

NE = "Değerlendirilmedi"

PARAPARESIS = {
    "consciousness": "Uyanık",
    "gait": "Parezi",
    "limbs": ["Sol arka", "Sağ arka"],
    "posturalThoracic": "Normal",
    "posturalPelvic": "Azalmış",
    "reflexThoracic": NE,
    "reflexPelvic": "Artmış",
    "cranialNervesStatus": "Normal",
    "cranialNerves": [],
    "deepPain": "Var",
    "hyperesthesia": "Torakolomber",
}

UNRECORDED = {k: NE for k in (
    "consciousness", "gait", "posturalThoracic", "posturalPelvic", "reflexThoracic",
    "reflexPelvic", "cranialNervesStatus", "deepPain", "hyperesthesia",
)} | {"limbs": [], "cranialNerves": []}


def _case(exam: dict | None) -> CaseRecord:
    return CaseRecord(
        case_id="c-neuro",
        patient_name="Fındık",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.THORACOLUMBAR,
        clinical_history="Arka bacaklarda güçsüzlük.",
        clinical_history_structured=StructuredClinicalHistory(complaint="Akut arka bacak güçsüzlüğü", neuro_exam=exam),
    )


def test_recorded_items_are_written_in_turkish() -> None:
    text = neuro_exam_text(PARAPARESIS)
    assert text.startswith("Nörolojik muayene:")
    assert "yürüyüş parezi (sol arka, sağ arka)" in text
    assert "derin ağrı var" in text
    assert "spinal hiperestezi torakolomber" in text
    assert "kraniyal sinirler normal" in text


def test_unrecorded_items_are_never_sent_as_normal() -> None:
    text = neuro_exam_text(PARAPARESIS)
    assert "torasik" not in text  # reflexThoracic was not evaluated
    assert NE.lower() not in text.lower()
    assert neuro_exam_text(UNRECORDED) == ""
    assert neuro_exam_text(None) == ""
    assert neuro_exam_text({}) == ""


def test_cranial_nerve_signs_are_listed() -> None:
    exam = UNRECORDED | {"cranialNervesStatus": "Bulgu var", "cranialNerves": ["Nistagmus", "Baş eğikliği"]}
    assert neuro_exam_text(exam) == "Nörolojik muayene: kraniyal sinir bulguları: nistagmus, baş eğikliği."


def test_ai_history_contains_exam_only_when_recorded() -> None:
    assert "Nörolojik muayene: " in compose_history(_case(PARAPARESIS))
    assert "Nörolojik muayene" not in compose_history(_case(UNRECORDED))
    assert "Nörolojik muayene" not in compose_history(_case(None))


def test_rag_query_uses_recorded_neuro_signs() -> None:
    findings = StructuredFindings(
        case_id="c-neuro",
        study=StudyInfo(),
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.THORACOLUMBAR,
        source_model_id="mock",
        source_model_version="0",
        execution_status=ModelExecutionStatus.SUCCESS,
        findings=[],
    )
    with_exam = build_rag_query(_case(PARAPARESIS), findings)
    without = build_rag_query(_case(UNRECORDED), findings)
    assert "parezi" in with_exam and "torakolomber" in with_exam
    assert "parezi" not in without and "hiperestezi" not in without
