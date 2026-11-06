"""Localizer deprioritization and multi-frame sampling for VLM Vision."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

from app.models.vlm_vision import OpenAiCompatibleVlmVisionModel
from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta
from app.schemas.enums import AnatomicalRegion, Modality, Species
from app.schemas.model_input import ImagingModelInput, ModelInputFrameRef, ModelInputSeriesRef
from app.storage.quarantine import QuarantineStore


def _write_tiny_dicom(path: Path, *, frames: int = 1) -> None:
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
    ds.Rows = 8
    ds.Columns = 8
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    if frames > 1:
        ds.NumberOfFrames = frames
        pix = np.arange(64 * frames, dtype=np.uint16).reshape(frames, 8, 8)
        ds.PixelData = pix.tobytes()
    else:
        ds.PixelData = np.arange(64, dtype=np.uint16).tobytes()
    ds.save_as(path, write_like_original=False)


def test_vlm_deprioritizes_localizer_series(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "q"
    store = QuarantineStore(root)
    ingest = "study"
    (root / ingest).mkdir(parents=True)
    loc_path = root / ingest / "loc.dcm"
    ax_path = root / ingest / "axial.dcm"
    _write_tiny_dicom(loc_path)
    _write_tiny_dicom(ax_path)
    loc_rel = f"{ingest}/loc.dcm"
    ax_rel = f"{ingest}/axial.dcm"

    case = CaseRecord(
        case_id="case-loc",
        patient_name="Demo",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        dicom_study=DicomStudyMeta(
            study_instance_uid="1.2.3",
            series=[
                DicomSeriesMeta(
                    series_instance_uid="1.2.3.loc",
                    series_description="Localizer",
                    modality=Modality.MR,
                    instances=[
                        DicomInstanceMeta(
                            sop_instance_uid="1.2.3.loc.1",
                            filename="loc.dcm",
                            has_pixel_data=True,
                            quarantine_relative_path=loc_rel,
                        )
                    ],
                ),
                DicomSeriesMeta(
                    series_instance_uid="1.2.3.ax",
                    series_description="T2 FLAIR axial",
                    modality=Modality.MR,
                    instances=[
                        DicomInstanceMeta(
                            sop_instance_uid="1.2.3.ax.1",
                            filename="axial.dcm",
                            has_pixel_data=True,
                            quarantine_relative_path=ax_rel,
                        )
                    ],
                ),
            ],
        ),
        model_input=ImagingModelInput(
            case_id="case-loc",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
            series=[
                ModelInputSeriesRef(
                    series_instance_uid="1.2.3.loc",
                    series_description="Localizer",
                    modality=Modality.MR,
                    frame_count=1,
                    frames=[
                        ModelInputFrameRef(
                            sop_instance_uid="1.2.3.loc.1",
                            series_instance_uid="1.2.3.loc",
                            filename="loc.dcm",
                            has_pixel_data=True,
                            quarantine_relative_path=loc_rel,
                        )
                    ],
                    selected_for_model=True,
                ),
                ModelInputSeriesRef(
                    series_instance_uid="1.2.3.ax",
                    series_description="T2 FLAIR axial",
                    modality=Modality.MR,
                    frame_count=1,
                    frames=[
                        ModelInputFrameRef(
                            sop_instance_uid="1.2.3.ax.1",
                            series_instance_uid="1.2.3.ax",
                            filename="axial.dcm",
                            has_pixel_data=True,
                            quarantine_relative_path=ax_rel,
                        )
                    ],
                    selected_for_model=True,
                ),
            ],
            total_instances=2,
            metadata_only=True,
        ),
    )

    adapter = OpenAiCompatibleVlmVisionModel(
        model_id="vlm-vision-v1",
        chat_model_id="gemini-test",
        base_url="https://example.test/v1",
        api_key="k",
        quarantine=store,
        max_images=1,
    )
    captured: dict = {}

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
                                    "warnings": [],
                                    "findings": [
                                        {
                                            "finding_code": "IMAGE-QUALITY",
                                            "description": "Teknik not",
                                            "anatomical_location": "beyin",
                                            "finding_status": "not_assessed",
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
            captured["payload"] = json
            return _Resp()

    monkeypatch.setattr("app.models.vlm_vision.httpx.Client", _Client)
    out = adapter.analyze(case)
    assert out.processing_metadata["images_sent"] == "1"
    assert "1.2.3.ax.1" in out.processing_metadata.get("sent_sop_frames", "")
    assert "1.2.3.loc.1" not in out.processing_metadata.get("sent_sop_frames", "")
    assert out.processing_metadata.get("localizer_frames_sent") == "0"


def test_vlm_multiframe_samples_multiple_indices(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "q"
    store = QuarantineStore(root)
    ingest = "mf"
    (root / ingest).mkdir(parents=True)
    path = root / ingest / "stack.dcm"
    _write_tiny_dicom(path, frames=8)
    rel = f"{ingest}/stack.dcm"
    sop = "1.2.9.mf"

    case = CaseRecord(
        case_id="case-mf",
        patient_name="Demo",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        model_input=ImagingModelInput(
            case_id="case-mf",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
            series=[
                ModelInputSeriesRef(
                    series_instance_uid="1.2.9",
                    series_description="T2 axial",
                    modality=Modality.MR,
                    frame_count=8,
                    frames=[
                        ModelInputFrameRef(
                            sop_instance_uid=sop,
                            series_instance_uid="1.2.9",
                            filename="stack.dcm",
                            has_pixel_data=True,
                            quarantine_relative_path=rel,
                        )
                    ],
                    selected_for_model=True,
                )
            ],
            total_instances=1,
            metadata_only=True,
        ),
    )
    adapter = OpenAiCompatibleVlmVisionModel(
        model_id="vlm-vision-v1",
        chat_model_id="gemini-test",
        base_url="https://example.test/v1",
        api_key="k",
        quarantine=store,
        max_images=3,
    )
    n_images = {"n": 0}

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
            parts = json["messages"][1]["content"]
            n_images["n"] = sum(1 for p in parts if isinstance(p, dict) and p.get("type") == "image_url")
            return _Resp()

    monkeypatch.setattr("app.models.vlm_vision.httpx.Client", _Client)
    out = adapter.analyze(case)
    assert n_images["n"] == 3
    assert out.processing_metadata["images_sent"] == "3"
    frames_meta = out.processing_metadata["sent_sop_frames"]
    assert frames_meta.count(sop) == 3
