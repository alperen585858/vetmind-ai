"""Collects and decodes the study images sent to the VLM (DICOM frames, documents, PNGs)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.imaging.display_png import (
    dicom_bytes_to_png,
    evenly_sample,
    is_localizer_label,
    maybe_image_bytes,
    select_frame_indices,
)
from app.models.study_inventory import InventoryFrame
from app.models.vlm_grounding import (
    SentFrame,
    study_inventory_metadata,
)
from app.models.vlm_parsing import (
    _VLM_MAX_EDGE,
    _dicom_frame_count,
    _ImageCandidate,
    _looks_like_dicom,
    _png_size,
)
from app.schemas.case import CaseRecord


class VlmImageCollectionMixin:
    """Image gathering / decoding for OpenAiCompatibleVlmVisionModel."""

    def _decode_inventory_batch(self, frames: list[InventoryFrame]) -> list[SentFrame]:
        sent: list[SentFrame] = []
        # Cache file bytes within a batch to avoid re-reading multi-frame SOPs.
        file_cache: dict[str, bytes] = {}
        for i, inv in enumerate(frames):
            data = file_cache.get(inv.quarantine_rel)
            if data is None:
                try:
                    _name, data = self._quarantine.read_file(inv.quarantine_rel)
                except Exception:
                    continue
                file_cache[inv.quarantine_rel] = data
            if inv.is_raster:
                img = maybe_image_bytes(inv.filename, data, max_edge=_VLM_MAX_EDGE)
                if img is None:
                    continue
                size = _png_size(img)
                sent.append(
                    SentFrame(
                        index=i + 1,
                        png=img,
                        sop_instance_uid=inv.sop_instance_uid,
                        series_instance_uid=inv.series_instance_uid,
                        instance_number=inv.instance_number,
                        frame_index=inv.frame_index,
                        series_description=inv.series_description,
                        is_localizer=inv.is_localizer,
                        width=size[0] if size else None,
                        height=size[1] if size else None,
                        quarantine_rel=inv.quarantine_rel,
                        series_number=inv.series_number,
                        mr_sequence=inv.mr_sequence,
                    )
                )
                continue
            result = dicom_bytes_to_png(
                data, frame_index=inv.frame_index, max_edge=_VLM_MAX_EDGE, as_rgb=True
            )
            if result is None:
                continue
            sent.append(
                SentFrame(
                    index=i + 1,
                    png=result.png_bytes,
                    sop_instance_uid=inv.sop_instance_uid,
                    series_instance_uid=inv.series_instance_uid,
                    instance_number=inv.instance_number,
                    frame_index=result.frame_index,
                    series_description=inv.series_description,
                    is_localizer=inv.is_localizer,
                    width=result.width,
                    height=result.height,
                    native_width=result.native_width,
                    native_height=result.native_height,
                    quarantine_rel=inv.quarantine_rel,
                    series_number=inv.series_number,
                    mr_sequence=inv.mr_sequence,
                )
            )
        return sent

    def _gather_candidates(self, case: CaseRecord) -> list[_ImageCandidate]:
        by_rel: dict[str, _ImageCandidate] = {}

        def _put(
            rel: str | None,
            *,
            filename: str = "",
            series_description: str | None = None,
            sop: str | None = None,
            series_uid: str | None = None,
            instance_number: int | None = None,
        ) -> None:
            if not rel or rel in by_rel:
                return
            is_loc = is_localizer_label(series_description, filename)
            by_rel[rel] = _ImageCandidate(
                rel=rel,
                filename=filename,
                series_description=series_description,
                sop_instance_uid=sop,
                series_instance_uid=series_uid,
                instance_number=instance_number,
                is_localizer=is_loc,
            )

        model_input = case.model_input
        if model_input is not None:
            for series in model_input.series:
                desc = series.series_description
                for fr in series.frames:
                    if fr.quarantine_relative_path:
                        _put(
                            fr.quarantine_relative_path,
                            filename=fr.filename or "",
                            series_description=desc,
                            sop=fr.sop_instance_uid,
                            series_uid=fr.series_instance_uid or series.series_instance_uid,
                            instance_number=fr.instance_number,
                        )

        if case.dicom_study is not None:
            for ser in case.dicom_study.series:
                desc = ser.series_description
                for inst in ser.instances:
                    _put(
                        inst.quarantine_relative_path,
                        filename=inst.filename or "",
                        series_description=desc,
                        sop=getattr(inst, "sop_instance_uid", None),
                        series_uid=getattr(ser, "series_instance_uid", None),
                        instance_number=getattr(inst, "instance_number", None),
                    )

        if case.document_context is not None:
            for doc in case.document_context.documents:
                _put(
                    doc.quarantine_relative_path,
                    filename=Path(doc.quarantine_relative_path).name,
                )

        return list(by_rel.values())

    def _prioritize_candidates(self, candidates: list[_ImageCandidate]) -> list[_ImageCandidate]:
        non_loc = [c for c in candidates if not c.is_localizer]
        loc = [c for c in candidates if c.is_localizer]
        primary = non_loc or loc
        return evenly_sample(primary, self._max_images)

    def _expand_candidate(self, cand: _ImageCandidate, remaining: int) -> list[dict[str, Any]]:
        """Return partial frame dicts (png + dicom locus); indices assigned later."""
        if remaining <= 0:
            return []
        try:
            name, data = self._quarantine.read_file(cand.rel)
        except Exception:
            return []
        filename = cand.filename or name
        base = {
            "sop_instance_uid": cand.sop_instance_uid,
            "series_instance_uid": cand.series_instance_uid,
            "instance_number": cand.instance_number,
            "series_description": cand.series_description,
            "is_localizer": cand.is_localizer,
            "quarantine_rel": cand.rel,
        }

        if _looks_like_dicom(filename, data) or (
            data[:8] != b"\x89PNG\r\n\x1a\n" and data[:2] != b"\xff\xd8"
        ):
            n_frames = _dicom_frame_count(data)
            frame_budget = min(remaining, 3 if n_frames > 1 else 1)
            indices = select_frame_indices(n_frames, max_frames=frame_budget)
            out: list[dict[str, Any]] = []
            for idx in indices:
                if len(out) >= remaining:
                    break
                result = dicom_bytes_to_png(data, frame_index=idx, max_edge=_VLM_MAX_EDGE, as_rgb=True)
                if result is None:
                    continue
                out.append(
                    {
                        **base,
                        "png": result.png_bytes,
                        "frame_index": result.frame_index,
                        "width": result.width,
                        "height": result.height,
                    }
                )
            if out:
                return out

        img = maybe_image_bytes(filename, data, max_edge=_VLM_MAX_EDGE)
        if img is None:
            return []
        size = _png_size(img)
        return [
            {
                **base,
                "png": img,
                "frame_index": 0,
                "width": size[0] if size else None,
                "height": size[1] if size else None,
            }
        ]

    def _collect_images(self, case: CaseRecord) -> list[SentFrame]:
        candidates = self._gather_candidates(case)
        dicom_n = None
        if case.dicom_study is not None:
            dicom_n = sum(len(s.instances or []) for s in (case.dicom_study.series or []))
        self._last_inventory = study_inventory_metadata(
            candidate_count=len(candidates),
            localizer_candidates=sum(1 for c in candidates if c.is_localizer),
            non_localizer_candidates=sum(1 for c in candidates if not c.is_localizer),
            dicom_instance_count=dicom_n,
        )
        ordered = self._prioritize_candidates(candidates)
        partials: list[dict[str, Any]] = []
        for cand in ordered:
            remaining = self._max_images - len(partials)
            if remaining <= 0:
                break
            partials.extend(self._expand_candidate(cand, remaining))
        if len(partials) < self._max_images:
            locs = [c for c in candidates if c.is_localizer]
            for cand in evenly_sample(locs, self._max_images):
                remaining = self._max_images - len(partials)
                if remaining <= 0:
                    break
                if any(
                    p.get("sop_instance_uid") and p.get("sop_instance_uid") == cand.sop_instance_uid
                    for p in partials
                ):
                    continue
                partials.extend(self._expand_candidate(cand, remaining))
        partials = partials[: self._max_images]
        return [
            SentFrame(
                index=i + 1,
                png=p["png"],
                sop_instance_uid=p.get("sop_instance_uid"),
                series_instance_uid=p.get("series_instance_uid"),
                instance_number=p.get("instance_number"),
                frame_index=int(p.get("frame_index") or 0),
                series_description=p.get("series_description"),
                is_localizer=bool(p.get("is_localizer")),
                width=p.get("width"),
                height=p.get("height"),
                quarantine_rel=p.get("quarantine_rel"),
            )
            for i, p in enumerate(partials)
        ]
