# Phase 19 — Advanced DICOM Viewer

Upgrades the existing `DicomViewer` for multi-series MRI/CT/XR examination. **No second viewer**, no navigation redesign, no clinical/PACS-grade claims.

## Delivered

### Multi-series linkage
- Verified cases expose **all** authorized DICOM ingests: primary `dicom_ingest_id` + `attachment_refs` (`kind=dicom`).
- `GET /cases/{id}/dicom/files` returns a global file list with `ingest_ids`, `ingest_id`, `ingest_file_index`.
- Accept path merges every submission DICOM attachment onto the case (no orphaned extras).

### Viewer (same component)
- Study → Series → Instance via series strip + instance thumbnails.
- Spatial slice sort using `ImagePositionPatient` / SliceLocation when present; else InstanceNumber (never invents calibration).
- Cine playback (Space, fps control), W/L presets (incl. CT Soft/Brain/Bone/Lung/Abd), zoom/pan/rotate/flip/reset.
- Side-by-side compare with optional **other series** selection.
- Fullscreen examination mode.
- Distance (PixelSpacing → mm, else “kalibre değil”), angle, ROI mean/min/max.

### Study management
- Original quarantine files unchanged.
- Lazy-friendly decode (`buildDicomPreviews` yields; viewer frame cap 96).
- Unsupported / compressed transfer syntax reported per frame (`ok: false`) without crashing the workspace.
- Radiologist workspace loads all linked ingests; draft save on case navigation unchanged.

## Tests
- `backend/tests/test_phase19_dicom_viewer.py`
- `src/lib/dicomPreview.test.ts`

## Limits
- Not a PACS; no JPEG/RLE codec stack — encapsulated syntaxes fail gracefully.
- Compare is two viewports in one component, not a separate hanging protocol engine.
- ROI/distance use tag PixelSpacing only; no imputed spacing.
