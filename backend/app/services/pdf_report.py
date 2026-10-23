"""Server-side PDF generation for immutable approved reports."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.schemas.case import CaseRecord
from app.schemas.report import DraftReport, ReportVersionSnapshot

_FONT_REGISTERED = False
_FONT_NAME = "Helvetica"


def _resolve_font() -> str:
    global _FONT_REGISTERED, _FONT_NAME
    if _FONT_REGISTERED:
        return _FONT_NAME
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        Path("/Library/Fonts/Arial Unicode.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
        Path(__file__).resolve().parent.parent / "assets" / "DejaVuSans.ttf",
    ]
    for path in candidates:
        if path.is_file():
            try:
                pdfmetrics.registerFont(TTFont("VetMindSans", str(path)))
                _FONT_NAME = "VetMindSans"
                _FONT_REGISTERED = True
                return _FONT_NAME
            except Exception:
                continue
    _FONT_REGISTERED = True
    _FONT_NAME = "Helvetica"
    return _FONT_NAME


def _esc(text: str) -> str:
    return (
        (text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def build_approved_report_pdf(
    case: CaseRecord,
    report: DraftReport | ReportVersionSnapshot,
) -> bytes:
    """Build a PDF bytes blob from an approved/immutable report snapshot."""
    font = _resolve_font()
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=f"VetMind Rapor {case.case_id}",
    )
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "T",
        parent=styles["Heading1"],
        fontName=font,
        fontSize=14,
        alignment=TA_CENTER,
        spaceAfter=8,
    )
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName=font, fontSize=11, spaceBefore=10, spaceAfter=4)
    body = ParagraphStyle("B", parent=styles["Normal"], fontName=font, fontSize=9.5, leading=13, alignment=TA_LEFT)
    meta = ParagraphStyle("M", parent=styles["Normal"], fontName=font, fontSize=8.5, textColor=colors.HexColor("#334155"))

    if isinstance(report, ReportVersionSnapshot):
        content = report.content
        version = report.version
        reviewed_by = report.reviewed_by or content.reviewed_by
        approved_at = report.updated_at or report.created_at
    else:
        content = report
        version = report.version
        reviewed_by = report.reviewed_by
        approved_at = report.updated_at

    story: list = [
        Paragraph("VetMind AI — Radyoloji Raporu", title),
        Paragraph("Uzman onaylı · değişmez sürüm · klinik karar destek çıktısı değildir", meta),
        Spacer(1, 6),
    ]

    info = [
        ["Vaka", case.case_id],
        ["Hasta", f"{case.patient_name} · {case.species}" + (f" · {case.breed}" if case.breed else "")],
        ["Klinik", case.referring_clinic or case.clinic_id or "—"],
        ["Sahip", case.pet_owner_subject or case.owner_subject or "—"],
        ["Modalite / Bölge", f"{case.modality.value} · {case.anatomical_region.value}"],
        ["Rapor sürümü", str(version)],
        ["Onaylayan", reviewed_by or "—"],
        ["Onay tarihi", approved_at.isoformat() if approved_at else "—"],
    ]
    table = Table(info, colWidths=[35 * mm, 135 * mm])
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), font),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#64748b")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    story.append(table)
    story.append(Spacer(1, 8))

    sections = [
        ("Teknik / Klinik özet", content.technique.text),
        ("Bulgular", content.findings.text),
        ("Yorum / Değerlendirme", content.impression.text),
        ("Öneriler", content.recommendations.text),
    ]
    for label, text in sections:
        story.append(Paragraph(label, h2))
        story.append(Paragraph(_esc(text).replace("\n", "<br/>") or "—", body))

    story.append(Spacer(1, 14))
    story.append(
        Paragraph(
            "Bu belge yalnızca onaylanmış değişmez rapor sürümünden üretilmiştir. "
            "Veteriner hekim yerini almaz.",
            meta,
        )
    )
    doc.build(story)
    return buf.getvalue()
