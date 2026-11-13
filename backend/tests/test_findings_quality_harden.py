"""Pre-data findings quality: dedupe status, code allowlist, bbox demote, LLM conflicts."""

from __future__ import annotations

from app.llm.interfaces import LLMFindingRef, LLMGenerationInput
from app.llm.prompts import build_aliases, build_system_prompt, build_user_prompt
from app.models.vlm_grounding import SentFrame, evidence_for_frame, harden_finding_fields
from app.models.vlm_vision import _dedupe_findings, _normalize_vlm_code
from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    Modality,
    ModelExecutionStatus,
    Species,
)
from app.schemas.findings import EvidenceReference, Finding


def test_dedupe_keeps_more_uncertain_status() -> None:
    a = Finding(
        finding_id="a",
        finding_code="MASS",
        description="kısa",
        anatomical_location="beyin",
        finding_status=FindingStatus.SUSPECTED,
        source_model="vlm",
    )
    b = Finding(
        finding_id="b",
        finding_code="MASS",
        description="daha uzun belirsiz açıklama",
        anatomical_location="beyin",
        finding_status=FindingStatus.UNCERTAIN,
        source_model="vlm",
        uncertainty_note="sekans yok",
    )
    out = _dedupe_findings([a, b])
    assert len(out) == 1
    assert out[0].finding_status == FindingStatus.UNCERTAIN
    assert "uzun" in out[0].description
    assert out[0].uncertainty_note == "sekans yok"


def test_dedupe_collapses_image_quality_across_locations() -> None:
    a = Finding(
        finding_id="a",
        finding_code="IMAGE-QUALITY",
        description="kalite A",
        anatomical_location="beyin",
        finding_status=FindingStatus.UNCERTAIN,
        source_model="vlm",
        evidence_references=[
            EvidenceReference(evidence_id="e1", description="IMG-1"),
        ],
    )
    b = Finding(
        finding_id="b",
        finding_code="IMAGE-QUALITY",
        description="kalite B daha uzun metin",
        anatomical_location="genel",
        finding_status=FindingStatus.SUSPECTED,
        source_model="vlm",
        evidence_references=[
            EvidenceReference(evidence_id="e2", description="IMG-2"),
        ],
    )
    out = _dedupe_findings([a, b])
    assert len(out) == 1
    assert out[0].finding_status == FindingStatus.UNCERTAIN  # never upgrade
    assert len(out[0].evidence_references) == 2


def test_unknown_code_maps_to_vlm_unspecified() -> None:
    from app.models.ontology import clear_ontology_cache

    clear_ontology_cache()
    code, unknown = _normalize_vlm_code("TOTALLY-MADE-UP-XYZ")
    assert code == "VLM-UNSPECIFIED"
    assert unknown is True
    known, unknown2 = _normalize_vlm_code("VENTRICLE_DILATION")
    assert known == "VENTRICLE-DILATION"
    assert unknown2 is False
    brit, unknown3 = _normalize_vlm_code("VENTRICLE-DILATATION")
    assert brit == "VENTRICLE-DILATION"
    assert unknown3 is False
    brain, unknown4 = _normalize_vlm_code("BRAIN_STRUCTURE")
    assert brain == "BRAIN-STRUCTURE"
    assert unknown4 is False


def test_near_full_bbox_omitted_for_pathology() -> None:
    frame = SentFrame(
        index=1,
        png=b"x",
        sop_instance_uid="1.2.sop",
        series_instance_uid="1.2.series",
        instance_number=1,
        frame_index=0,
        series_description="axial brain",
        is_localizer=False,
        width=256,
        height=256,
        native_width=256,
        native_height=256,
    )
    item = {
        "finding_code": "VENTRICLE-DILATION",
        "bbox_norm": [0.0, 0.0, 1.0, 1.0],
        "source_image_index": 1,
    }
    ref = evidence_for_frame(
        finding_id="f1",
        frame=frame,
        item=item,
        image_count=1,
        finding_code="VENTRICLE-DILATION",
    )
    assert ref.bbox is None
    assert "near-full" in (ref.description or "").lower()


def test_harden_demotes_dilation_when_mr_sequence_unknown() -> None:
    frame = SentFrame(
        index=1,
        png=b"x",
        sop_instance_uid="1",
        series_instance_uid="s",
        instance_number=1,
        frame_index=0,
        series_description="axial brain",
        is_localizer=False,
        width=64,
        height=64,
    )
    hard = harden_finding_fields(
        {
            "finding_code": "VENTRICLE-DILATION",
            "description": "Lateral ventriküllerde belirgin genişleme",
            "finding_status": "possible",
            "source_image_index": 1,
            "bbox_norm": [0.1, 0.1, 0.9, 0.9],
        },
        frame=frame,
        modality="MR",
    )
    assert hard["finding_status"] == "uncertain"
    assert "sekans" in hard["uncertainty_note"].lower()


def test_user_prompt_includes_conflict_notes() -> None:
    gen = LLMGenerationInput(
        case_id="c1",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        findings=[
            LLMFindingRef(
                finding_id="f1",
                finding_code="VENTRICLE-DILATION",
                description="genişleme",
                anatomical_location="lateral",
                finding_status=FindingStatus.POSSIBLE,
                source_model="vlm",
            )
        ],
        execution_status=ModelExecutionStatus.SUCCESS,
        conflict_notes=[
            "OLASI ÇELİŞKİ KORUNDU: zıt kod çiftleri=['VENTRICLE-DILATION↔VENTRICLE-STRUCTURE']"
        ],
    )
    text = build_user_prompt(gen, build_aliases(gen))
    assert "POTENTIAL CONFLICTS" in text
    assert "do not resolve" in text.lower()
    assert "VENTRICLE-DILATION" in text
    system = build_system_prompt("tr")
    assert "POTENTIAL CONFLICTS" in system or "never pick a winner" in system.lower()
