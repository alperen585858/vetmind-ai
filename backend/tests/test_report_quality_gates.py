"""Sequence inference, systematic review, limitation notes and differential gating."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.imaging.analysis_limitations import (
    context_gaps,
    sampling_limitation,
    sequence_limitations,
)
from app.imaging.mr_sequence import infer_mr_sequence
from app.imaging.systematic_checklist import (
    checklist_for,
    merge_systematic_review,
    parse_systematic_review,
)
from app.llm.differential_gate import (
    actionable_findings,
    filter_differentials,
    is_limitation_text,
)
from app.llm.structured_output import DifferentialWire
from app.schemas.enums import FindingStatus

# --- MR sequence from header -------------------------------------------------------------

# Tags of the real preclinical sample that produced "sekans bilinmiyor": no SeriesDescription.
BRUKER_T1 = {
    "ProtocolName": "2D RARE-T1",
    "SequenceName": "RARE (pvm)",
    "RepetitionTime": "1503.447",
    "EchoTime": "8.5",
    "ImagingFrequency": "400.340461",
    "MRAcquisitionType": "2D",
    "SliceThickness": "0.5",
    "PixelSpacing": [0.234375, 0.234375],
    "Rows": 256,
    "Columns": 256,
    "Manufacturer": "Bruker BioSpin MRI GmbH",
}


def test_protocol_name_identifies_sequence_when_series_description_missing() -> None:
    info = infer_mr_sequence(BRUKER_T1)
    assert info.label == "T1"
    assert info.source == "protocol_name"
    assert info.confidence == "medium"
    assert info.known
    assert info.display_name == "2D RARE-T1"
    # TR/TE disagree with the name, and the scanner is 9.4 T: both are surfaced, not hidden.
    assert "proton dansite" in info.note
    assert "9.4 T" in info.note and "preklinik" in info.note
    assert "TR=1503.45 ms" in info.acquisition_summary


@pytest.mark.parametrize(
    ("desc", "label", "contrast"),
    [
        ("Ax T2 FLAIR", "FLAIR", False),
        ("T1 POST GAD", "T1", True),
        ("t2_tse_tra", "T2", False),
        ("PD_FS", "PD", False),
        ("DWI b1000", "DWI", False),
        ("T2*GRE", "T2*", False),
        ("sag STIR", "STIR", False),
    ],
)
def test_series_description_labels(desc: str, label: str, contrast: bool) -> None:
    info = infer_mr_sequence({"SeriesDescription": desc})
    assert info.label == label
    assert info.contrast is contrast
    assert info.confidence == "high"


def test_timing_only_is_low_confidence_and_not_known() -> None:
    info = infer_mr_sequence({"RepetitionTime": 500, "EchoTime": 12})
    assert info.label == "T1"
    assert info.source == "tr_te"
    assert info.confidence == "low"
    assert not info.known


def test_nothing_to_go_on() -> None:
    info = infer_mr_sequence({})
    assert info.label is None and not info.known


# --- limitations -------------------------------------------------------------------------


def test_single_slice_mr_is_limited_sampling() -> None:
    assert sampling_limitation("MR", 1)
    assert sampling_limitation("MR", 3) is None
    assert sampling_limitation("XR", 1) is None


def test_context_gaps_lists_missing_inputs() -> None:
    case = SimpleNamespace(breed=None, patient_age_years=None, clinical_history="")
    (note,) = context_gaps(case, history_text="")
    assert note.startswith("Eksik bilgi:")
    assert "ırk" in note and "yaş" in note and "öykü" in note
    full = SimpleNamespace(breed="Beagle", patient_age_years=4.0, clinical_history="nöbet")
    assert context_gaps(full, history_text="nöbet") == []


def test_sequence_limitations_flags_unknown_and_preclinical() -> None:
    known = SimpleNamespace(
        series_instance_uid="1", series_label="2D RARE-T1", mr_sequence=infer_mr_sequence(BRUKER_T1)
    )
    unknown = SimpleNamespace(series_instance_uid="2", series_label=None, mr_sequence=infer_mr_sequence({}))
    notes = sequence_limitations([known, unknown], "MR")
    assert any("preklinik" in n for n in notes)
    assert any("belirlenemedi" in n for n in notes)
    assert all(n.startswith("Sınırlama:") for n in notes)


# --- systematic review -------------------------------------------------------------------


def test_parse_and_merge_systematic_review() -> None:
    sent = [SimpleNamespace(index=1), SimpleNamespace(index=2)]
    batch1 = parse_systematic_review(
        {
            "systematic_review": [
                {"region": "Orta hat (şift)", "status": "no_abnormality_seen", "source_image_index": 1},
                # Negative without a real slice cannot be scoped → not_assessable.
                {"region": "Serebellum", "status": "normal", "source_image_index": 9},
                {"region": "", "status": "not_in_view"},
                {"region": "Beyin sapı", "status": "bogus"},
            ]
        },
        sent=sent,
        locus_for=lambda fr: f"IMG-{fr.index}",
    )
    assert [(i.region, i.status) for i in batch1] == [
        ("Orta hat (şift)", "no_abnormality_seen"),
        ("Serebellum", "not_assessable"),
    ]
    assert batch1[0].evidence_locus == "IMG-1"
    batch2 = parse_systematic_review(
        {"systematic_review": [{"region": "orta hat (şift)", "status": "abnormality_suspected", "source_image_index": 2}]},
        sent=sent,
    )
    merged = merge_systematic_review([batch1, batch2], region="BRAIN")
    by_region = {i.region.lower(): i.status for i in merged}
    assert by_region["orta hat (şift)"] == "abnormality_suspected"
    # Every checklist region is present, skipped ones explicitly.
    assert len(merged) == len(checklist_for("BRAIN"))
    assert by_region["beyin sapı"] == "not_assessable"


def test_merge_without_answers_stays_empty() -> None:
    assert merge_systematic_review([[]], region="BRAIN") == []


# --- differential gate -------------------------------------------------------------------


def _f(code: str, status: FindingStatus) -> SimpleNamespace:
    return SimpleNamespace(finding_code=code, finding_status=status)


def test_technique_and_descriptive_findings_are_not_actionable() -> None:
    sample = [
        _f("IMAGE-QUALITY", FindingStatus.UNCERTAIN),
        _f("BRAIN-STRUCTURE", FindingStatus.UNCERTAIN),
    ]
    assert actionable_findings(sample) == []
    lesion = _f("VENTRICLE-DILATION", FindingStatus.UNCERTAIN)
    assert actionable_findings([*sample, lesion]) == [lesion]


def test_filter_drops_limitation_items_and_phrases() -> None:
    items = [
        DifferentialWire(
            name="Sekans Belirsizliğine Bağlı Değerlendirilemeyen Serebral Görünüm",
            supporting=["hemisferler görünür"],
            citations=["F2"],
        ),
        DifferentialWire(
            name="Hidrosefali",
            supporting=["lateral ventrikül genişliği"],
            against=["Sekans tipi bilinmediğinden sinyal intensitesinin değerlendirilememesi"],
            citations=["F3"],
        ),
        DifferentialWire(name="GME", against=["tek odaklı lezyon"], citations=["S2"]),
        DifferentialWire(name="Boş", citations=["S1"]),
    ]
    kept = filter_differentials(items, actionable_aliases={"F3"})
    assert [d.name for d in kept] == ["Hidrosefali", "GME"]
    assert kept[0].against == []
    assert is_limitation_text("artefakt nedeniyle değerlendirilemedi")


def test_draft_with_only_technique_findings_has_no_differentials() -> None:
    from app.llm.interfaces import LLMFindingRef, LLMGenerationInput, LLMRequest
    from app.llm.prompts import build_aliases, build_user_prompt
    from app.llm.structured_output import build_draft_report, parse_report_payload
    from app.schemas.enums import (
        AnatomicalRegion,
        Modality,
        ModelExecutionStatus,
        Species,
    )

    gen = LLMGenerationInput(
        case_id="c1",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        execution_status=ModelExecutionStatus.PARTIAL,
        findings=[
            LLMFindingRef(
                finding_id="f1", finding_code="IMAGE-QUALITY", description="kalite yeterli",
                anatomical_location="beyin", finding_status=FindingStatus.UNCERTAIN, source_model="vlm",
            ),
            LLMFindingRef(
                finding_id="f2", finding_code="BRAIN-STRUCTURE", description="hemisferler izleniyor",
                anatomical_location="serebrum", finding_status=FindingStatus.UNCERTAIN, source_model="vlm",
            ),
        ],
        acquisition_notes=["2D RARE-T1: T1 ağırlıklı (kaynak=protocol_name, güven=medium)"],
        limitations=["Eksik bilgi: ırk, yaş girilmemiş."],
        systematic_review=["Orta hat (şift): incelenen kesitte anormallik izlenmedi (IMG-1)"],
        limited_sampling=True,
    )
    aliases = build_aliases(gen)
    prompt = build_user_prompt(gen, aliases)
    assert "2D RARE-T1" in prompt and "LIMITED SAMPLING" in prompt
    assert "SYSTEMATIC REVIEW" in prompt and "LIMITATIONS AND MISSING INPUT" in prompt

    wire = parse_report_payload(
        {
            "technique": "t", "findings": "f [F1]", "impression": "i [F2]", "recommendations": "r",
            "differentials": [
                {"name": "Yapısal veya İdiyopatik İntrakraniyal Bozukluk", "likelihood": "low",
                 "supporting": [], "against": ["sekans bilinmiyor"], "citations": ["F2", "S2"]},
            ],
        }
    )
    report = build_draft_report(
        wire, LLMRequest(generation=gen), aliases,
        provider_id="p", model_id="m", model_version="1", prompt_version="v",
    )
    assert report.differentials == []
