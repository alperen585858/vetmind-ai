"""Server-side PDF generation for immutable approved reports."""

from __future__ import annotations

import struct
import zlib
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
from pydicom import dcmread
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.schemas.case import CaseRecord
from app.schemas.report import DraftReport, ReportVersionSnapshot

_FONT_REGISTERED = False
_FONT_NAME = "Helvetica"
_MAX_REPORT_IMAGES = 4
_IMAGE_MAX_EDGE_PX = 512


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


def _png_gray(arr_u8: np.ndarray) -> bytes:
    """Encode a 2D uint8 array as a grayscale PNG (no Pillow dependency)."""
    height, width = arr_u8.shape
    raw = b"".join(b"\x00" + arr_u8[y].tobytes() for y in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", ihdr),
            chunk(b"IDAT", zlib.compress(raw, 9)),
            chunk(b"IEND", b""),
        ]
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


def _window_to_u8(pixels: np.ndarray) -> np.ndarray:
    flat = np.asarray(pixels, dtype=np.float64)
    while flat.ndim > 2:
        flat = flat[flat.shape[0] // 2]
    if flat.ndim != 2:
        raise ValueError("Expected 2D image")
    lo, hi = np.percentile(flat, [1, 99])
    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        lo, hi = float(np.min(flat)), float(np.max(flat))
    if hi <= lo:
        return np.zeros_like(flat, dtype=np.uint8)
    scaled = np.clip((flat - lo) / (hi - lo), 0, 1)
    return (scaled * 255.0).astype(np.uint8)


def _resize_max_edge(arr: np.ndarray, max_edge: int = _IMAGE_MAX_EDGE_PX) -> np.ndarray:
    h, w = arr.shape
    edge = max(h, w)
    if edge <= max_edge:
        return arr
    scale = max_edge / float(edge)
    nh, nw = max(1, int(round(h * scale))), max(1, int(round(w * scale)))
    ys = (np.linspace(0, h - 1, nh)).astype(np.int32)
    xs = (np.linspace(0, w - 1, nw)).astype(np.int32)
    return arr[ys][:, xs]


def _dicom_bytes_to_png(data: bytes) -> bytes | None:
    try:
        ds = dcmread(BytesIO(data), force=True)
        if not hasattr(ds, "PixelData") and not hasattr(ds, "FloatPixelData"):
            return None
        raw = np.asarray(ds.pixel_array)
        u8 = _window_to_u8(raw)
        photo = str(getattr(ds, "PhotometricInterpretation", "MONOCHROME2") or "MONOCHROME2")
        if photo.upper() == "MONOCHROME1":
            u8 = 255 - u8
        u8 = _resize_max_edge(u8)
        return _png_gray(u8)
    except Exception:
        return None


def _sample_items[T](items: list[T], limit: int = _MAX_REPORT_IMAGES) -> list[T]:
    if len(items) <= limit:
        return items
    if limit == 1:
        return [items[len(items) // 2]]
    idxs = [int(round(i * (len(items) - 1) / (limit - 1))) for i in range(limit)]
    return [items[i] for i in idxs]


def _is_raster_bytes(data: bytes) -> bool:
    return data[:8] == b"\x89PNG\r\n\x1a\n" or data[:2] == b"\xff\xd8"


def collect_report_image_pngs(
    case: CaseRecord,
    quarantine: Any | None,
    *,
    max_images: int = _MAX_REPORT_IMAGES,
) -> list[tuple[str, bytes]]:
    """Load representative study / upload images for the clinical PDF."""
    if quarantine is None:
        return []

    dicom_candidates: list[tuple[str, str]] = []
    if case.dicom_study is not None:
        for series_i, series in enumerate(case.dicom_study.series or []):
            series_label = series.series_description or f"Seri {series.series_number or series_i + 1}"
            for inst in series.instances or []:
                rel = inst.quarantine_relative_path
                if not rel:
                    continue
                if inst.has_pixel_data is False:
                    continue
                label = series_label
                if inst.instance_number is not None:
                    label = f"{series_label} · #{inst.instance_number}"
                dicom_candidates.append((label, rel))

    out: list[tuple[str, bytes]] = []
    for label, rel in _sample_items(dicom_candidates, max_images):
        try:
            _name, data = quarantine.read_file(rel)
        except Exception:
            continue
        png = _dicom_bytes_to_png(data)
        if png:
            out.append((label, png))

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
        spaceBefore=12,
        spaceAfter=4,
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

    species = str(case.species.value if hasattr(case.species, "value") else case.species)
    info = [
        ["Hasta", f"{case.patient_name}" + (f" · {case.breed}" if case.breed else "")],
        ["Tür", species],
        ["Modalite / Bölge", f"{case.modality.value} · {case.anatomical_region.value}"],
        ["Rapor No", report_no],
        ["Vaka No", case.case_id.replace("case-", "VM-").upper()],
        ["Onaylayan", reviewed_by or "—"],
        ["Onay tarihi", approved_at.strftime("%d.%m.%Y %H:%M") if approved_at else "—"],
    ]
    table = Table(info, colWidths=[38 * mm, 132 * mm])
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), font),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#64748b")),
                ("TEXTCOLOR", (1, 0), (1, -1), colors.HexColor("#0f172a")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#e2e8f0")),
            ]
        )
    )
    story.append(table)
    story.append(Spacer(1, 6))

    images = collect_report_image_pngs(case, quarantine)
    if images:
        story.append(Paragraph("Görüntüler", h2))
        flowables: list[tuple[Image, Paragraph]] = []
        for label, png in images:
            img = _image_flowable(png)
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
                story.append(chunk[0][0])
                story.append(Spacer(1, 2))
                story.append(chunk[0][1])
            story.append(Spacer(1, 6))

    sections = [
        ("Teknik", content.technique.text),
        ("Bulgular", content.findings.text),
        ("Yorum / Değerlendirme", content.impression.text),
        ("Öneriler", content.recommendations.text),
    ]
    for label, text in sections:
        story.append(Paragraph(label, h2))
        story.append(Paragraph(_esc(text).replace("\n", "<br/>") or "—", body))

    story.append(Spacer(1, 16))
    sign = Table(
        [
            [
                Paragraph(f"<b>Onaylayan uzman</b><br/>{_esc(reviewed_by or '—')}", body),
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
    story.append(Spacer(1, 14))
    story.append(
        Paragraph(
            "VRM Görüntüleme ve Veteriner Sağlık Hizmetleri Tic. A.Ş. işbirliğiyle",
            collab,
        )
    )

    doc.build(story)
    return buf.getvalue()
