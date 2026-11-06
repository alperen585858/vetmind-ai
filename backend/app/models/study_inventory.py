"""Stage A — full DICOM/study inventory without claiming visual analysis.

Walks model_input + dicom_study + documents, counts every frame (incl. NumberOfFrames),
and records undecodable/unsupported paths explicitly. Does not decode pixel arrays.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any

from pydicom import dcmread
from pydicom.errors import InvalidDicomError

from app.imaging.display_png import is_localizer_label
from app.schemas.analysis_coverage import AnalysisCoverage, SeriesCoverage, SkippedFile
from app.schemas.case import CaseRecord
from app.storage.quarantine import QuarantineStore


@dataclass(frozen=True)
class InventoryFrame:
    quarantine_rel: str
    filename: str
    series_instance_uid: str | None
    series_description: str | None
    series_number: int | None
    sop_instance_uid: str | None
    instance_number: int | None
    frame_index: int
    frames_in_file: int
    is_localizer: bool
    is_raster: bool = False


@dataclass
class StudyInventory:
    frames: list[InventoryFrame] = field(default_factory=list)
    skipped: list[SkippedFile] = field(default_factory=list)
    dicom_files: set[str] = field(default_factory=set)
    undecodable_files: set[str] = field(default_factory=set)

    @property
    def frames_detected(self) -> int:
        return len(self.frames)

    @property
    def frames_non_localizer(self) -> int:
        return sum(1 for f in self.frames if not f.is_localizer)

    def series_groups(self) -> dict[str, list[InventoryFrame]]:
        groups: dict[str, list[InventoryFrame]] = {}
        for fr in self.frames:
            key = fr.series_instance_uid or f"file:{fr.quarantine_rel}"
            groups.setdefault(key, []).append(fr)
        return groups

    def coverage_skeleton(
        self,
        *,
        per_batch_image_cap: int,
        total_frame_budget: int,
        include_localizers: bool,
    ) -> AnalysisCoverage:
        series_cov: list[SeriesCoverage] = []
        for uid, frames in self.series_groups().items():
            series_cov.append(
                SeriesCoverage(
                    series_instance_uid=None if uid.startswith("file:") else uid,
                    series_description=frames[0].series_description,
                    is_localizer=all(f.is_localizer for f in frames),
                    frames_detected=len(frames),
                )
            )
        return AnalysisCoverage(
            dicom_files_total=len(self.dicom_files),
            dicom_files_undecodable=len(self.undecodable_files),
            series_total=len(series_cov),
            frames_detected=self.frames_detected,
            frames_detected_non_localizer=self.frames_non_localizer,
            per_batch_image_cap=per_batch_image_cap,
            total_frame_budget=total_frame_budget,
            include_localizers=include_localizers,
            series=series_cov,
            skipped_files=list(self.skipped),
        )


def _frame_count_from_bytes(name: str, data: bytes) -> tuple[int, bool] | None:
    """Return (n_frames, is_dicom) or None if undecodable as image/DICOM.

    Uses stop_before_pixels for memory safety — PixelData may be absent from the
    dataset object even when the file contains pixels, so we key off Rows/Columns
    / NumberOfFrames / pixel-data tags instead of requiring loaded PixelData.
    """
    lower = (name or "").lower()
    if data[:8] == b"\x89PNG\r\n\x1a\n" or data[:2] == b"\xff\xd8":
        return 1, False
    if lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        return 1, False
    try:
        ds = dcmread(BytesIO(data), force=True, stop_before_pixels=True)
    except (InvalidDicomError, Exception):
        if data[:132].find(b"DICM") < 0 and not lower.endswith((".dcm", ".dicom")):
            return None
        return None
    # stop_before_pixels omits PixelData values; tag presence / Rows still indicate an image.
    has_pixel_tag = (0x7FE0, 0x0010) in ds or (0x7FE0, 0x0008) in ds or (0x7FE0, 0x0009) in ds
    has_rows = hasattr(ds, "Rows") or (0x0028, 0x0010) in ds
    has_cols = hasattr(ds, "Columns") or (0x0028, 0x0011) in ds
    if not (has_pixel_tag or (has_rows and has_cols) or hasattr(ds, "NumberOfFrames")):
        return None
    n = int(getattr(ds, "NumberOfFrames", 1) or 1)
    return max(1, n), True


def _dicom_meta_from_bytes(data: bytes) -> dict[str, Any]:
    """Best-effort Series/SOP/Instance tags without decoding pixels."""
    try:
        ds = dcmread(BytesIO(data), force=True, stop_before_pixels=True)
    except Exception:
        return {}
    def _int(name: str) -> int | None:
        raw = getattr(ds, name, None)
        if raw is None:
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None

    return {
        "series_uid": str(getattr(ds, "SeriesInstanceUID", "") or "") or None,
        "series_description": str(getattr(ds, "SeriesDescription", "") or "") or None,
        "series_number": _int("SeriesNumber"),
        "sop": str(getattr(ds, "SOPInstanceUID", "") or "") or None,
        "instance_number": _int("InstanceNumber"),
    }


def _linked_ingest_ids(case: CaseRecord) -> list[str]:
    """Ingest ids whose quarantine files belong to this case."""
    ids: list[str] = []
    if case.dicom_ingest_id:
        ids.append(case.dicom_ingest_id)
    mi = case.model_input
    if mi is not None:
        sel = getattr(mi, "selection", None)
        linked = getattr(sel, "linked_ingest_ids", None) if sel is not None else None
        if linked:
            ids.extend(str(x) for x in linked if x)
        # Older payloads may store quarantine_dir as ".../dicom-xxx"
        qdir = getattr(mi, "quarantine_dir", None) or case.quarantine_dir
        if qdir:
            name = Path(str(qdir)).name
            if name.startswith("dicom-"):
                ids.append(name)
    elif case.quarantine_dir:
        name = Path(case.quarantine_dir).name
        if name.startswith("dicom-"):
            ids.append(name)
    # Preserve order, drop empties/dupes.
    out: list[str] = []
    seen: set[str] = set()
    for i in ids:
        if i and i not in seen:
            seen.add(i)
            out.append(i)
    return out


def build_study_inventory(case: CaseRecord, quarantine: QuarantineStore) -> StudyInventory:
    inv = StudyInventory()
    seen_rel: set[str] = set()

    def _ingest(
        rel: str | None,
        *,
        filename: str = "",
        series_description: str | None = None,
        series_number: int | None = None,
        sop: str | None = None,
        series_uid: str | None = None,
        instance_number: int | None = None,
    ) -> None:
        if not rel or rel in seen_rel:
            return
        seen_rel.add(rel)
        try:
            name, data = quarantine.read_file(rel)
        except Exception as exc:
            inv.skipped.append(SkippedFile(path=rel, reason=f"read_failed: {type(exc).__name__}"))
            inv.undecodable_files.add(rel)
            return
        filename = filename or name or Path(rel).name
        # Prefer caller-supplied hierarchy; fill gaps from DICOM headers so
        # quarantine-only walks still group series correctly.
        if series_uid is None or sop is None or instance_number is None or series_description is None:
            meta = _dicom_meta_from_bytes(data)
            series_uid = series_uid or meta.get("series_uid")
            sop = sop or meta.get("sop")
            instance_number = instance_number if instance_number is not None else meta.get("instance_number")
            series_description = series_description or meta.get("series_description")
            series_number = series_number if series_number is not None else meta.get("series_number")
        counted = _frame_count_from_bytes(filename, data)
        if counted is None:
            inv.skipped.append(
                SkippedFile(path=rel, reason="undecodable_or_no_pixel_data")
            )
            inv.undecodable_files.add(rel)
            return
        n_frames, is_dicom = counted
        if is_dicom:
            inv.dicom_files.add(rel)
        is_loc = is_localizer_label(series_description, filename)
        for fi in range(n_frames):
            inv.frames.append(
                InventoryFrame(
                    quarantine_rel=rel,
                    filename=filename,
                    series_instance_uid=series_uid,
                    series_description=series_description,
                    series_number=series_number,
                    sop_instance_uid=sop,
                    instance_number=instance_number,
                    frame_index=fi,
                    frames_in_file=n_frames,
                    is_localizer=is_loc,
                    is_raster=not is_dicom,
                )
            )

    model_input = case.model_input
    if model_input is not None:
        for series in model_input.series:
            desc = series.series_description
            for fr in series.frames:
                if fr.quarantine_relative_path:
                    _ingest(
                        fr.quarantine_relative_path,
                        filename=fr.filename or "",
                        series_description=desc,
                        series_number=getattr(series, "series_number", None),
                        sop=fr.sop_instance_uid,
                        series_uid=fr.series_instance_uid or series.series_instance_uid,
                        instance_number=fr.instance_number,
                    )

    if case.dicom_study is not None:
        for ser in case.dicom_study.series:
            desc = ser.series_description
            for inst in ser.instances:
                _ingest(
                    inst.quarantine_relative_path,
                    filename=inst.filename or "",
                    series_description=desc,
                    series_number=getattr(ser, "series_number", None),
                    sop=getattr(inst, "sop_instance_uid", None),
                    series_uid=getattr(ser, "series_instance_uid", None),
                    instance_number=getattr(inst, "instance_number", None),
                )

    if case.document_context is not None:
        for doc in case.document_context.documents:
            _ingest(
                doc.quarantine_relative_path,
                filename=Path(doc.quarantine_relative_path).name,
            )

    # Defense in depth: walk every file in linked quarantine ingests so a
    # truncated study tree (e.g. colliding SOP soft-dedupe) cannot hide slices
    # that were actually uploaded and stored.
    for ingest_id in _linked_ingest_ids(case):
        try:
            refs = quarantine.list_files(ingest_id)
        except Exception:
            continue
        for ref in refs:
            rel = ref.relative_path or ""
            if not rel:
                continue
            # Skip manifests / non-image sidecars early by extension when obvious.
            lower = (ref.original_filename or rel).lower()
            if lower.endswith(".json") or lower.endswith(".txt") or lower.endswith(".xml"):
                continue
            _ingest(rel, filename=ref.original_filename or Path(rel).name)

    return inv


def evenly_pick(items: list[Any], limit: int) -> list[Any]:
    if limit <= 0 or not items:
        return []
    if len(items) <= limit:
        return list(items)
    if limit == 1:
        return [items[len(items) // 2]]
    idxs = [int(round(i * (len(items) - 1) / (limit - 1))) for i in range(limit)]
    return [items[i] for i in dict.fromkeys(idxs)]
