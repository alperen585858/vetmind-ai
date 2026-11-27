"""Honest, deterministic limitation / missing-context notes for a visual analysis run.

These are not findings and must never become differential diagnoses. They are
surfaced as warnings with stable Turkish prefixes so the UI can sort them:

- ``Eksik bilgi:``  input the clinic can still provide (history, breed, age, more slices)
- ``Sınırlama:``    technical limits of what was analyzed
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

from app.imaging.mr_sequence import SEQUENCE_LABEL_TR

MISSING_PREFIX = "Eksik bilgi:"
LIMITATION_PREFIX = "Sınırlama:"

# Fewer visually analyzed slices than this in an MR/CT study cannot represent the volume.
MIN_CROSS_SECTIONAL_FRAMES = 3

_CROSS_SECTIONAL = {"MR", "MRI", "CT"}


def _modality_key(modality: Any) -> str:
    return str(getattr(modality, "value", modality) or "").strip().upper()


def sampling_limitation(modality: Any, frames_visually_analyzed: int) -> str | None:
    if _modality_key(modality) not in _CROSS_SECTIONAL:
        return None
    if frames_visually_analyzed <= 0 or frames_visually_analyzed >= MIN_CROSS_SECTIONAL_FRAMES:
        return None
    n = frames_visually_analyzed
    return (
        f"kesitsel ({_modality_key(modality)}) çalışmanın yalnızca {n} kesiti görsel olarak analiz edildi; "
        "beynin/bölgenin geri kalanı değerlendirilmedi. Tüm seriyi (ve mümkünse T2, FLAIR, "
        "T1 kontrastlı serileri) yükleyin."
    )


def context_gaps(case: Any, *, history_text: str | None = None) -> list[str]:
    """Clinical inputs that change interpretation but were not provided.

    ``history_text`` is the composed free-text + structured history; when omitted only the
    free-text field is checked.
    """
    missing: list[str] = []
    if not (getattr(case, "breed", None) or "").strip():
        missing.append("ırk")
    if getattr(case, "patient_age_years", None) is None:
        missing.append("yaş")
    history = (
        history_text if history_text is not None else (getattr(case, "clinical_history", None) or "")
    ).strip()
    if not history:
        missing.append("klinik öykü/şikâyet")
    if not missing:
        return []
    return [
        f"{MISSING_PREFIX} {', '.join(missing)} girilmemiş. Irka özgü varyantlar (ör. brakisefal "
        "ırklarda ventrikül genişliği) ve yaş/şikâyet olmadan ayırıcı tanı sıralaması güvenilir değildir."
    ]


def sequence_limitations(frames: Iterable[Any], modality: Any) -> list[str]:
    """One note per distinct series whose MR weighting is unknown or only guessed."""
    if _modality_key(modality) not in {"MR", "MRI"}:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for fr in frames:
        key = str(getattr(fr, "series_instance_uid", None) or getattr(fr, "series_label", None) or "")
        if key in seen:
            continue
        seen.add(key)
        seq = getattr(fr, "mr_sequence", None)
        name = getattr(fr, "series_label", None) or "seri"
        if seq is None or seq.label is None:
            out.append(
                f"{LIMITATION_PREFIX} '{name}' serisinin MR sekansı DICOM başlığından belirlenemedi "
                "(SeriesDescription, ProtocolName, SequenceName, TR/TE yok); sinyal yorumlanmadı."
            )
        elif seq.confidence == "low":
            out.append(
                f"{LIMITATION_PREFIX} '{name}' serisi yalnızca TR/TE'den "
                f"{SEQUENCE_LABEL_TR.get(seq.label, seq.label)} olarak tahmin edildi; sinyal yorumu temkinli."
            )
        if seq is not None and "Yüksek alanlı" in (seq.note or ""):
            out.append(f"{LIMITATION_PREFIX} {seq.note[seq.note.index('Yüksek alanlı'):].strip()}")
    return list(dict.fromkeys(out))


def sequence_summary_lines(frames: Sequence[Any]) -> list[str]:
    """Per-series 'name → weighting (source, confidence); acquisition' lines for prompts/UI."""
    lines: list[str] = []
    seen: set[str] = set()
    for fr in frames:
        key = str(getattr(fr, "series_instance_uid", None) or getattr(fr, "series_label", None) or "")
        if key in seen:
            continue
        seen.add(key)
        seq = getattr(fr, "mr_sequence", None)
        if seq is None:
            continue
        name = getattr(fr, "series_label", None) or "seri"
        label = seq.tr_text() if seq.label else "sekans belirlenemedi"
        src = f" (kaynak={seq.source}, güven={seq.confidence})" if seq.label else ""
        acq = f"; {seq.acquisition_summary}" if seq.acquisition_summary else ""
        note = f" — {seq.note}" if seq.note else ""
        lines.append(f"{name}: {label}{src}{acq}{note}")
    return lines
