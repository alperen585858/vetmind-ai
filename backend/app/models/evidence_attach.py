"""Attach rendered overlay artifacts to StructuredFindings (AI-proposed, pending review)."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

import numpy as np

from app.imaging.evidence_renderer import render_bbox_overlay, render_mask_overlay
from app.models.evidence_store import EvidenceArtifactStore
from app.schemas.case import CaseRecord
from app.schemas.findings import EVIDENCE_DISCLAIMER, EvidenceReference, StructuredFindings


def _load_slice_for_sop(case: CaseRecord, sop: str | None, frame_index: int | None = None) -> np.ndarray | None:
    """Best-effort decode of one quarantine DICOM instance for overlay base image."""
    if not sop or case.model_input is None:
        return None
    from io import BytesIO

    from pydicom import dcmread

    from app.storage.quarantine import QuarantineStore

    # Quarantine root may be on case model_input.quarantine_dir parent.
    qdir = case.model_input.quarantine_dir
    if not qdir:
        return None
    # Find frame with matching SOP
    rel = None
    for series in case.model_input.series:
        for fr in series.frames:
            if fr.sop_instance_uid == sop and fr.quarantine_relative_path:
                rel = fr.quarantine_relative_path
                break
        if rel:
            break
    if not rel:
        return None
    # quarantine_dir is often the ingest folder absolute path
    root_candidate = Path(qdir)
    # If relative path includes ingest id, try parent as quarantine root
    path = root_candidate / Path(rel).name
    if not path.is_file():
        # try full relative under parent of quarantine_dir
        parent = root_candidate.parent
        path = parent / rel
    if not path.is_file():
        return None
    try:
        ds = dcmread(str(path), force=True)
        return pick_frame(
            np.asarray(ds.pixel_array).astype(np.float32),
            samples_per_pixel=int(getattr(ds, "SamplesPerPixel", 1) or 1),
            frame_index=frame_index,
        )
    except Exception:
        return None


def pick_frame(arr: np.ndarray, *, samples_per_pixel: int = 1, frame_index: int | None = None) -> np.ndarray | None:
    """2D grayscale slice for drawing the box on.

    pydicom shapes: (H, W) single gray · (F, H, W) multi-frame gray · (H, W, 3) single
    colour · (F, H, W, 3) multi-frame colour. The box's frame_index selects the frame
    (middle frame only when none is given); colour is converted to luminance.
    """
    color = samples_per_pixel > 1
    if color and arr.ndim >= 3 and arr.shape[-1] in (3, 4):
        arr = arr[..., :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    if arr.ndim == 3:
        n = arr.shape[0]
        idx = frame_index if frame_index is not None else n // 2
        if not 0 <= idx < n:
            return None  # box refers to a frame this file does not have: do not draw it elsewhere
        arr = arr[idx]
    return arr if arr.ndim == 2 else None


def attach_rendered_evidence(
    case: CaseRecord,
    findings: StructuredFindings,
    *,
    store: EvidenceArtifactStore,
    slice_override: np.ndarray | None = None,
) -> StructuredFindings:
    """Render overlays for findings that have bbox/mask and no overlay_ref yet.

    New overlays are ``origin=ai_proposed``, ``review_status=pending``,
    ``include_in_report=False``. Never fabricates localization without bbox/mask.
    """
    updated = findings.model_copy(deep=True)
    for finding in updated.findings:
        new_refs: list[EvidenceReference] = []
        for ev in finding.evidence_references:
            if ev.overlay_ref:
                new_refs.append(ev)
                continue
            if ev.bbox is None and not ev.mask_ref:
                new_refs.append(ev)
                continue
            base = slice_override
            if base is None:
                base = _load_slice_for_sop(case, ev.sop_instance_uid, ev.frame_index)
            if base is None:
                # Cannot render without pixels — keep evidence metadata, warn.
                updated.warnings.append(
                    f"Evidence {ev.evidence_id}: overlay deferred (slice pixels unavailable)."
                )
                new_refs.append(ev)
                continue
            try:
                if ev.mask_ref and Path(ev.mask_ref).is_file():
                    mask = np.load(ev.mask_ref)
                    rendered = render_mask_overlay(
                        base,
                        mask,
                        label="AI-suspected",
                        origin=ev.origin,
                        also_bbox=ev.bbox,
                    )
                elif ev.bbox is not None:
                    rendered = render_bbox_overlay(
                        base,
                        ev.bbox,
                        label="AI-suspected" if ev.origin == "ai_proposed" else "Radiologist-marked",
                        origin=ev.origin,
                    )
                else:
                    new_refs.append(ev)
                    continue
            except ValueError as exc:
                updated.warnings.append(f"Evidence {ev.evidence_id}: render refused ({exc}).")
                new_refs.append(ev)
                continue
            art = store.write_bytes(
                case.case_id,
                ev.evidence_id,
                filename="overlay.png",
                data=rendered.png_bytes,
                working=True,
            )
            store.write_json_meta(
                case.case_id,
                ev.evidence_id,
                {
                    "finding_id": finding.finding_id,
                    "evidence_id": ev.evidence_id,
                    "origin": ev.origin,
                    "review_status": ev.review_status,
                    "sop_instance_uid": ev.sop_instance_uid,
                    "frame_index": ev.frame_index,
                    "disclaimer": EVIDENCE_DISCLAIMER,
                    "overlay_sha256": art.content_sha256,
                },
                working=True,
            )
            new_refs.append(
                ev.model_copy(
                    update={
                        "overlay_ref": art.relative_path,
                        "evidence_type": ev.evidence_type if ev.evidence_type != "overlay" else (
                            "bbox" if ev.bbox else "segmentation_mask"
                        ),
                        # Keep a SYNTHETIC marker (fixed boxes) visible next to the disclaimer.
                        "note": (
                            f"{ev.note} {EVIDENCE_DISCLAIMER}"
                            if ev.note and ev.note.startswith("SYNTHETIC")
                            else EVIDENCE_DISCLAIMER
                        ),
                    }
                )
            )
        finding.evidence_references = new_refs
    return updated


def ensure_evidence_ids(findings: StructuredFindings) -> StructuredFindings:
    """Fill missing evidence_id values (stable enough for review API)."""
    out = findings.model_copy(deep=True)
    for finding in out.findings:
        for i, ev in enumerate(finding.evidence_references):
            if not ev.evidence_id:
                finding.evidence_references[i] = ev.model_copy(
                    update={"evidence_id": f"{finding.finding_id}-ev-{uuid4().hex[:8]}"}
                )
    return out
