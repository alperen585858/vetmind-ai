"""Server-side PDF generation for immutable approved reports."""

from __future__ import annotations

import hashlib
import re
import struct
from io import BytesIO
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.dicom.classifier import REGION_TR, SPECIES_TR
from app.imaging.display_png import dicom_bytes_to_png, evenly_sample, is_localizer_label
from app.models.evidence_store import normalize_ref
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Species
from app.schemas.report import DraftReport, ReportVersionSnapshot

_FONT_REGISTERED = False
_FONT_NAME = "Helvetica"
_MAX_REPORT_IMAGES = 4
_IMAGE_MAX_EDGE_PX = 512
_CITATION_ALIAS_RE = re.compile(r"\b([FS]\d+)\b")


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


def _png_size(data: bytes) -> tuple[int, int] | None:
    if data[:8] != b"\x89PNG\r\n\x1a\n" or len(data) < 24:
        return None
    width, height = struct.unpack(">II", data[16:24])
    if width <= 0 or height <= 0:
        return None
    return int(width), int(height)


def _jpeg_size(data: bytes) -> tuple[int, int] | None:
    if data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 9 < len(data):
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        if marker in (0xD8, 0xD9):
            i += 2
            continue
        if i + 4 > len(data):
            return None
        seglen = struct.unpack(">H", data[i + 2 : i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            if i + 9 >= len(data):
                return None
            height, width = struct.unpack(">HH", data[i + 5 : i + 9])
            return int(width), int(height)
        i += 2 + seglen
    return None


def _image_flowable(data: bytes, max_edge_mm: float = 78) -> Image | None:
    """Build a ReportLab Image with explicit display size."""
    size = _png_size(data) or _jpeg_size(data)
    if not size:
        return None
    width_px, height_px = size
    max_pt = max_edge_mm * mm
    scale = min(max_pt / float(width_px), max_pt / float(height_px))
    w, h = width_px * scale, height_px * scale
    img = Image(BytesIO(data), width=w, height=h)
    img.drawWidth = w
    img.drawHeight = h
    img._restrictSize(w, h)
    img.hAlign = "CENTER"
    return img


def _sample_items[T](items: list[T], limit: int = _MAX_REPORT_IMAGES) -> list[T]:
    return evenly_sample(items, limit)


def _is_raster_bytes(data: bytes) -> bool:
    return data[:8] == b"\x89PNG\r\n\x1a\n" or data[:2] == b"\xff\xd8"


def _species_label(case: CaseRecord) -> str:
    raw = case.species
    try:
        sp = raw if isinstance(raw, Species) else Species(str(raw).strip().lower())
        return SPECIES_TR.get(sp, str(getattr(raw, "value", raw)))
    except Exception:
        return str(getattr(raw, "value", raw))


def _region_label(case: CaseRecord) -> str:
    raw = case.anatomical_region
    try:
        reg = raw if isinstance(raw, AnatomicalRegion) else AnatomicalRegion(str(raw).strip().lower())
        return REGION_TR.get(reg, str(getattr(raw, "value", raw)))
    except Exception:
        return str(getattr(raw, "value", raw))


def _patient_line(case: CaseRecord) -> str:
    breed = (case.breed or "").strip()
    if breed:
        return f"{case.patient_name} · {breed}"
    return case.patient_name or "—"


def _is_demo_approver(reviewed_by: str | None, *, clinically_validated: bool) -> bool:
    if clinically_validated:
        return False
    name = (reviewed_by or "").strip().lower()
    if not name:
        return True
    return any(tok in name for tok in ("demo", "seed", "test", "mock", "local"))


def _approver_display(reviewed_by: str | None, *, clinically_validated: bool) -> str:
    name = (reviewed_by or "").strip() or "—"
    if _is_demo_approver(reviewed_by, clinically_validated=clinically_validated):
        return f"{name} (demo / klinik onay değil)"
    return name


def _citation_legend_lines(content: DraftReport | Any) -> list[str]:
    """Human-readable legend for F#/S# markers printed in the PDF body."""
    citation_map = getattr(content, "citation_map", None) or {}
    if not citation_map:
        return []
    sections = [
        getattr(getattr(content, "technique", None), "text", "") or "",
        getattr(getattr(content, "findings", None), "text", "") or "",
        getattr(getattr(content, "impression", None), "text", "") or "",
        getattr(getattr(content, "recommendations", None), "text", "") or "",
    ]
    used = list(dict.fromkeys(_CITATION_ALIAS_RE.findall("\n".join(sections))))
    if not used:
        used = sorted(citation_map.keys(), key=lambda a: (a[0], int(a[1:] or 0)))
    rag = {p.source_id: p for p in (getattr(content, "rag_citations", None) or [])}
    lines: list[str] = []
    for alias in used:
        ref = citation_map.get(alias)
        if not ref:
            continue
        if alias.startswith("F"):
            lines.append(f"{alias} → görüntüleme bulgusu ({ref})")
        else:
            src = rag.get(ref)
            if src is not None:
                lines.append(f"{alias} → {src.title} — {src.section}")
            else:
                lines.append(f"{alias} → kaynak ({ref})")
    return lines


def collect_report_image_pngs(
    case: CaseRecord,
    quarantine: Any | None,
    *,
    max_images: int = _MAX_REPORT_IMAGES,
) -> list[tuple[str, bytes]]:
    """Load representative study / upload images for the clinical PDF."""
    if quarantine is None:
        return []

    non_loc: list[tuple[str, str]] = []
    loc: list[tuple[str, str]] = []
    if case.dicom_study is not None:
        for series_i, series in enumerate(case.dicom_study.series or []):
            series_label = series.series_description or f"Seri {series.series_number or series_i + 1}"
            is_loc = is_localizer_label(series_label)
            for inst in series.instances or []:
                rel = inst.quarantine_relative_path
                if not rel:
                    continue
                if inst.has_pixel_data is False:
                    continue
                label = series_label
                if inst.instance_number is not None:
                    label = f"{series_label} · #{inst.instance_number}"
                bucket = loc if is_loc else non_loc
                bucket.append((label, rel))

    # If the study tree was truncated (e.g. historical colliding-SOP drop), also
    # sample from the linked quarantine ingest so the PDF still shows volume context.
    seen_rels = {rel for _label, rel in non_loc + loc}
    ingest_id = getattr(case, "dicom_ingest_id", None)
    if ingest_id and hasattr(quarantine, "list_files"):
        try:
            refs = quarantine.list_files(str(ingest_id))
        except Exception:
            refs = []
        for ref in refs:
            rel = getattr(ref, "relative_path", None) or ""
            if not rel or rel in seen_rels:
                continue
            name = getattr(ref, "original_filename", None) or Path(rel).name
            lower = name.lower()
            if lower.endswith((".json", ".txt", ".xml")):
                continue
            is_loc = is_localizer_label(None, name)
            bucket = loc if is_loc else non_loc
            bucket.append((name, rel))
            seen_rels.add(rel)

    primary = non_loc or loc
    out: list[tuple[str, bytes]] = []
    for label, rel in _sample_items(primary, max_images):
        try:
            _name, data = quarantine.read_file(rel)
        except Exception:
            continue
        result = dicom_bytes_to_png(data, max_edge=_IMAGE_MAX_EDGE_PX, as_rgb=False)
        if result:
            out.append((label, result.png_bytes))

    if out:
        return out

    # Fallback: JPG/PNG uploads attached to the case (multimodal path).
    docs = (case.document_context.documents if case.document_context else None) or []
    raster_docs = [
        d
        for d in docs
        if d.quarantine_relative_path
        and str(getattr(d.content_kind, "value", d.content_kind)).lower() in {"jpeg", "jpg", "png"}
    ]
    for doc in _sample_items(raster_docs, max_images):
        try:
            _name, data = quarantine.read_file(doc.quarantine_relative_path)
        except Exception:
            continue
        if not _is_raster_bytes(data):
            continue
        out.append((doc.filename or "Görüntü", data))
    return out


def build_approved_report_pdf(
    case: CaseRecord,
    report: DraftReport | ReportVersionSnapshot,
    *,
    quarantine: Any | None = None,
    evidence_root: Path | None = None,
) -> bytes:
    """Build a PDF that reads like a clinical radiology report, with study images when available."""
    font = _resolve_font()
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title=f"Radyoloji Raporu — {case.patient_name}",
    )
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "T",
        parent=styles["Heading1"],
        fontName=font,
        fontSize=15,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=4,
    )
    clinic = ParagraphStyle(
        "Clinic",
        parent=styles["Normal"],
        fontName=font,
        fontSize=9,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#475569"),
        spaceAfter=10,
    )
    h2 = ParagraphStyle(
        "H2",
        parent=styles["Heading2"],
        fontName=font,
        fontSize=11,
        textColor=colors.HexColor("#0f766e"),
        spaceBefore=6,
        spaceAfter=3,
    )
    body = ParagraphStyle("B", parent=styles["Normal"], fontName=font, fontSize=10, leading=14, alignment=TA_LEFT)
    caption = ParagraphStyle("Cap", parent=styles["Normal"], fontName=font, fontSize=8, alignment=TA_CENTER, textColor=colors.HexColor("#64748b"))

    if isinstance(report, ReportVersionSnapshot):
        content = report.content
        reviewed_by = report.reviewed_by or content.reviewed_by
        approved_at = report.updated_at or report.created_at
        report_no = f"{case.case_id.replace('case-', 'VMR-').upper()}"
    else:
        content = report
        reviewed_by = report.reviewed_by
        approved_at = report.updated_at
        report_no = f"{case.case_id.replace('case-', 'VMR-').upper()}"

    referring = case.referring_clinic or case.clinic_id or "Veteriner Radyoloji"
    story: list = [
        Paragraph("Veteriner Radyoloji Değerlendirme Raporu", title),
        Paragraph(_esc(referring), clinic),
    ]

    clinically_validated = bool(getattr(content, "clinically_validated", False))
    approver = _approver_display(reviewed_by, clinically_validated=clinically_validated)
    meta_label = ParagraphStyle(
        "MetaLabel",
        parent=styles["Normal"],
        fontName=font,
        fontSize=9,
        textColor=colors.HexColor("#64748b"),
        leading=12,
    )
    meta_value = ParagraphStyle(
        "MetaValue",
        parent=styles["Normal"],
        fontName=font,
        fontSize=9,
        textColor=colors.HexColor("#0f172a"),
        leading=12,
    )
    info_rows = [
        ["Hasta", _patient_line(case)],
        ["Tür", _species_label(case)],
        ["Modalite / Bölge", f"{case.modality.value} · {_region_label(case)}"],
        ["Rapor No", report_no],
        ["Vaka No", case.case_id.replace("case-", "VM-").upper()],
        ["Onaylayan", approver],
        ["Onay tarihi", approved_at.strftime("%d.%m.%Y %H:%M") if approved_at else "—"],
    ]
    info = [
        [Paragraph(_esc(label), meta_label), Paragraph(_esc(value), meta_value)]
        for label, value in info_rows
    ]
    table = Table(info, colWidths=[38 * mm, 132 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#e2e8f0")),
            ]
        )
    )
    story.append(table)
    story.append(Spacer(1, 4))

    coverage = getattr(getattr(case, "structured_findings", None), "analysis_coverage", None)
    if coverage is not None:
        if hasattr(coverage, "finalize"):
            coverage = coverage.finalize()
        if hasattr(coverage, "summary_lines_tr"):
            cov_lines = list(coverage.summary_lines_tr())
        else:
            cov_lines = [
                (
                    f"tespit {getattr(coverage, 'frames_detected', 0)} · "
                    f"decode {getattr(coverage, 'frames_decoded', 0)} · "
                    f"görsel analiz {getattr(coverage, 'frames_visually_analyzed', 0)}"
                )
            ]
        skipped_files = list(getattr(coverage, "skipped_files", None) or [])
        if skipped_files:
            sample = "; ".join(
                f"{getattr(s, 'path', s)} ({getattr(s, 'reason', '')})"
                for s in skipped_files[:5]
            )
            cov_lines.append(f"Atlanan dosyalar: {sample}")
        story.append(Paragraph("Analiz kapsamı", h2))
        story.append(
            Paragraph(
                "<br/>".join(_esc(line) for line in cov_lines),
                body,
            )
        )
        story.append(Spacer(1, 4))

    images = collect_report_image_pngs(case, quarantine)
    if images:
        story.append(Paragraph("Görüntüler", h2))
        flowables: list[tuple[Image, Paragraph]] = []
        for label, png in images:
            img = _image_flowable(png, max_edge_mm=64)
            if img is None:
                continue
            flowables.append((img, Paragraph(_esc(label), caption)))
        for i in range(0, len(flowables), 2):
            chunk = flowables[i : i + 2]
            if len(chunk) == 2:
                story.append(
                    Table(
                        [[chunk[0][0], chunk[1][0]], [chunk[0][1], chunk[1][1]]],
                        colWidths=[85 * mm, 85 * mm],
                    )
                )
            else:
                story.append(
                    KeepTogether([chunk[0][0], Spacer(1, 2), chunk[0][1]])
                )
            story.append(Spacer(1, 3))

    sections = [
        ("Teknik", content.technique.text),
        ("Bulgular", content.findings.text),
        ("Yorum / Değerlendirme", content.impression.text),
        ("Öneriler", content.recommendations.text),
    ]
    for label, text in sections:
        body_para = Paragraph(_esc(text).replace("\n", "<br/>") or "—", body)
        # Keep heading with body only when short — long KeepTogether causes large page gaps.
        if len(text or "") < 700:
            story.append(KeepTogether([Paragraph(label, h2), body_para]))
        else:
            story.append(Paragraph(label, h2))
            story.append(body_para)

    legend = _citation_legend_lines(content)
    if legend:
        story.append(Paragraph("Atıf açıklaması (F# / S#)", h2))
        story.append(
            Paragraph(
                _esc(
                    "Rapor metnindeki [F#] görüntüleme bulgularına, [S#] literatür pasajlarına "
                    "atıftır. Bunlar kesin tanı değildir."
                ),
                caption,
            )
        )
        story.append(Paragraph("<br/>".join(_esc(line) for line in legend), body))

    # Immutable AI / vet evidence figures (only those frozen into the report package).
    figures = list(getattr(content, "evidence_figures", None) or [])
    if figures:
        story.append(Paragraph("Görüntü kanıtı (AI önerisi)", h2))
        story.append(
            Paragraph(
                _esc(
                    "Uzman radyoloğun seçtiği yerelleştirme katmanları. "
                    "Destekleyici kanıttır; kesin tanı değildir. "
                    "AI işaretleri radyolog onayına kadar şüpheli kabul edilir."
                ),
                caption,
            )
        )
        root = evidence_root
        if root is None and quarantine is not None:
            root = quarantine.root
        for fig in figures[:8]:
            fig_bits: list = []
            png: bytes | None = None
            if root is not None and fig.overlay_ref:
                try:
                    path = (Path(root) / normalize_ref(fig.overlay_ref)).resolve()
                    path.relative_to(Path(root).resolve())
                    if path.is_file():
                        png = path.read_bytes()
                except (ValueError, OSError):
                    png = None
            tampered = bool(
                png
                and fig.overlay_content_sha256
                and hashlib.sha256(png).hexdigest() != fig.overlay_content_sha256
            )
            if tampered:
                # The frozen figure no longer matches what the radiologist approved.
                png = None
                fig_bits.append(
                    Paragraph(_esc("Kanıt görseli bütünlük kontrolünden geçmedi; gösterilmiyor."), caption)
                )
            if png:
                img = _image_flowable(png)
                if img is not None:
                    fig_bits.append(img)
            fig_bits.append(Paragraph(_esc(fig.caption or fig.evidence_id), caption))
            fig_bits.append(Paragraph(_esc(fig.disclaimer), caption))
            fig_bits.append(Spacer(1, 4))
            story.append(KeepTogether(fig_bits))

    story.append(Spacer(1, 8))
    sign = Table(
        [
            [
                Paragraph(f"<b>Onaylayan uzman</b><br/>{_esc(approver)}", body),
                Paragraph(
                    f"<b>Onay tarihi</b><br/>{_esc(approved_at.strftime('%d.%m.%Y %H:%M') if approved_at else '—')}",
                    ParagraphStyle("Right", parent=body, alignment=TA_RIGHT),
                ),
            ]
        ],
        colWidths=[90 * mm, 80 * mm],
    )
    sign.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEABOVE", (0, 0), (-1, 0), 1, colors.HexColor("#0f766e")),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(sign)

    collab = ParagraphStyle(
        "Collab",
        parent=styles["Normal"],
        fontName=font,
        fontSize=7.5,
        alignment=TA_LEFT,
        textColor=colors.HexColor("#64748b"),
        spaceBefore=2,
    )
    story.append(Spacer(1, 6))
    story.append(
        Paragraph(
            "VRM Görüntüleme ve Veteriner Sağlık Hizmetleri Tic. A.Ş. işbirliğiyle",
            collab,
        )
    )

    doc.build(story)
    return buf.getvalue()
