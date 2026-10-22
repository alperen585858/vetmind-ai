"""Phase 3 AI integration readiness — contracts, jobs, prep, provenance."""

from __future__ import annotations

import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.imaging.contracts import PreprocessingContract, metadata_only_contract
from app.imaging.interfaces import PrepValidationError
from app.imaging.metadata_prep import MetadataOnlyPreparationPipeline
from app.models.http_vision import HttpRemoteVisionModel, RemoteFindingPayload
from app.models.interfaces import ImagingAdapterError
from app.models.model_input_builder import build_imaging_model_input
from app.schemas.case import CaseRecord
from app.schemas.dicom import ConfirmClassificationRequest
from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    JobStatus,
    MockScenario,
    Modality,
    SourceKind,
    Species,
)
from app.schemas.findings import Finding, StudyInfo
from app.storage.quarantine import QuarantineStore
from app.workers.job_backend import ThreadJobBackend
from tests.conftest import make_payload


def test_metadata_prep_denies_pixels_by_default(client: TestClient) -> None:
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    assert created.status_code == 201
    case = CaseRecord.model_validate(created.json())
    pipeline = MetadataOnlyPreparationPipeline()
    model_input = pipeline.prepare(case=case, contract=metadata_only_contract("mock-brain-mri-v1"))
    assert model_input.metadata_only is True
    assert model_input.pixel_analysis_authorized is False


def test_metadata_prep_pixel_contract_raises(client: TestClient) -> None:
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    case = CaseRecord.model_validate(created.json())
    pipeline = MetadataOnlyPreparationPipeline()
    pixel_contract = PreprocessingContract(
        contract_id="pixel-v1",
        model_id="mock-brain-mri-v1",
        model_version="1.0.0",
        modalities=frozenset({Modality.MR}),
        regions=frozenset({AnatomicalRegion.BRAIN}),
        requires_pixels=True,
        allowed_transforms=("hu_window",),
    )
    with pytest.raises(PrepValidationError, match="denied|not implemented|Pixel"):
        pipeline.prepare(case=case, contract=pixel_contract)


def test_transfer_syntax_allowlist_rejects_unsupported(client: TestClient) -> None:
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    case = CaseRecord.model_validate(created.json())
    # Attach a synthetic frame with unsupported transfer syntax.
    from app.schemas.model_input import ImagingModelInput, ModelInputFrameRef, ModelInputSeriesRef

    case.model_input = ImagingModelInput(
        case_id=case.case_id,
        species=case.species,
        modality=case.modality,
        anatomical_region=case.anatomical_region,
        series=[
            ModelInputSeriesRef(
                series_instance_uid="1.2.3",
                frame_count=1,
                frames=[
                    ModelInputFrameRef(
                        sop_instance_uid="1.2.3.4",
                        series_instance_uid="1.2.3",
                        transfer_syntax_uid="1.2.840.10008.1.2.4.50",
                    )
                ],
            )
        ],
        total_instances=1,
        metadata_only=True,
    )
    pipeline = MetadataOnlyPreparationPipeline()
    contract = PreprocessingContract(
        contract_id="ts-strict",
        model_id="future",
        model_version="0.0.0",
        modalities=frozenset({Modality.MR}),
        regions=frozenset({AnatomicalRegion.BRAIN}),
        requires_pixels=False,
        allowed_transfer_syntaxes=frozenset({"1.2.840.10008.1.2.1"}),
    )
    with pytest.raises(PrepValidationError, match="Unsupported transfer syntax"):
        pipeline.validate_input(case.model_input, contract)


def test_transfer_syntax_allowlist_rejects_missing(client: TestClient) -> None:
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    case = CaseRecord.model_validate(created.json())
    from app.schemas.model_input import ImagingModelInput, ModelInputFrameRef, ModelInputSeriesRef

    mi = ImagingModelInput(
        case_id=case.case_id,
        species=case.species,
        modality=case.modality,
        anatomical_region=case.anatomical_region,
        series=[
            ModelInputSeriesRef(
                series_instance_uid="1.2.3",
                frame_count=1,
                frames=[
                    ModelInputFrameRef(
                        sop_instance_uid="1.2.3.4",
                        series_instance_uid="1.2.3",
                        transfer_syntax_uid=None,
                    )
                ],
            )
        ],
        total_instances=1,
    )
    pipeline = MetadataOnlyPreparationPipeline()
    contract = PreprocessingContract(
        contract_id="ts-required",
        model_id="future",
        model_version="0.0.0",
        modalities=frozenset({Modality.MR}),
        regions=frozenset({AnatomicalRegion.BRAIN}),
        allowed_transfer_syntaxes=frozenset({"1.2.840.10008.1.2.1"}),
    )
    with pytest.raises(PrepValidationError, match="Missing transfer_syntax"):
        pipeline.validate_input(mi, contract)


def test_quarantine_path_traversal_rejected(tmp_path: Path) -> None:
    store = QuarantineStore(tmp_path / "q")
    store.store_files("ing-1", [("a.dcm", b"DICM" + b"\x00" * 200)])
    with pytest.raises(ValueError, match="escapes"):
        store.resolve("../etc/passwd")
    with pytest.raises(ValueError, match="escapes"):
        store.resolve("/etc/passwd")


def test_duplicate_async_analyze_returns_same_job(client: TestClient) -> None:
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    case_id = created.json()["case_id"]
    first = client.post(f"/api/v1/cases/{case_id}/analyze/async")
    assert first.status_code == 202
    job_id = first.json()["job_id"]
    second = client.post(f"/api/v1/cases/{case_id}/analyze/async")
    assert second.status_code == 202
    assert second.json()["job_id"] == job_id


def test_idempotency_key_returns_same_job_after_complete(client: TestClient) -> None:
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    case_id = created.json()["case_id"]
    headers = {"Idempotency-Key": "phase3-key-1"}
    first = client.post(f"/api/v1/cases/{case_id}/analyze/async", headers=headers)
    assert first.status_code == 202
    job_id = first.json()["job_id"]
    for _ in range(80):
        polled = client.get(f"/api/v1/jobs/{job_id}").json()
        if polled["status"] in {"completed", "failed", "cancelled", "timed_out"}:
            break
        time.sleep(0.05)
    second = client.post(f"/api/v1/cases/{case_id}/analyze/async", headers=headers)
    assert second.status_code == 202
    assert second.json()["job_id"] == job_id


def test_job_cancel_while_queued(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    container = client.app.state.container
    monkeypatch.setattr(container.cases, "_jobs", ThreadJobBackend(delay_ms=800))
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    case_id = created.json()["case_id"]
    enq = client.post(f"/api/v1/cases/{case_id}/analyze/async")
    job_id = enq.json()["job_id"]
    cancelled = client.post(f"/api/v1/jobs/{job_id}/cancel")
    assert cancelled.status_code == 200
    body = cancelled.json()
    assert body["cancel_requested"] is True
    assert body["status"] in {JobStatus.CANCELLED.value, JobStatus.CANCEL_REQUESTED.value}


def test_finding_rejects_out_of_range_confidence() -> None:
    with pytest.raises(ValidationError):
        Finding(
            finding_id="f1",
            finding_code="X",
            description="d",
            anatomical_location="brain",
            finding_status=FindingStatus.UNCERTAIN,
            source_model="mock",
            model_confidence=1.5,
        )


def test_remote_vision_rejects_bad_confidence() -> None:
    adapter = HttpRemoteVisionModel(
        model_id="remote-vision-v1",
        endpoint="http://127.0.0.1:9/vision",
        timeout_s=1.0,
    )
    case = CaseRecord(
        case_id="case-test",
        patient_name="X",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        study=StudyInfo(metadata_only=True),
        classification_confirmed=True,
    )
    with pytest.raises(ImagingAdapterError, match="model_confidence"):
        adapter._map_finding(  # noqa: SLF001
            case,
            RemoteFindingPayload(
                finding_id="f1",
                finding_code="X",
                description="d",
                anatomical_location="brain",
                finding_status="uncertain",
                model_confidence=1.5,
                synthetic=False,
            ),
            0,
            SourceKind.REAL,
            [],
        )


def test_http_vision_maps_valid_confidence() -> None:
    adapter = HttpRemoteVisionModel(
        model_id="remote-vision-v1",
        endpoint="http://127.0.0.1:9/vision",
    )
    case = CaseRecord(
        case_id="case-test",
        patient_name="X",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        study=StudyInfo(metadata_only=True),
        classification_confirmed=True,
    )
    finding = adapter._map_finding(  # noqa: SLF001
        case,
        RemoteFindingPayload(
            finding_id="f1",
            finding_code="X",
            description="d",
            anatomical_location="brain",
            finding_status="uncertain",
            model_confidence=0.42,
            synthetic=False,
        ),
        0,
        SourceKind.REAL,
        [],
    )
    assert finding.model_confidence == 0.42
    assert finding.synthetic is False


def test_remote_vision_timeout_surfaces(monkeypatch: pytest.MonkeyPatch) -> None:
    case = CaseRecord(
        case_id="case-to",
        patient_name="X",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        classification_confirmed=True,
    )
    case.model_input = build_imaging_model_input(case)
    adapter = HttpRemoteVisionModel(
        model_id="remote-vision-v1",
        endpoint="http://vision.test/infer",
        timeout_s=0.5,
    )

    class BoomClient:
        def __init__(self, *args, **kwargs):  # noqa: ANN002, ANN003
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):  # noqa: ANN002
            return False

        def post(self, *args, **kwargs):  # noqa: ANN002, ANN003
            raise httpx.TimeoutException("timeout")

    import app.models.http_vision as hv

    monkeypatch.setattr(hv.httpx, "Client", BoomClient)
    with pytest.raises(ImagingAdapterError, match="timed out"):
        adapter.analyze(case)


def test_remote_vision_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    case = CaseRecord(
        case_id="case-unavail",
        patient_name="X",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        classification_confirmed=True,
    )
    case.model_input = build_imaging_model_input(case)
    adapter = HttpRemoteVisionModel(
        model_id="remote-vision-v1",
        endpoint="http://vision.test/infer",
    )

    class BoomClient:
        def __init__(self, *args, **kwargs):  # noqa: ANN002, ANN003
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):  # noqa: ANN002
            return False

        def post(self, *args, **kwargs):  # noqa: ANN002, ANN003
            raise httpx.ConnectError("refused")

    import app.models.http_vision as hv

    monkeypatch.setattr(hv.httpx, "Client", BoomClient)
    with pytest.raises(ImagingAdapterError, match="HTTP error"):
        adapter.analyze(case)


def test_analyze_refreshes_prepared_for_models(client: TestClient) -> None:
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    case_id = created.json()["case_id"]
    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert analyzed.status_code == 200
    record = client.get(f"/api/v1/cases/{case_id}").json()
    prepared = (record.get("model_input") or {}).get("prepared_for_models") or []
    assert any(str(m).startswith("mock-") for m in prepared)
    findings = record.get("structured_findings") or {}
    assert findings.get("source_kind") == "mock"
    job = analyzed.json()["job"]
    assert job.get("analysis_mode") == "mock"


def test_unsupported_capability_no_ai_draft(client: TestClient) -> None:
    payload = make_payload(scenario=MockScenario.UNSUPPORTED)
    created = client.post("/api/v1/cases", json=payload.model_dump(mode="json"))
    case_id = created.json()["case_id"]
    result = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert result.status_code == 200
    body = result.json()
    assert body["outcome"] == "unsupported"
    assert body["report"] is None


def test_dicom_confirm_then_async_still_works(client: TestClient) -> None:
    upload = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "Phase3", "species": "canine"},
    )
    assert upload.status_code in {200, 201}
    ingest_id = upload.json()["ingest_id"]
    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json=ConfirmClassificationRequest(accept_suggestion=True).model_dump(mode="json"),
    )
    assert confirmed.status_code == 200
    case_id = confirmed.json()["case_id"]
    job = client.post(f"/api/v1/cases/{case_id}/analyze/async")
    assert job.status_code == 202
    job_id = job.json()["job_id"]
    for _ in range(80):
        polled = client.get(f"/api/v1/jobs/{job_id}").json()
        if polled["status"] in {"completed", "failed", "cancelled", "timed_out"}:
            assert polled.get("analysis_mode") in {"mock", "real", "mixed"}
            return
        time.sleep(0.05)
    pytest.fail("job did not complete")
