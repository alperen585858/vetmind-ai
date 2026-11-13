"""PDF layout mirrors ApprovedReport page (sections + rapor görselleri)."""

from __future__ import annotations

from datetime import datetime, timezone

from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, ExpertReviewStatus, Modality, ReportStatus, Species
from app.schemas.findings import EVIDENCE_DISCLAIMER
from app.schemas.rag import RagPassage
from app.schemas.report import DraftReport, GenerationMetadata, ReportEvidenceFigure, ReportSection
from app.services.pdf_report import (
    _approver_display,
    _citation_legend_lines,
    _patient_line,
    _species_label,
    build_approved_report_pdf,
)


def _draft(**kwargs) -> DraftReport:
    base = dict(
        report_id="rpt-1",
        case_id="case-pdf-1",
        status=ReportStatus.APPROVED,
        version=1,
        generation=GenerationMetadata(
            provider_id="test",
            model_id="test",
            model_version="0",
            prompt_version="v1",
        ),
        technique=ReportSection(text="Teknik not."),
        findings=ReportSection(text="Şüpheli bulgu [F1]."),
        impression=ReportSection(text="Yorum [F1, S1]."),
        recommendations=ReportSection(text="Öneri."),
        citation_map={"F1": "finding-abc", "S1": "src-1"},
        rag_citations=[
            RagPassage(
                source_id="src-1",
                title="Demo Kaynak",
                section="Bölüm A",
                passage="pasaj",
                score=0.9,
            )
        ],
        expert_review_status=ExpertReviewStatus.APPROVED,
        reviewed_by="expert-demo",
        clinically_validated=False,
        updated_at=datetime.now(timezone.utc),
    )
    base.update(kwargs)
    return DraftReport(**base)


def test_species_and_missing_breed_labels() -> None:
    case = CaseRecord(
        case_id="case-pdf-1",
        patient_name="Pamuk",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        breed=None,
    )
    assert _species_label(case) == "Köpek"
    assert _patient_line(case) == "Pamuk"
    case2 = case.model_copy(update={"breed": "Golden"})
    assert _patient_line(case2) == "Pamuk · Golden"


def test_demo_approver_label() -> None:
    assert "demo" in _approver_display("expert-demo", clinically_validated=False).lower()
    assert "klinik onay değil" in _approver_display("expert-demo", clinically_validated=False)
    assert _approver_display("Dr. Ada", clinically_validated=True) == "Dr. Ada"


def test_citation_legend_lists_used_aliases() -> None:
    lines = _citation_legend_lines(_draft())
    assert any(line.startswith("F1") for line in lines)
    assert any("Demo Kaynak" in line for line in lines)


def test_pdf_matches_approved_report_page(monkeypatch) -> None:
    # Capture Paragraph text (custom TTF embeds glyphs so PDF bytes are not greppable).
    seen: list[str] = []
    real_paragraph = __import__("reportlab.platypus", fromlist=["Paragraph"]).Paragraph

    def _capture(text, style, *args, **kwargs):
        seen.append(str(text))
        return real_paragraph(text, style, *args, **kwargs)

    monkeypatch.setattr("app.services.pdf_report.Paragraph", _capture)
    monkeypatch.setattr("app.services.pdf_report._resolve_font", lambda: "Helvetica")
    case = CaseRecord(
        case_id="case-pdf-1",
        patient_name="Pamuk",
        species=Species.FELINE,
        modality=Modality.XR,
        anatomical_region=AnatomicalRegion.THORAX,
        breed="Tekir",
        referring_clinic="Demo Klinik",
    )
    draft = _draft(
        evidence_figures=[
            ReportEvidenceFigure(
                finding_id="f1",
                evidence_id="ev1",
                origin="ai_proposed",
                overlay_ref="_report_evidence/case-pdf-1/v1/ev1/overlay.png",
                overlay_content_sha256="abc",
                caption="f1: demo",
                disclaimer=EVIDENCE_DISCLAIMER,
            )
        ]
    )
    pdf = build_approved_report_pdf(case, draft)
    assert pdf.startswith(b"%PDF")
    blob = "\n".join(seen)
    assert "Veteriner Radyoloji Değerlendirme Raporu" in blob
    assert "Teknik / Klinik özet" in blob
    assert "Bulgular (Findings)" in blob
    assert "Rapor görselleri" in blob
    assert "Demo Klinik" in blob
    assert "Kedi" in blob
    assert "nihai klinik sorumluluk" in blob
    assert "expert-demo" in blob
    # PDF-only blocks removed for screen parity
    assert "Analiz kapsamı" not in blob
    assert "Atıf açıklaması" not in blob
    assert "Görüntü kanıtı" not in blob
    # Findings text still carries citation aliases in-body
    assert "F1" in blob
    assert "Teknik not." in blob


def test_pdf_skips_empty_sections(monkeypatch) -> None:
    seen: list[str] = []
    real_paragraph = __import__("reportlab.platypus", fromlist=["Paragraph"]).Paragraph

    def _capture(text, style, *args, **kwargs):
        seen.append(str(text))
        return real_paragraph(text, style, *args, **kwargs)

    monkeypatch.setattr("app.services.pdf_report.Paragraph", _capture)
    monkeypatch.setattr("app.services.pdf_report._resolve_font", lambda: "Helvetica")
    case = CaseRecord(
        case_id="case-pdf-2",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
    )
    draft = _draft(recommendations=ReportSection(text="   "))
    build_approved_report_pdf(case, draft)
    blob = "\n".join(seen)
    assert "Öneriler (Recommendations)" not in blob
    assert "Bulgular (Findings)" in blob
