"""Validate structured DICOM evidence references against ImagingModelInput."""

from __future__ import annotations

import re

from app.schemas.findings import EvidenceReference, Finding
from app.schemas.model_input import ImagingModelInput

# DICOM UI UID: numeric components separated by dots (ISO 8824 / DICOM PS3.5).
_UID_RE = re.compile(r"^[0-9]+(?:\.[0-9]+)+$|^[0-9]+$")


def _uid_syntax_ok(uid: str) -> bool:
    text = uid.strip()
    if not text or len(text) > 64:
        return False
    return bool(_UID_RE.fullmatch(text))


def validate_evidence_references(
    findings: list[Finding],
    model_input: ImagingModelInput | None,
) -> list[str]:
    """Return warning strings for invalid/dangling structured evidence refs.

    Free-text-only evidence (no UID fields) is left untouched. Does not fabricate evidence.
    """
    warnings: list[str] = []
    if model_input is None:
        for finding in findings:
            for ev in finding.evidence_references:
                if _has_structured_ids(ev):
                    warnings.append(
                        f"Evidence {ev.evidence_id} on {finding.finding_id}: "
                        "structured DICOM identifiers present but ImagingModelInput is missing; "
                        "reference is unresolved."
                    )
        return warnings

    series_uids = {s.series_instance_uid for s in model_input.series}
    # sop → (series_uid, instance_number or index)
    sop_index: dict[str, tuple[str, int | None]] = {}
    for series in model_input.series:
        for idx, frame in enumerate(series.frames):
            sop_index[frame.sop_instance_uid] = (
                series.series_instance_uid,
                frame.instance_number if frame.instance_number is not None else idx,
            )

    study_uid = model_input.study_instance_uid

    for finding in findings:
        for ev in finding.evidence_references:
            warnings.extend(
                _validate_one(
                    finding_id=finding.finding_id,
                    ev=ev,
                    study_uid=study_uid,
                    series_uids=series_uids,
                    sop_index=sop_index,
                    has_dicom_frames=bool(sop_index),
                )
            )
    return warnings


def _has_structured_ids(ev: EvidenceReference) -> bool:
    return any(
        [
            ev.study_instance_uid,
            ev.series_instance_uid,
            ev.sop_instance_uid,
            ev.frame_index is not None,
        ]
    )


def _validate_one(
    *,
    finding_id: str,
    ev: EvidenceReference,
    study_uid: str | None,
    series_uids: set[str],
    sop_index: dict[str, tuple[str, int | None]],
    has_dicom_frames: bool,
) -> list[str]:
    if not _has_structured_ids(ev):
        return []

    out: list[str] = []
    prefix = f"Evidence {ev.evidence_id} on {finding_id}"

    for label, value in (
        ("study_instance_uid", ev.study_instance_uid),
        ("series_instance_uid", ev.series_instance_uid),
        ("sop_instance_uid", ev.sop_instance_uid),
    ):
        if value is not None and not _uid_syntax_ok(value):
            out.append(f"{prefix}: invalid {label} syntax {value!r}.")

    if ev.frame_index is not None and ev.frame_index < 0:
        out.append(f"{prefix}: frame_index must be >= 0.")

    if not has_dicom_frames:
        out.append(
            f"{prefix}: structured DICOM identifiers cannot be resolved "
            "(ImagingModelInput has no instance frames); dangling reference flagged."
        )
        return out

    if ev.study_instance_uid and study_uid and ev.study_instance_uid != study_uid:
        out.append(
            f"{prefix}: study_instance_uid does not match ImagingModelInput "
            f"({ev.study_instance_uid!r} ≠ {study_uid!r})."
        )

    if ev.series_instance_uid and ev.series_instance_uid not in series_uids:
        out.append(
            f"{prefix}: series_instance_uid {ev.series_instance_uid!r} not found in "
            "ImagingModelInput (dangling)."
        )

    if ev.sop_instance_uid:
        if ev.sop_instance_uid not in sop_index:
            out.append(
                f"{prefix}: sop_instance_uid {ev.sop_instance_uid!r} not found in "
                "ImagingModelInput (dangling)."
            )
        else:
            series_for_sop, inst_num = sop_index[ev.sop_instance_uid]
            if ev.series_instance_uid and ev.series_instance_uid != series_for_sop:
                out.append(
                    f"{prefix}: sop_instance_uid belongs to series {series_for_sop!r}, "
                    f"not {ev.series_instance_uid!r}."
                )
            if ev.frame_index is not None and inst_num is not None and ev.frame_index != inst_num:
                # Allow frame_index to mean instance_number when present on the frame.
                out.append(
                    f"{prefix}: frame_index {ev.frame_index} does not match "
                    f"instance_number/index {inst_num} for sop_instance_uid."
                )

    return out
