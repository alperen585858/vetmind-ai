"""VLM batch progress callbacks and case-scoped result cache."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

from app.models.vlm_result_cache import VlmBatchResultCache, batch_cache_key
from app.models.vlm_vision import OpenAiCompatibleVlmVisionModel
from app.orchestration.progress import vision_batch_progress_pct
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, Species
from app.schemas.model_input import ImagingModelInput, ModelInputFrameRef, ModelInputSeriesRef
from app.storage.quarantine import QuarantineStore


def test_batch_cache_key_isolates_cases() -> None:
    a = batch_cache_key(case_id="case-a", chat_model_id="m", frame_keys=["sop1#f0"])
    b = batch_cache_key(case_id="case-b", chat_model_id="m", frame_keys=["sop1#f0"])
    assert a != b


def test_vlm_batch_result_cache_roundtrip(tmp_path: Path) -> None:
    cache = VlmBatchResultCache(tmp_path / "c")
    key = batch_cache_key(case_id="c1", chat_model_id="g", frame_keys=["x#f0"])
    assert cache.get(key) is None
    cache.put(key, {"execution_status": "success", "findings": []})
    assert cache.get(key)["execution_status"] == "success"


def test_vision_batch_progress_pct_monotonic() -> None:
    p0 = vision_batch_progress_pct(adapter_index=0, adapter_total=1, batch_index=0, batch_total=4)
    p1 = vision_batch_progress_pct(adapter_index=0, adapter_total=1, batch_index=1, batch_total=4)
    p3 = vision_batch_progress_pct(adapter_index=0, adapter_total=1, batch_index=3, batch_total=4)
    assert 35 <= p0 <= p1 <= p3 < 55


def _write_dcm(path: Path) -> str:
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = generate_uid()
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
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
    return str(ds.SOPInstanceUID)


def test_analyze_emits_progress_and_uses_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "q"
    store = QuarantineStore(root)
    ingest = "p"
    (root / ingest).mkdir(parents=True)
    frames = []
    for i in range(4):
        path = root / ingest / f"{i}.dcm"
        sop = _write_dcm(path)
        rel = f"{ingest}/{i}.dcm"
        frames.append(
            ModelInputFrameRef(
                sop_instance_uid=sop,
                series_instance_uid="1.2.3",
                filename=f"{i}.dcm",
                has_pixel_data=True,
                quarantine_relative_path=rel,
                instance_number=i + 1,
            )
        )
    case = CaseRecord(
        case_id="case-prog",
        patient_name="Demo",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        model_input=ImagingModelInput(
            case_id="case-prog",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
            series=[
                ModelInputSeriesRef(
                    series_instance_uid="1.2.3",
                    series_description="T2 FLAIR",
                    modality=Modality.MR,
                    frame_count=4,
                    frames=frames,
                    selected_for_model=True,
                )
            ],
            total_instances=4,
            metadata_only=True,
        ),
    )

    calls = {"n": 0}
    events: list[dict] = []

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
            calls["n"] += 1
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
        cache_root=tmp_path / "cache",
    )
    adapter.progress_callback = lambda p: events.append(dict(p))
    out1 = adapter.analyze(case)
    first_calls = calls["n"]
    assert first_calls >= 1
    assert any(e.get("vision_batch_total", 0) >= 1 for e in events)
    assert out1.analysis_coverage is not None

    # Second run should hit disk cache (fewer or equal HTTP posts).
    calls["n"] = 0
    events.clear()
    out2 = adapter.analyze(case)
    assert calls["n"] == 0
    assert out2.processing_metadata.get("vlm_batch_cache_hits") is not None
