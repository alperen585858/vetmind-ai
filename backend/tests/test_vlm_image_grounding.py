"""Verification scenarios: no image / wrong image / correct image + evidence binding."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

from app.models.interfaces import ImagingAdapterError
from app.models.vlm_grounding import (
    SentFrame,
    harden_finding_fields,
    mr_sequence_known,
    resolve_source_frame,
    sanitize_report_prose,
)
from app.models.vlm_vision import OpenAiCompatibleVlmVisionModel
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, FindingStatus, Modality, Species
from app.schemas.model_input import ImagingModelInput, ModelInputFrameRef, ModelInputSeriesRef
from app.storage.quarantine import QuarantineStore


def _write_tiny_dicom(path: Path, *, series_desc_tag: str | None = None) -> None:
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
    if series_desc_tag:
        ds.SeriesDescription = series_desc_tag
    ds.Rows = 8
    ds.Columns = 8
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    ds.PixelData = np.arange(64, dtype=np.uint16).tobytes()
    ds.save_as(path, write_like_original=False)


def _case_with_frame(
    case_id: str,
    *,
    rel: str,
    series_description: str,
    sop: str,
    instance_number: int = 12,
) -> CaseRecord:
    return CaseRecord(
        case_id=case_id,
        patient_name="Demo",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        model_input=ImagingModelInput(
            case_id=case_id,
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
            series=[
                ModelInputSeriesRef(
                    series_instance_uid="1.2.3.series",
                    series_description=series_description,
                    modality=Modality.MR,
                    frame_count=1,
                    frames=[
                        ModelInputFrameRef(
                            sop_instance_uid=sop,
                            series_instance_uid="1.2.3.series",
                            filename=Path(rel).name,
                            has_pixel_data=True,
                            quarantine_relative_path=rel,
                            instance_number=instance_number,
                        )
                    ],
                    selected_for_model=True,
                )
            ],
            total_instances=1,
            metadata_only=True,
        ),
    )


def _mock_client(monkeypatch: pytest.MonkeyPatch, payload: dict, capture: dict | None = None):
    class _Resp:
        status_code = 200
        text = ""

        def json(self) -> dict:
            return {"choices": [{"message": {"content": json.dumps(payload)}}]}

    class _Client:
        def __init__(self, *a, **k) -> None:
            pass

        def __enter__(self) -> "_Client":
            return self

        def __exit__(self, *a) -> None:
            return None

        def post(self, url: str, json: dict, headers: dict) -> _Resp:
            if capture is not None:
                capture["payload"] = json
            return _Resp()

    monkeypatch.setattr("app.models.vlm_vision.httpx.Client", _Client)


def test_no_image_raises(tmp_path: Path) -> None:
    store = QuarantineStore(tmp_path / "q")
    case = _case_with_frame(
        "case-none",
        rel="missing/no.dcm",
        series_description="T2 FLAIR",
        sop="1.2.3.missing",
    )
    adapter = OpenAiCompatibleVlmVisionModel(
        model_id="vlm-vision-v1",
        chat_model_id="gemini-test",
        base_url="https://example.test/v1",
        api_key="k",
        quarantine=store,
    )
    with pytest.raises(ImagingAdapterError, match="no decodable image"):
        adapter.analyze(case)


def test_wrong_image_bytes_skipped(tmp_path: Path) -> None:
    root = tmp_path / "q"
    store = QuarantineStore(root)
    ingest = "bad"
    (root / ingest).mkdir(parents=True)
    rel = f"{ingest}/notes.txt"
    (root / ingest / "notes.txt").write_text("not an image", encoding="utf-8")
    case = _case_with_frame(
        "case-wrong",
        rel=rel,
        series_description="T2 FLAIR",
        sop="1.2.3.wrong",
    )
    adapter = OpenAiCompatibleVlmVisionModel(
        model_id="vlm-vision-v1",
        chat_model_id="gemini-test",
        base_url="https://example.test/v1",
        api_key="k",
        quarantine=store,
    )
    with pytest.raises(ImagingAdapterError, match="no decodable image"):
        adapter.analyze(case)


def test_correct_image_binds_series_instance_and_bbox(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "q"
    store = QuarantineStore(root)
    ingest = "ok"
    (root / ingest).mkdir(parents=True)
    path = root / ingest / "slice.dcm"
    _write_tiny_dicom(path, series_desc_tag="T2 FLAIR axial")
    rel = f"{ingest}/slice.dcm"
    sop = "1.2.3.ok.sop"
    case = _case_with_frame(
        "case-ok",
        rel=rel,
        series_description="T2 FLAIR axial",
        sop=sop,
        instance_number=17,
    )
    capture: dict = {}
    _mock_client(
        monkeypatch,
        {
            "execution_status": "success",
            "warnings": [],
            "findings": [
                {
                    "finding_code": "IMAGE-QUALITY",
                    "description": "Tek aksiyel kesit; hareket yok.",
                    "anatomical_location": "beyin",
                    "finding_status": "not_assessed",
                    "source_image_index": 1,
                },
                {
                    "finding_code": "VENTRICLE-ASYMMETRY",
                    "description": "Lateral ventrikül asimetri şüphesi.",
                    "anatomical_location": "beyin",
                    "finding_status": "possible",
                    "source_image_index": 1,
                    "bbox_norm": [0.2, 0.2, 0.6, 0.7],
                    "uncertainty_note": "Tek kesit",
                },
            ],
        },
        capture=capture,
    )
    adapter = OpenAiCompatibleVlmVisionModel(
        model_id="vlm-vision-v1",
        chat_model_id="gemini-test",
        base_url="https://example.test/v1",
        api_key="k",
        quarantine=store,
    )
    out = adapter.analyze(case)
    assert out.processing_metadata["images_sent"] == "1"
    assert "sent_image_catalog_json" in out.processing_metadata
    assert sop in out.processing_metadata["sent_sop_frames"]
    # Catalog text must be in the user prompt.
    user_content = capture["payload"]["messages"][1]["content"]
    text_parts = [p["text"] for p in user_content if isinstance(p, dict) and p.get("type") == "text"]
    assert any("IMAGE CATALOG" in t for t in text_parts)
    assert any("[IMG-1]" in t for t in text_parts)

    lesion = next(f for f in out.findings if f.finding_code == "VENTRICLE-ASYMMETRY")
    ev = lesion.evidence_references[0]
    assert ev.sop_instance_uid == sop
    assert ev.series_instance_uid == "1.2.3.series"
    assert ev.instance_number == 17
    assert ev.frame_index == 0
    assert ev.bbox is not None
    assert ev.bbox.x_min < ev.bbox.x_max


def test_ungrounded_lesion_demoted() -> None:
    frames = [
        SentFrame(
            index=1,
            png=b"\x89PNG\r\n\x1a\n",
            sop_instance_uid="1.2",
            series_instance_uid="1.2.s",
            instance_number=1,
            frame_index=0,
            series_description="unknown axial",
            is_localizer=False,
            width=64,
            height=64,
        )
    ]
    item = {
        "finding_code": "MASS-SUSPECT",
        "description": "Şüpheli kitle",
        "finding_status": "suspected",
    }
    assert resolve_source_frame(item, frames) is None
    hard = harden_finding_fields(item, frame=None, modality="MR")
    assert hard["finding_status"] == "uncertain"
    assert "source_image_index" in hard["uncertainty_note"].lower() or "doğrulanamadı" in hard["uncertainty_note"].lower()


def test_unknown_mr_sequence_blocks_signal_pathology() -> None:
    assert not mr_sequence_known("axial brain")
    assert mr_sequence_known("T2 FLAIR axial")
    frame = SentFrame(
        index=1,
        png=b"x",
        sop_instance_uid="1",
        series_instance_uid="s",
        instance_number=1,
        frame_index=0,
        series_description="axial brain",
        is_localizer=False,
    )
    hard = harden_finding_fields(
        {
            "finding_code": "T2-HYPER",
            "description": "Periventriküler hiperintensite",
            "finding_status": "suspected",
            "source_image_index": 1,
        },
        frame=frame,
        modality="MR",
    )
    assert hard["finding_status"] == "uncertain"
    assert "sekans" in hard["uncertainty_note"].lower()


def test_sanitize_report_prose_strips_english_labels() -> None:
    raw = (
        "Bulgu mevcut [F1].\n"
        "execution_status: success\n"
        "Bulgu mevcut [F1].\n"
        "Supportive evidence only. Değerlendirme belirsiz."
        " AI-suspected highlight (pending radiologist review) izlendi."
    )
    out = sanitize_report_prose(raw)
    assert "execution_status" not in out.lower()
    assert "AI-suspected highlight" not in out
    assert "radyolog incelemesi" in out.lower()
    assert "supportive evidence" not in out.lower()
    assert out.count("Bulgu mevcut") == 1
