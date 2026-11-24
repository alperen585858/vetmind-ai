"""Neurological exam snapshot -> short Turkish text for the AI history (#72).

Only items the vet actually recorded are written. "Değerlendirilmedi" (not evaluated),
empty values and unknown keys are skipped, so an unrecorded exam is never presented
to the model as a normal one.
"""

from __future__ import annotations

from typing import Any

NOT_EVALUATED = "Değerlendirilmedi"

# (key, label) in clinical reading order.
_ITEMS: tuple[tuple[str, str], ...] = (
    ("consciousness", "bilinç"),
    ("gait", "yürüyüş"),
    ("posturalThoracic", "postüral reaksiyon (ön)"),
    ("posturalPelvic", "postüral reaksiyon (arka)"),
    ("reflexThoracic", "spinal refleks (torasik)"),
    ("reflexPelvic", "spinal refleks (pelvik)"),
    ("deepPain", "derin ağrı"),
    ("hyperesthesia", "spinal hiperestezi"),
)


def _recorded(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or text.casefold() == NOT_EVALUATED.casefold():
        return None
    return text


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [p.strip() for p in value.split(",") if p.strip()]
    return []


def neuro_exam_text(exam: dict[str, Any] | None) -> str:
    """``"Nörolojik muayene: yürüyüş parezi (sol arka, sağ arka); ..."`` or ``""`` when nothing recorded."""
    if not isinstance(exam, dict):
        return ""
    parts: list[str] = []
    for key, label in _ITEMS:
        value = _recorded(exam.get(key))
        if value is None:
            continue
        item = f"{label} {value.lower()}"
        if key == "gait":
            limbs = _as_list(exam.get("limbs"))
            if limbs and value != "Normal":
                item += f" ({', '.join(l.lower() for l in limbs)})"
        parts.append(item)

    signs = _as_list(exam.get("cranialNerves"))
    status = _recorded(exam.get("cranialNervesStatus"))
    if signs:
        parts.append(f"kraniyal sinir bulguları: {', '.join(s.lower() for s in signs)}")
    elif status == "Normal":
        parts.append("kraniyal sinirler normal")

    if not parts:
        return ""
    return "Nörolojik muayene: " + "; ".join(parts) + "."
