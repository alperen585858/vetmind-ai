"""Unit tests for multimodal VLM Vision adapter (no network)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

from app.models.interfaces import ImagingAdapterError
from app.models.vlm_vision import (
    OpenAiCompatibleVlmVisionModel,
    _extract_json_object,
    build_optional_vlm_vision,
)
from app.schemas.case import CaseRecord
from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    Modality,
    ModelExecutionStatus,
    SourceKind,
    Species,
)
from app.schemas.model_input import ImagingModelInput, ModelInputFrameRef, ModelInputSeriesRef
from app.storage.quarantine import QuarantineStore


def test_extract_json_object_plain_and_fenced() -> None:
    data = _extract_json_object('{"execution_status":"success","findings":[]}')
    assert data["execution_status"] == "success"
    fenced = _extract_json_object('Here:\n```json\n{"execution_status":"partial","findings":[]}\n```\n')
    assert fenced["execution_status"] == "partial"


def test_build_optional_vlm_requires_real_llm(tmp_path: Path) -> None:
    q = QuarantineStore(tmp_path / "q")
    with pytest.raises(ImagingAdapterError, match="real VETMIND_LLM_PROVIDER"):
        build_optional_vlm_vision(
            enabled=True,
            quarantine=q,
            llm_provider="mock",
            llm_endpoint=None,
            llm_api_key=None,
            llm_model_id="x",
        )
    assert (
        build_optional_vlm_vision(
            enabled=False,
            quarantine=q,
            llm_provider="gemini",
            llm_endpoint=None,
            llm_api_key="k",
            llm_model_id="gemini-2.0-flash",
        )
        is None
    )


def _write_tiny_dicom(path: Path) -> None:
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
    ds.PixelData = np.arange(64, dtype=np.uint16).tobytes()
    ds.save_as(path, write_like_original=False)


def test_vlm_maps_response_and_reads_dicom(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "q"
    store = QuarantineStore(root)
    ingest = "dicom-test"
    (root / ingest).mkdir(parents=True)
    dcm_path = root / ingest / "slice.dcm"
    _write_tiny_dicom(dcm_path)
    rel = f"{ingest}/slice.dcm"

    case = CaseRecord(
        case_id="case-vlm-1",
        patient_name="Demo",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        clinical_history="Ataksi",
        model_input=ImagingModelInput(
            case_id="case-vlm-1",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
            series=[
                ModelInputSeriesRef(
                    series_instance_uid="1.2.3",
                    modality=Modality.MR,
                    frame_count=1,
                    frames=[
                        ModelInputFrameRef(
                            sop_instance_uid="1.2.3.4",
                            series_instance_uid="1.2.3",
                            filename="slice.dcm",
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
        api_key="test-key",
        quarantine=store,
        timeout_s=5.0,
    )

    class _Resp:
        status_code = 200
        text = ""

        def json(self) -> dict:
            payload = {
                "execution_status": "success",
                "warnings": [],
                "findings": [
                    {
                        "finding_code": "MASS-SUSPECT",
                        "description": "Orta hat yakınında şüpheli lezyon.",
                        "anatomical_location": "beyin",
                        "finding_status": "suspected",
                        "uncertainty_note": "demo",
                        "model_confidence": 0.4,
                        "source_image_index": 1,
                    }
                ],
            }
            return {
                "choices": [
                    {"message": {"content": json.dumps(payload)}}
                ]
            }

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def __enter__(self) -> "_Client":
            return self

        def __exit__(self, *args) -> None:
            return None

        def post(self, url: str, json: dict, headers: dict) -> _Resp:
            assert "chat/completions" in url
            assert headers.get("Authorization", "").startswith("Bearer ")
            assert any(
                part.get("type") == "image_url"
                for part in json["messages"][1]["content"]
                if isinstance(part, dict)
            )
            return _Resp()

    monkeypatch.setattr("app.models.vlm_vision.httpx.Client", _Client)

    out = adapter.analyze(case)
    assert out.source_kind == SourceKind.REAL
    assert out.source_model_id == "vlm-vision-v1"
    assert out.execution_status == ModelExecutionStatus.SUCCESS
    assert len(out.findings) == 1
    assert out.findings[0].finding_status == FindingStatus.SUSPECTED
    assert out.findings[0].synthetic is False
    assert out.processing_metadata["images_sent"] == "1"


def test_vlm_synthesizes_observations_when_model_returns_empty(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "q"
    store = QuarantineStore(root)
    ingest = "dicom-empty"
    (root / ingest).mkdir(parents=True)
    dcm_path = root / ingest / "slice.dcm"
    _write_tiny_dicom(dcm_path)
    rel = f"{ingest}/slice.dcm"

    case = CaseRecord(
        case_id="case-vlm-empty",
        patient_name="Demo",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        model_input=ImagingModelInput(
            case_id="case-vlm-empty",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
            series=[
                ModelInputSeriesRef(
                    series_instance_uid="1.2.3",
                    modality=Modality.MR,
                    frame_count=1,
                    frames=[
                        ModelInputFrameRef(
                            sop_instance_uid="1.2.3.4",
                            series_instance_uid="1.2.3",
                            filename="slice.dcm",
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
        api_key="test-key",
        quarantine=store,
        timeout_s=5.0,
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
                                    "execution_status": "partial",
                                    "warnings": ["Tek kesit; değerlendirme sınırlı."],
                                    "findings": [],
                                }
                            )
                        }
                    }
                ]
            }

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def __enter__(self) -> "_Client":
            return self

        def __exit__(self, *args) -> None:
            return None

        def post(self, url: str, json: dict, headers: dict) -> _Resp:
            return _Resp()

    monkeypatch.setattr("app.models.vlm_vision.httpx.Client", _Client)
    out = adapter.analyze(case)
    assert out.no_findings_returned is False
    assert len(out.findings) >= 2
    codes = {f.finding_code for f in out.findings}
    assert "IMAGE-QUALITY" in codes
    assert "REGION-APPEARANCE" in codes
    assert out.processing_metadata.get("empty_findings_synthesized") == "true"
    # Technical-only synthesis: no invented lesion inventory language.
    joined = " ".join(f.description.lower() for f in out.findings)
    assert "kitle" not in joined
    assert "kanama" not in joined
    assert "ödem" not in joined and "odem" not in joined
    assert "patoloji yokluğu" in joined or "patoloji yoklugu" in joined.replace("ğ", "g")
