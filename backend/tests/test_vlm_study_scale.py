"""Scale tests: inventory + planning honesty for 10/50/100/300/1000-frame studies.

These tests do NOT prove clinical accuracy — only that coverage accounting and
batch planning stay honest under large inventories (no fake “full analysis”).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

from app.models.study_inventory import InventoryFrame, StudyInventory, build_study_inventory
from app.models.vlm_batch_planner import plan_visual_analysis
from app.models.vlm_vision import OpenAiCompatibleVlmVisionModel, _dedupe_findings
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, FindingStatus, Modality, Species
from app.schemas.findings import Finding
from app.schemas.model_input import ImagingModelInput, ModelInputFrameRef, ModelInputSeriesRef
from app.storage.quarantine import QuarantineStore


def _fake_inventory(n_frames: int, *, n_series: int = 2, localizer_series: int = 1) -> StudyInventory:
    inv = StudyInventory()
    per = max(1, n_frames // max(1, n_series))
    made = 0
    for s in range(n_series):
        is_loc = s < localizer_series
        uid = f"1.2.series.{s}"
        for i in range(per if s < n_series - 1 else n_frames - made):
            inv.frames.append(
                InventoryFrame(
                    quarantine_rel=f"s{s}/i{i}.dcm",
                    filename=f"i{i}.dcm",
                    series_instance_uid=uid,
                    series_description="Localizer" if is_loc else f"T2 FLAIR ax {s}",
                    series_number=s + 1,
                    sop_instance_uid=f"1.2.sop.{s}.{i}",
                    instance_number=i + 1,
                    frame_index=0,
                    frames_in_file=1,
                    is_localizer=is_loc,
                )
            )
            inv.dicom_files.add(f"s{s}/i{i}.dcm")
            made += 1
            if made >= n_frames:
                break
    return inv


@pytest.mark.parametrize("n_frames", [10, 50, 100, 300, 1000])
def test_plan_never_claims_more_than_budget(n_frames: int) -> None:
    inv = _fake_inventory(n_frames, n_series=4, localizer_series=1)
    budget = 64
    plan = plan_visual_analysis(
        inv,
        max_total_frames=budget,
        per_batch_images=6,
        include_localizers=False,
    )
    assert plan.planned_count <= budget
    assert plan.coverage.frames_detected == n_frames
    assert plan.coverage.frames_planned == plan.planned_count
    assert plan.coverage.frames_visually_analyzed == 0  # plan only — not yet visual
    # Non-localizer target
    non_loc = inv.frames_non_localizer
    assert plan.coverage.frames_detected_non_localizer == non_loc
    if non_loc > budget:
        # After finalize with analyzed=planned would be partial — mark planned < target
        assert plan.planned_count < non_loc
    # Batches respect per-batch cap
    assert all(len(b) <= 6 for b in plan.batches)
    assert sum(len(b) for b in plan.batches) == plan.planned_count


@pytest.mark.parametrize("n_frames,budget", [(10, 10), (50, 50), (100, 100)])
def test_full_scope_when_budget_covers_non_localizers(n_frames: int, budget: int) -> None:
    inv = _fake_inventory(n_frames, n_series=2, localizer_series=0)
    plan = plan_visual_analysis(
        inv, max_total_frames=budget, per_batch_images=8, include_localizers=False
    )
    cov = plan.coverage.model_copy(
        update={"frames_visually_analyzed": plan.planned_count}
    ).finalize()
    assert cov.analysis_scope == "full"
    assert cov.analysis_complete is True
    assert cov.frames_skipped == 0


def test_partial_scope_for_large_study() -> None:
    inv = _fake_inventory(350, n_series=5, localizer_series=1)
    plan = plan_visual_analysis(
        inv, max_total_frames=10, per_batch_images=6, include_localizers=False
    )
    cov = plan.coverage.model_copy(
        update={"frames_visually_analyzed": plan.planned_count}
    ).finalize()
    assert cov.analysis_scope == "partial"
    assert cov.analysis_complete is False
    assert cov.frames_visually_analyzed == 10
    assert cov.frames_skipped == cov.frames_detected_non_localizer - 10


def test_skipped_undecodable_reported(tmp_path: Path) -> None:
    root = tmp_path / "q"
    store = QuarantineStore(root)
    ingest = "mix"
    (root / ingest).mkdir(parents=True)
    bad = f"{ingest}/notes.txt"
    (root / ingest / "notes.txt").write_text("not dicom", encoding="utf-8")

    # Minimal valid DICOM
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = generate_uid()
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    path = root / ingest / "ok.dcm"
    ds = FileDataset(str(path), {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.Modality = "MR"
    ds.Rows = 4
    ds.Columns = 4
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.PixelData = np.arange(16, dtype=np.uint16).tobytes()
    ds.save_as(path, write_like_original=False)
    good = f"{ingest}/ok.dcm"

    case = CaseRecord(
        case_id="case-mix",
        patient_name="Demo",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        model_input=ImagingModelInput(
            case_id="case-mix",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
            series=[
                ModelInputSeriesRef(
                    series_instance_uid="1.2.s",
                    series_description="T2",
                    modality=Modality.MR,
                    frame_count=2,
                    frames=[
                        ModelInputFrameRef(
                            sop_instance_uid="1.2.bad",
                            series_instance_uid="1.2.s",
                            filename="notes.txt",
                            has_pixel_data=False,
                            quarantine_relative_path=bad,
                        ),
                        ModelInputFrameRef(
                            sop_instance_uid="1.2.ok",
                            series_instance_uid="1.2.s",
                            filename="ok.dcm",
                            has_pixel_data=True,
                            quarantine_relative_path=good,
                        ),
                    ],
                    selected_for_model=True,
                )
            ],
            total_instances=2,
            metadata_only=True,
        ),
    )
    inv = build_study_inventory(case, store)
    assert len(inv.skipped) >= 1
    assert any(s.path == bad for s in inv.skipped)
    assert len(inv.frames) >= 1


def test_dedupe_merges_same_code_location() -> None:
    a = Finding(
        finding_id="a",
        finding_code="MASS",
        description="kısa",
        anatomical_location="beyin",
        finding_status=FindingStatus.POSSIBLE,
        source_model="vlm",
    )
    b = Finding(
        finding_id="b",
        finding_code="MASS",
        description="daha uzun açıklama aynı yer",
        anatomical_location="beyin",
        finding_status=FindingStatus.POSSIBLE,
        source_model="vlm",
    )
    out = _dedupe_findings([a, b])
    assert len(out) == 1
    assert "uzun" in out[0].description


def test_analyze_coverage_partial_metadata(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """End-to-end: many inventory frames, tiny budget → partial coverage in result."""
    import json

    root = tmp_path / "q"
    store = QuarantineStore(root)
    ingest = "many"
    (root / ingest).mkdir(parents=True)
    frames_meta = []
    for i in range(12):
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = generate_uid()
        meta.MediaStorageSOPInstanceUID = generate_uid()
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        path = root / ingest / f"s{i}.dcm"
        ds = FileDataset(str(path), {}, file_meta=meta, preamble=b"\0" * 128)
        ds.SOPClassUID = meta.MediaStorageSOPClassUID
        ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID = generate_uid()
        ds.SeriesInstanceUID = generate_uid()
        ds.Modality = "MR"
        ds.SeriesDescription = "T2 FLAIR"
        ds.Rows = 4
        ds.Columns = 4
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 0
        ds.PixelData = np.arange(16, dtype=np.uint16).tobytes()
        ds.save_as(path, write_like_original=False)
        rel = f"{ingest}/s{i}.dcm"
        frames_meta.append(
            ModelInputFrameRef(
                sop_instance_uid=str(ds.SOPInstanceUID),
                series_instance_uid="1.2.series",
                filename=f"s{i}.dcm",
                has_pixel_data=True,
                quarantine_relative_path=rel,
                instance_number=i + 1,
            )
        )

    case = CaseRecord(
        case_id="case-partial",
        patient_name="Demo",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        model_input=ImagingModelInput(
            case_id="case-partial",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
            series=[
                ModelInputSeriesRef(
                    series_instance_uid="1.2.series",
                    series_description="T2 FLAIR",
                    modality=Modality.MR,
                    frame_count=12,
                    frames=frames_meta,
                    selected_for_model=True,
                )
            ],
            total_instances=12,
            metadata_only=True,
        ),
    )

    class _Resp:
        status_code = 200
        text = ""

        def json(self) -> dict:
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "execution_status": "success",
                                    "findings": [
                                        {
                                            "finding_code": "IMAGE-QUALITY",
                                            "description": "ok",
                                            "anatomical_location": "beyin",
                                            "finding_status": "not_assessed",
                                            "source_image_index": 1,
                                        }
                                    ],
                                }
                            )
                        }
                    }
                ]
            }

    class _Client:
        def __init__(self, *a, **k) -> None:
            pass

        def __enter__(self) -> "_Client":
            return self

        def __exit__(self, *a) -> None:
            return None

        def post(self, url: str, json: dict, headers: dict) -> _Resp:
            return _Resp()

    monkeypatch.setattr("app.models.vlm_vision.httpx.Client", _Client)
    adapter = OpenAiCompatibleVlmVisionModel(
        model_id="vlm-vision-v1",
        chat_model_id="gemini-test",
        base_url="https://example.test/v1",
        api_key="k",
        quarantine=store,
        max_images=2,
        max_total_frames=4,
    )
    out = adapter.analyze(case)
    assert out.analysis_coverage is not None
    assert out.analysis_coverage.frames_detected == 12
    assert out.analysis_coverage.frames_decoded == 4
    assert out.analysis_coverage.frames_visually_analyzed == 4
    assert out.analysis_coverage.analysis_scope == "partial"
    assert out.analysis_coverage.analysis_complete is False
    assert out.processing_metadata.get("frames_decoded") == "4"
    assert out.processing_metadata.get("analysis_scope") == "partial"
    assert "KISMİ" in " ".join(out.warnings) or "partial" in out.processing_metadata.get("analysis_scope", "")


def test_inventory_recovers_truncated_study_from_quarantine(tmp_path: Path) -> None:
    """When study tree kept 1 of N colliding-SOP frames, inventory still walks quarantine."""
    from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta

    root = tmp_path / "q"
    store = QuarantineStore(root)
    ingest = "dicom-truncwalk"
    files: list[tuple[str, bytes]] = []
    shared_sop = generate_uid()
    series_uid = generate_uid()
    study_uid = generate_uid()
    for i in range(8):
        meta = FileMetaDataset()
        meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.4"
        meta.MediaStorageSOPInstanceUID = shared_sop
        meta.TransferSyntaxUID = ExplicitVRLittleEndian
        name = f"slice_{i:03d}.dcm"
        path = root / ingest / name  # store_files creates dir
        ds = FileDataset(str(path), {}, file_meta=meta, preamble=b"\0" * 128)
        ds.SOPClassUID = meta.MediaStorageSOPClassUID
        ds.SOPInstanceUID = shared_sop
        ds.StudyInstanceUID = study_uid
        ds.SeriesInstanceUID = series_uid
        ds.Modality = "MR"
        ds.SeriesDescription = "T2"
        ds.InstanceNumber = i + 1
        ds.Rows = 8
        ds.Columns = 8
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 8
        ds.BitsStored = 8
        ds.HighBit = 7
        ds.PixelRepresentation = 0
        ds.PixelData = bytes((i + j) % 256 for j in range(64))
        from io import BytesIO

        buf = BytesIO()
        ds.save_as(buf, write_like_original=False)
        files.append((name, buf.getvalue()))

    refs = store.store_files(ingest, files, content_kinds=["dicom"] * len(files))
    # Truncated study tree: only first instance (historical bug).
    first = refs[0]
    case = CaseRecord(
        case_id="case-trunc",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        dicom_ingest_id=ingest,
        quarantine_dir=str(root / ingest),
        dicom_study=DicomStudyMeta(
            study_instance_uid=study_uid,
            series=[
                DicomSeriesMeta(
                    series_instance_uid=series_uid,
                    series_description="T2",
                    modality=Modality.MR,
                    instances=[
                        DicomInstanceMeta(
                            sop_instance_uid=shared_sop,
                            instance_number=1,
                            filename=first.original_filename,
                            has_pixel_data=True,
                            quarantine_relative_path=first.relative_path,
                        )
                    ],
                )
            ],
        ),
    )
    inv = build_study_inventory(case, store)
    assert len(inv.dicom_files) == 8
    assert inv.frames_detected == 8
