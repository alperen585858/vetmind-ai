"""Pure helpers for the VLM vision adapter: code normalisation, dedupe, JSON / image sniffing."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from io import BytesIO
from typing import Any

from pydicom import dcmread

from app.models.interfaces import ImagingAdapterError
from app.models.ontology import (
    canonicalize_finding_code,
    is_known_finding_code,
    is_technique_code,
)
from app.models.vlm_grounding import (
    SentFrame,
)
from app.schemas.enums import FindingStatus
from app.schemas.findings import Finding

log = logging.getLogger(__name__)

_VALID_FINDING_STATUS = {s.value for s in FindingStatus}
_VLM_MAX_EDGE = 1024

# Merge keeps the *more uncertain* status (never upgrade certainty across batches).
_STATUS_UNCERTAINTY_RANK = {
    FindingStatus.SUSPECTED: 0,
    FindingStatus.POSSIBLE: 1,
    FindingStatus.NOT_ASSESSED: 2,
    FindingStatus.UNCERTAIN: 3,
}


def _normalize_vlm_code(raw: str) -> tuple[str, bool]:
    """Return (canonical_code, was_unknown). Unknown free-form → VLM-UNSPECIFIED."""
    code = canonicalize_finding_code(raw)
    if is_known_finding_code(code) or is_technique_code(code):
        return code, False
    # Keep structured clinical-ish tokens not yet in ontology; reject free prose codes.
    upper = (raw or "").strip().upper().replace("_", "-")
    if re.search(
        r"(MASS|LESION|TUMOR|TUMOUR|HEMOR|EDEMA|INFARCT|HERNIA|FRACTURE|NODULE|CYST|"
        r"VENTRICLE|HYDROCEPHAL|PARENCHYM|IVDD|MENINGIOMA)",
        upper,
    ):
        return canonicalize_finding_code(raw) if raw.strip() else "VLM-UNSPECIFIED", False
    return "VLM-UNSPECIFIED", True


def _dedupe_findings(findings: list[Finding]) -> list[Finding]:
    """Merge duplicate code+location+side across batches; keep evidence refs.

    Technique codes (e.g. IMAGE-QUALITY) collapse to a single entry regardless of
    location. Status merge never upgrades certainty.
    """
    by_key: dict[tuple[str, str, str], Finding] = {}
    order: list[tuple[str, str, str]] = []
    for f in findings:
        code_key = f.finding_code.strip().upper()
        loc_key = "" if is_technique_code(f.finding_code) else (f.anatomical_location or "").strip().lower()
        key = (code_key, loc_key, f.laterality if loc_key else "")
        if key not in by_key:
            by_key[key] = f
            order.append(key)
            continue
        prev = by_key[key]
        refs = list(prev.evidence_references) + [
            r for r in f.evidence_references if r.evidence_id not in {x.evidence_id for x in prev.evidence_references}
        ]
        desc = prev.description if len(prev.description) >= len(f.description) else f.description
        prev_rank = _STATUS_UNCERTAINTY_RANK.get(prev.finding_status, 0)
        new_rank = _STATUS_UNCERTAINTY_RANK.get(f.finding_status, 0)
        status = f.finding_status if new_rank > prev_rank else prev.finding_status
        note = prev.uncertainty_note or f.uncertainty_note
        if new_rank > prev_rank and f.uncertainty_note:
            note = f.uncertainty_note
        by_key[key] = prev.model_copy(
            update={
                "description": desc,
                "evidence_references": refs[:8],
                "finding_status": status,
                "uncertainty_note": note,
            }
        )
    return [by_key[k] for k in order]

# Bump when the prompt or the expected JSON shape changes: part of the batch cache key.
def _review_locus(frame: SentFrame) -> str:
    bits = [f"IMG-{frame.index}"]
    if frame.series_label:
        bits.append(frame.series_label)
    if frame.instance_number is not None:
        bits.append(f"instance #{frame.instance_number}")
    return ", ".join(bits)


@dataclass(frozen=True)
class _ImageCandidate:
    rel: str
    filename: str
    series_description: str | None
    sop_instance_uid: str | None
    series_instance_uid: str | None
    instance_number: int | None
    is_localizer: bool


def _extract_json_object(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise ImagingAdapterError("VLM returned empty content.")
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        data = json.loads(fence.group(1))
        if isinstance(data, dict):
            return data
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        data = json.loads(raw[start : end + 1])
        if isinstance(data, dict):
            return data
    raise ImagingAdapterError("VLM response was not valid JSON.")


def _mime_for(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:2] == b"\xff\xd8":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _dicom_frame_count(data: bytes) -> int:
    try:
        ds = dcmread(BytesIO(data), force=True, stop_before_pixels=True)
    except Exception:
        log.debug("DICOM header unreadable; assuming one frame", exc_info=True)
        return 1
    n = int(getattr(ds, "NumberOfFrames", 1) or 1)
    return max(1, n)


def _looks_like_dicom(name: str, data: bytes) -> bool:
    lower = (name or "").lower()
    if lower.endswith((".dcm", ".dicom")):
        return True
    return data[:132].find(b"DICM") >= 0


def _png_size(data: bytes) -> tuple[int, int] | None:
    if data[:8] != b"\x89PNG\r\n\x1a\n" or len(data) < 24:
        return None
    import struct

    w, h = struct.unpack(">II", data[16:24])
    if w <= 0 or h <= 0:
        return None
    return int(w), int(h)
