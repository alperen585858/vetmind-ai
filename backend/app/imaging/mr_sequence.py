"""Infer MR sequence weighting from DICOM header tags (never from pixels).

Many exports (preclinical Bruker/ParaVision, anonymized PACS dumps) leave
SeriesDescription empty while ProtocolName / SequenceName / TR / TE still say what
the sequence is. Treating those studies as "sequence unknown" blocks every signal
interpretation, so we read every tag that carries the information and say where the
label came from and how sure we are.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

log = logging.getLogger(__name__)

# Larmor frequency of 1H in MHz per tesla.
_GAMMA_1H_MHZ_PER_T = 42.577

# Order matters: FLAIR / STIR / T2* before plain T2, contrast suffix handled separately.
_NAME_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("FLAIR", re.compile(r"FLAIR|\bDARK[\s_-]?FLUID\b|\bTIRM\b")),
    ("STIR", re.compile(r"\bSTIR\b|\bSPAIR\b|\bTIRM?[\s_-]?FS\b")),
    ("DWI", re.compile(r"\bDWI\b|DIFFUSION|\bTRACE\b|\bEP2D[\s_-]?DIFF|\bB[\s_-]?\d{3,4}\b")),
    ("ADC", re.compile(r"\bADC\b")),
    ("SWI", re.compile(r"\bSWI\b|\bSWAN\b|SUSCEPTIBILITY")),
    ("T2*", re.compile(r"T2\s*\*|T2[\s_-]?STAR|\bGRE\b|\bFFE\b|\bMEDIC\b|\bHEMO")),
    ("PD", re.compile(r"(?<![A-Z0-9])PD(?![A-Z])|PROTON[\s_-]?DENS")),
    ("T1", re.compile(r"(?<![A-Z0-9])T1(?![0-9])|\bMPRAGE\b|\bSPGR\b|\bFLASH[\s_-]?3D\b")),
    ("T2", re.compile(r"(?<![A-Z0-9])T2(?![0-9*])|\bHASTE\b|\bFIESTA\b|\bCISS\b|\bSPACE\b")),
)

_CONTRAST_RE = re.compile(r"\+\s*C\b|\bPOST\b|\bGAD|\bGD\b|\bCE[\s_-]|\bC\+|KONTRAST|CONTRAST")

SEQUENCE_LABEL_TR: dict[str, str] = {
    "T1": "T1 ağırlıklı",
    "T2": "T2 ağırlıklı",
    "PD": "proton dansite ağırlıklı",
    "FLAIR": "FLAIR",
    "STIR": "STIR",
    "DWI": "difüzyon ağırlıklı (DWI)",
    "ADC": "ADC haritası",
    "SWI": "SWI",
    "T2*": "T2* (GRE)",
}


@dataclass(frozen=True)
class MrSequenceInfo:
    """What we could learn about the MR sequence of one series."""

    label: str | None = None  # T1 | T2 | PD | FLAIR | STIR | DWI | ADC | SWI | T2*
    contrast: bool = False
    source: str = "none"  # series_description | protocol_name | sequence_name | tr_te | none
    confidence: str = "none"  # high | medium | low | none
    note: str = ""
    display_name: str | None = None  # best human-readable series name
    acquisition_summary: str = ""  # TR/TE/TI, field strength, spacing — for the VLM catalog

    @property
    def known(self) -> bool:
        return self.label is not None and self.confidence in {"high", "medium"}

    @property
    def display_label(self) -> str | None:
        if self.label is None:
            return None
        base = self.label + ("+C" if self.contrast else "")
        return base

    def tr_text(self) -> str:
        if self.label is None:
            return "sekans belirlenemedi"
        txt = SEQUENCE_LABEL_TR.get(self.label, self.label)
        if self.contrast:
            txt += " (kontrastlı)"
        return txt


def _f(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (list, tuple)):
            value = value[0]
        return float(value)
    except (TypeError, ValueError, IndexError):
        return None


def _s(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return "\\".join(str(v) for v in value)
    return str(value).strip()


def label_from_name(text: str | None) -> tuple[str | None, bool]:
    """Sequence label and contrast flag from a free-text series/protocol name."""
    up = (text or "").upper()
    if not up.strip():
        return None, False
    label = next((lab for lab, rx in _NAME_RULES if rx.search(up)), None)
    return label, bool(_CONTRAST_RE.search(up))


def label_from_timing(tr: float | None, te: float | None, ti: float | None) -> str | None:
    """Classic 1.5–3 T spin-echo conventions. Low confidence by design."""
    if ti is not None and ti > 0:
        if ti >= 1500 and (tr or 0) >= 5000:
            return "FLAIR"
        if 80 <= ti <= 300:
            return "STIR"
    if tr is None or te is None:
        return None
    if tr <= 800 and te <= 30:
        return "T1"
    if tr >= 2000 and te >= 70:
        return "T2"
    if tr >= 1200 and te <= 40:
        return "PD"
    return None


def field_strength_t(ds_or_tags: dict[str, Any]) -> float | None:
    b0 = _f(ds_or_tags.get("MagneticFieldStrength"))
    if b0:
        return b0
    freq = _f(ds_or_tags.get("ImagingFrequency"))
    if freq:
        return round(freq / _GAMMA_1H_MHZ_PER_T, 1)
    return None


def infer_mr_sequence(tags: dict[str, Any]) -> MrSequenceInfo:
    """``tags`` maps DICOM keywords to values (pydicom Dataset works via ``tags_from_dataset``)."""
    desc = _s(tags.get("SeriesDescription"))
    protocol = _s(tags.get("ProtocolName"))
    seq_name = _s(tags.get("SequenceName"))
    tr = _f(tags.get("RepetitionTime"))
    te = _f(tags.get("EchoTime"))
    ti = _f(tags.get("InversionTime"))
    agent = _s(tags.get("ContrastBolusAgent"))
    b0 = field_strength_t(tags)

    timing_label = label_from_timing(tr, te, ti)
    display = desc or protocol or seq_name or None

    label: str | None = None
    contrast = bool(agent)
    source = "none"
    for src, text in (("series_description", desc), ("protocol_name", protocol), ("sequence_name", seq_name)):
        lab, con = label_from_name(text)
        contrast = contrast or con
        if lab is not None and label is None:
            label, source = lab, src

    notes: list[str] = []
    confidence = "none"
    if label is not None:
        confidence = "high" if source == "series_description" else "medium"
        if timing_label and timing_label != label and label in {"T1", "T2", "PD"}:
            confidence = "medium"
            notes.append(
                f"Ad '{label}' diyor; TR/TE ({tr:g}/{te:g} ms) klasik olarak "
                f"{SEQUENCE_LABEL_TR.get(timing_label, timing_label)} kontrasta daha yakın."
            )
    elif timing_label is not None:
        label, source, confidence = timing_label, "tr_te", "low"
        notes.append("Sekans adı yok; ağırlık yalnızca TR/TE/TI değerlerinden tahmin edildi.")

    if b0 is not None and b0 >= 4.5:
        notes.append(
            f"Yüksek alanlı ({b0:g} T) muhtemelen preklinik/ex vivo tarayıcı; "
            "doku kontrastı klinik 1.5–3 T görüntülerden farklı olabilir."
        )

    bits: list[str] = []
    if tr is not None:
        bits.append(f"TR={tr:g} ms")
    if te is not None:
        bits.append(f"TE={te:g} ms")
    if ti is not None and ti > 0:
        bits.append(f"TI={ti:g} ms")
    if b0 is not None:
        bits.append(f"B0={b0:g} T")
    acq = _s(tags.get("MRAcquisitionType"))
    if acq:
        bits.append(acq)
    st = _f(tags.get("SliceThickness"))
    if st is not None:
        bits.append(f"kesit={st:g} mm")
    ps = tags.get("PixelSpacing")
    if ps is not None:
        try:
            bits.append(f"piksel={float(ps[0]):g}x{float(ps[1]):g} mm")
        except (TypeError, ValueError, IndexError):
            pass
    rows, cols = tags.get("Rows"), tags.get("Columns")
    if rows and cols:
        bits.append(f"matris={int(rows)}x{int(cols)}")
    manu = _s(tags.get("Manufacturer"))
    if manu:
        bits.append(manu)

    return MrSequenceInfo(
        label=label,
        contrast=contrast,
        source=source,
        confidence=confidence,
        note=" ".join(notes),
        display_name=display,
        acquisition_summary=", ".join(bits),
    )


_TAG_KEYWORDS = (
    "SeriesDescription",
    "ProtocolName",
    "SequenceName",
    "ScanningSequence",
    "SequenceVariant",
    "RepetitionTime",
    "EchoTime",
    "InversionTime",
    "ContrastBolusAgent",
    "MagneticFieldStrength",
    "ImagingFrequency",
    "MRAcquisitionType",
    "SliceThickness",
    "PixelSpacing",
    "Rows",
    "Columns",
    "Manufacturer",
)


def tags_from_dataset(ds: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for kw in _TAG_KEYWORDS:
        try:
            val = getattr(ds, kw, None)
        except Exception:  # noqa: BLE001 — malformed element must not break inventory
            log.debug("Malformed DICOM element %s", kw, exc_info=True)
            val = None
        if val is not None and val != "":
            out[kw] = val
    return out


def mr_sequence_from_dataset(ds: Any) -> MrSequenceInfo:
    return infer_mr_sequence(tags_from_dataset(ds))
