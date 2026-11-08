"""Ground VLM findings to the exact PNG frames that were sent.

Does not claim clinical validation — only engineering traceability so a radiologist
can open the cited SOP/instance/frame (and optional bbox) and check the claim.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Sequence

from app.schemas.findings import BoundingBoxEvidence, EvidenceReference

_MR_SEQ_TOKENS = (
    "T1",
    "T2",
    "FLAIR",
    "STIR",
    "DWI",
    "ADC",
    "PD ",
    "PD-",
    "GRE",
    "SWI",
    "TOF",
    "FIESTA",
    "CISS",
    "HASTE",
    "BLADE",
    "PROPELLER",
    "FAT SAT",
    "FATSAT",
    "POST CONTRAST",
    "POSTGAD",
    "GAD ",
    " CONTRAST",
)

_SIGNAL_WORDS = re.compile(
    r"\b(hiperintens|hipointens|hyperintens|hypointens|hyperintense|hypointense|"
    r"t2[\s-]*hiper|t1[\s-]*hipo|bright signal|dark signal)\w*\b",
    re.IGNORECASE,
)

_LESION_CODES = re.compile(
    r"(MASS|LESION|TUMOR|TUMOUR|HEMOR|HAEMOR|EDEMA|OEDEMA|INFARCT|HERNIA|"
    r"FRACTURE|LUXAT|METAST|NODULE|CYST|ABSCESS)",
    re.IGNORECASE,
)

_ENGLISH_SYSTEM_NOISE = re.compile(
    r"(?im)^\s*(execution_status|source_kind|adapter|chat_model_id|timeout_s|"
    r"images_sent|empty_findings_synthesized|processing_metadata)\s*[:=].*$"
)

_REPEATED_WS = re.compile(r"[ \t]{2,}")
_MULTI_BLANK = re.compile(r"\n{3,}")


@dataclass(frozen=True)
class SentFrame:
    """One PNG actually POSTed to the multimodal API (1-based index in catalog)."""

    index: int
    png: bytes
    sop_instance_uid: str | None
    series_instance_uid: str | None
    instance_number: int | None
    frame_index: int
    series_description: str | None
    is_localizer: bool
    width: int | None = None
    height: int | None = None
    native_width: int | None = None
    native_height: int | None = None
    quarantine_rel: str | None = None
    series_number: int | None = None


def mr_sequence_known(series_description: str | None) -> bool:
    text = (series_description or "").upper()
    if not text.strip():
        return False
    return any(tok in text for tok in _MR_SEQ_TOKENS)


def format_image_catalog(frames: Sequence[SentFrame]) -> str:
    """Human/VLM-readable list of what was attached (IMG-1 …)."""
    lines = [f"IMAGE CATALOG ({len(frames)} frame(s) attached; cite source_image_index):"]
    for fr in frames:
        seq = (fr.series_description or "").strip() or "(series description unknown)"
        seq_flag = "sequence_known=yes" if mr_sequence_known(fr.series_description) else "sequence_known=no"
        sn = f"#{fr.series_number}" if fr.series_number is not None else "—"
        lines.append(
            f"IMG-{fr.index}: series_number={sn} series={seq!r} | series_uid={fr.series_instance_uid or '—'} | "
            f"sop={fr.sop_instance_uid or '—'} | instance_number={fr.instance_number if fr.instance_number is not None else '—'} | "
            f"frame_index={fr.frame_index} | localizer={'yes' if fr.is_localizer else 'no'} | {seq_flag}"
        )
    return "\n".join(lines)


def catalog_metadata(frames: Sequence[SentFrame]) -> dict[str, str]:
    rows = []
    for fr in frames:
        rows.append(
            {
                "img": fr.index,
                "series_uid": fr.series_instance_uid,
                "sop": fr.sop_instance_uid,
                "instance_number": fr.instance_number,
                "frame_index": fr.frame_index,
                "series_description": fr.series_description,
                "series_number": fr.series_number,
                "localizer": fr.is_localizer,
                "sequence_known": mr_sequence_known(fr.series_description),
                "w": fr.width,
                "h": fr.height,
            }
        )
    return {
        "images_sent": str(len(frames)),
        "sent_image_catalog_json": json.dumps(rows, ensure_ascii=False)[:8000],
        "sent_sop_frames": ",".join(
            f"{(fr.sop_instance_uid or 'unknown')}#f{fr.frame_index}" for fr in frames
        )[:2000],
        "localizer_frames_sent": str(sum(1 for fr in frames if fr.is_localizer)),
        "non_localizer_frames_sent": str(sum(1 for fr in frames if not fr.is_localizer)),
        "sequence_known_frames": str(sum(1 for fr in frames if mr_sequence_known(fr.series_description))),
    }


def study_inventory_metadata(
    *,
    candidate_count: int,
    localizer_candidates: int,
    non_localizer_candidates: int,
    dicom_instance_count: int | None,
) -> dict[str, str]:
    return {
        "study_dicom_instances": str(dicom_instance_count if dicom_instance_count is not None else ""),
        "vlm_candidate_files": str(candidate_count),
        "vlm_localizer_candidates": str(localizer_candidates),
        "vlm_non_localizer_candidates": str(non_localizer_candidates),
    }


def _parse_bbox_norm(
    raw: Any,
    *,
    width: int | None,
    height: int | None,
    native_width: int | None = None,
    native_height: int | None = None,
) -> BoundingBoxEvidence | None:
    """Parse VLM bbox in PNG space and map to verified native DICOM pixels.

    Returns None when transform cannot be verified — callers must not overlay.
    """
    if raw is None or width is None or height is None or width <= 0 or height <= 0:
        return None
    vals: list[float]
    if isinstance(raw, dict):
        keys = ("x_min", "y_min", "x_max", "y_max")
        if not all(k in raw for k in keys):
            return None
        vals = [float(raw[k]) for k in keys]
    elif isinstance(raw, (list, tuple)) and len(raw) == 4:
        vals = [float(x) for x in raw]
    else:
        return None
    # Accept either normalized 0–1 or pixel coords on the sent PNG.
    if all(0.0 <= v <= 1.0 for v in vals):
        x0, y0, x1, y1 = vals[0] * width, vals[1] * height, vals[2] * width, vals[3] * height
    else:
        x0, y0, x1, y1 = vals
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    # Ignore tiny / empty boxes.
    if (x1 - x0) < 2 or (y1 - y0) < 2:
        return None
    from app.imaging.vlm_display_transform import native_bbox_from_vlm_png, should_draw_overlay

    nw = native_width if native_width is not None else width
    nh = native_height if native_height is not None else height
    verified = native_bbox_from_vlm_png(
        x_min=x0,
        y_min=y0,
        x_max=x1,
        y_max=y1,
        native_width=nw,
        native_height=nh,
        png_width=width,
        png_height=height,
    )
    if not should_draw_overlay(verified):
        return None
    assert verified is not None
    return verified.bbox


def resolve_source_frame(item: dict[str, Any], frames: Sequence[SentFrame]) -> SentFrame | None:
    if not frames:
        return None
    raw = item.get("source_image_index", item.get("image_index", item.get("img_index")))
    if raw is None:
        return None
    try:
        idx = int(raw)
    except (TypeError, ValueError):
        return None
    # Accept 1-based IMG-n (preferred) or 0-based.
    if idx <= 0:
        return None
    if idx <= len(frames) and frames[idx - 1].index == idx:
        return frames[idx - 1]
    for fr in frames:
        if fr.index == idx:
            return fr
    if 0 <= idx < len(frames):
        return frames[idx]
    return None


def evidence_for_frame(
    *,
    finding_id: str,
    frame: SentFrame | None,
    item: dict[str, Any],
    image_count: int,
) -> EvidenceReference:
    if frame is None:
        return EvidenceReference(
            evidence_id=f"{finding_id}-ev-ungrounded",
            description=(
                f"VLM {image_count} kareye baktı ancak bu bulguya geçerli "
                f"source_image_index bağlamadı — radyolog doğrulaması zorunlu."
            ),
            evidence_type="overlay",
            note="Ungrounded VLM claim: no verified IMG index.",
        )
    bbox = _parse_bbox_norm(
        item.get("bbox_norm") or item.get("bbox"),
        width=frame.width,
        height=frame.height,
        native_width=frame.native_width,
        native_height=frame.native_height,
    )
    desc_bits = [
        f"IMG-{frame.index}",
    ]
    if frame.series_number is not None:
        desc_bits.append(f"seri_no=#{frame.series_number}")
    desc_bits.extend(
        [
            f"seri={frame.series_description or '—'}",
            f"SOP={frame.sop_instance_uid or '—'}",
        ]
    )
    if frame.instance_number is not None:
        desc_bits.append(f"instance=#{frame.instance_number}")
    desc_bits.append(f"frame_index={frame.frame_index}")
    if bbox is not None:
        desc_bits.append(
            f"bbox=({bbox.x_min:.0f},{bbox.y_min:.0f})-({bbox.x_max:.0f},{bbox.y_max:.0f}) native-px"
        )
    elif item.get("bbox_norm") or item.get("bbox"):
        desc_bits.append("bbox omitted (transform unverified — no overlay)")
    return EvidenceReference(
        evidence_id=f"{finding_id}-ev-1",
        description="; ".join(desc_bits),
        evidence_type="overlay",
        series_hint=(
            f"#{frame.series_number} {frame.series_description}".strip()
            if frame.series_number is not None
            else frame.series_description
        ),
        series_instance_uid=frame.series_instance_uid,
        sop_instance_uid=frame.sop_instance_uid,
        frame_index=frame.frame_index,
        instance_number=frame.instance_number,
        bbox=bbox,
        note=(
            "AI-proposed localization mapped to native DICOM pixels via verified "
            "PNG↔DICOM transform. Not radiologist-confirmed. No overlay when unverified."
        ),
    )


def evidence_locus_summary(ref: EvidenceReference) -> str:
    parts = []
    if ref.series_hint:
        parts.append(ref.series_hint)
    if ref.instance_number is not None:
        parts.append(f"kesit/instance #{ref.instance_number}")
    if ref.frame_index is not None:
        parts.append(f"frame {ref.frame_index}")
    if ref.sop_instance_uid:
        parts.append(f"SOP …{ref.sop_instance_uid[-12:]}")
    if ref.bbox is not None:
        parts.append("bbox var")
    return ", ".join(parts) if parts else (ref.description or "kanıt yok")


def harden_finding_fields(
    item: dict[str, Any],
    *,
    frame: SentFrame | None,
    modality: str,
) -> dict[str, Any]:
    """Demote unverifiable / sequence-blind signal claims. Mutates a shallow copy."""
    out = dict(item)
    code = str(out.get("finding_code") or "").strip()
    desc = str(out.get("description") or "").strip()
    status = str(out.get("finding_status") or "uncertain").strip().lower()
    note = str(out.get("uncertainty_note") or "").strip()

    if frame is None and _LESION_CODES.search(code):
        out["finding_status"] = "uncertain"
        out["uncertainty_note"] = (
            (note + " " if note else "")
            + "Geçerli source_image_index yok; lezyon iddiası doğrulanamadı."
        ).strip()
        if not desc.lower().startswith("doğrulanamayan"):
            out["description"] = (
                f"Doğrulanamayan model iddiası (görüntü indeksi yok): {desc}"
                if desc
                else "Doğrulanamayan model iddiası; görüntü indeksi yok."
            )

    if modality.upper() in {"MR", "MRI"} and _SIGNAL_WORDS.search(desc):
        if frame is None or not mr_sequence_known(frame.series_description):
            out["finding_status"] = "uncertain"
            out["finding_code"] = code if code and code != "VLM-FINDING" else "SIGNAL-UNSPECIFIED"
            out["uncertainty_note"] = (
                (note + " " if note else "")
                + "MR sekansı bilinmeden sinyal intensitesi patoloji olarak yorumlanmamalı."
            ).strip()
            if "sekans" not in desc.lower() and "sequence" not in desc.lower():
                out["description"] = (
                    desc
                    + " (MR sekansı katalogda doğrulanamadığı için patolojik yorum belirsiz.)"
                )

    # Technique items may omit bbox; pathology without frame stays uncertain.
    if frame is None and status in {"suspected", "possible"} and _LESION_CODES.search(code):
        out["finding_status"] = "uncertain"

    return out


def sanitize_report_prose(text: str) -> str:
    """Strip English system labels, collapse junk whitespace/repeats."""
    if not text:
        return text
    cleaned = _ENGLISH_SYSTEM_NOISE.sub("", text)
    # Drop standalone English pipeline crumbs often pasted by models.
    cleaned = re.sub(
        r"(?i)\b(supportive evidence only|not a final diagnosis|execution_status|"
        r"source_kind\s*=\s*\w+|clinically_validated\s*=\s*\w+)\b[.\s]*",
        "",
        cleaned,
    )
    lines = [ln.rstrip() for ln in cleaned.splitlines()]
    deduped: list[str] = []
    prev = None
    for ln in lines:
        key = re.sub(r"\s+", " ", ln.strip().lower())
        if key and key == prev:
            continue
        deduped.append(ln)
        prev = key if key else prev
    out = "\n".join(deduped)
    out = _REPEATED_WS.sub(" ", out)
    out = _MULTI_BLANK.sub("\n\n", out)
    return out.strip()
