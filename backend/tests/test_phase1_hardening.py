"""Architecture Hardening Phase 1 — DICOM ingest → classification → routing."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.dicom.classifier import classify_study
from app.dicom.fixtures import (
    ambiguous_region_study_files,
    brain_mri_multisequence_files,
    brain_mri_study_files,
    cervical_mri_study_files,
    inconsistent_study_files,
    missing_uid_partial_files,
    mixed_modality_study_files,
    thorax_xr_study_files,
    unsupported_modality_file,
)
from app.dicom.ingest import has_blocking_errors, ingest_dicom_files
from app.main import create_app
from app.models.model_input_builder import build_imaging_model_input
from app.models.pixel_authorization import evaluate_pixel_access
from app.orchestration.orchestrator import AIOrchestrator
from app.routing.capabilities import (
    INPUT_PIXELS_2D,
    ModelCapability,
    default_capabilities,
)
from app.routing.execution_policy import ModelExecutionPolicy, VisionExecutionMode
from app.routing.model_router import ModelRouter, list_routable_model_ids
from app.schemas.case import CaseCreate, CaseRecord
from app.schemas.dicom import ConfirmClassificationRequest
from app.schemas.enums import (
    AnatomicalRegion,
    CaseLifecycleStatus,
    ClassificationStatus,
    DicomValidationCode,
    JobStatus,
    Modality,
    PipelineOutcome,
    SourceKind,
    Species,
)
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _memory_settings(tmp_path: Path, **kwargs) -> Settings:
    base = dict(
        storage_backend="memory",
        sqlite_path=Path("unused.sqlite3"),
        quarantine_root=tmp_path / "q",
        async_analyze_delay_ms=0,
        llm_provider="mock",
    )
    base.update(kwargs)
    return Settings(**base)


def _case(**kwargs) -> CaseRecord:
    base = dict(
        case_id="case-p1",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        classification_confirmed=True,
    )
    base.update(kwargs)
    return CaseRecord(**base)


def test_valid_brain_mri_metadata() -> None:
    result = ingest_dicom_files(brain_mri_study_files(2))
    assert result.confirmable is True
    assert result.classification is not None
    assert result.classification.suggested_modality == Modality.MR
    assert result.classification.suggested_anatomical_region == AnatomicalRegion.BRAIN
    assert result.classification.classification_status == ClassificationStatus.READY
    assert result.classification.suggested_species == Species.CANINE
    decision = ModelRouter().route(
        _case(
            modality=result.classification.suggested_modality,
            anatomical_region=result.classification.suggested_anatomical_region,
        )
    )
    assert decision.model_ids == ["mock-brain-mri-v1"]


def test_valid_cervical_mri_metadata() -> None:
    result = ingest_dicom_files(cervical_mri_study_files(2))
    assert result.confirmable is True
    assert result.classification is not None
    assert result.classification.suggested_anatomical_region == AnatomicalRegion.CERVICAL
    assert result.classification.classification_status == ClassificationStatus.READY
    decision = ModelRouter().route(
        _case(anatomical_region=AnatomicalRegion.CERVICAL)
    )
    assert decision.model_ids == ["mock-cervical-mri-v1"]


def test_multiple_series_within_one_study() -> None:
    result = ingest_dicom_files(brain_mri_multisequence_files())
    assert result.blocked is False
    assert result.study is not None
    assert result.study.series_count == 2
    assert result.study.instance_count == 5
    ipps = [
        inst.image_position_patient
        for ser in result.study.series
        for inst in ser.instances
    ]
    assert all(ipp for ipp in ipps)
    case = _case(dicom_study=result.study)
    pkg = build_imaging_model_input(case)
    assert pkg.total_instances == 5
    assert pkg.selection is not None
    assert pkg.selection.selected_instance_count >= 1
    assert "mock-brain-mri-v1" in pkg.prepared_for_models


def test_missing_and_conflicting_metadata() -> None:
    partial = ingest_dicom_files(missing_uid_partial_files())
    assert partial.blocked is False
    assert partial.confirmable is True
    assert any(i.code == DicomValidationCode.MISSING_SERIES_UID for i in partial.issues)
    assert has_blocking_errors(partial.issues, blocked=partial.blocked) is False

    mixed = ingest_dicom_files(mixed_modality_study_files())
    assert mixed.blocked is False
    assert mixed.classification is not None
    assert mixed.classification.classification_status == ClassificationStatus.CONFLICTING
    assert mixed.classification.needs_confirmation is True
    assert any(i.code == DicomValidationCode.MIXED_MODALITY for i in mixed.issues)

    ambiguous = ingest_dicom_files(ambiguous_region_study_files())
    assert ambiguous.classification is not None
    assert ambiguous.classification.classification_status == ClassificationStatus.AMBIGUOUS
    assert ambiguous.classification.suggested_anatomical_region == AnatomicalRegion.UNKNOWN
    assert ambiguous.classification.needs_confirmation is True

    bare = ingest_dicom_files(brain_mri_study_files(1))
    assert bare.study is not None
    study = bare.study.model_copy(deep=True)
    study.study_description = None
    for series in study.series:
        series.series_description = None
        series.body_part_examined = None
    suggestion = classify_study(study)
    assert suggestion.classification_status in {
        ClassificationStatus.MISSING_METADATA,
        ClassificationStatus.UNSUPPORTED,
    }
    assert suggestion.needs_confirmation is True
    assert suggestion.suggested_species is None


def test_unsupported_modality_or_region() -> None:
    blocked = ingest_dicom_files([unsupported_modality_file()])
    assert blocked.blocked is True
    assert has_blocking_errors(blocked.issues, blocked=blocked.blocked) is True
    assert blocked.classification is not None
    assert blocked.classification.classification_status == ClassificationStatus.UNSUPPORTED

    decision = ModelRouter().route(
        _case(modality=Modality.OTHER, anatomical_region=AnatomicalRegion.OTHER)
    )
    # Multimodal stub covers OTHER+UNKNOWN; OTHER+OTHER falls to manual or multimodal.
    # Explicit unsupported region OTHER with MR species canine → no anatomy match → manual.
    unsupported = ModelRouter().route(
        _case(modality=Modality.MR, anatomical_region=AnatomicalRegion.OTHER)
    )
    assert unsupported.supported is False
    assert unsupported.model_ids == ["manual-review"]


def test_duplicate_dicom_instances() -> None:
    files = brain_mri_study_files(1)
    files = [files[0], ("dup.dcm", files[0][1])]
    result = ingest_dicom_files(files)
    assert result.blocked is False
    assert result.study is not None
    assert result.study.instance_count == 1
    assert any(i.code == DicomValidationCode.DUPLICATE_SOP for i in result.issues)


def test_corrupted_input_blocked() -> None:
    result = ingest_dicom_files([("corrupt.dcm", b"not-dicom"), ("junk.bin", b"\x00\x01")])
    assert result.blocked is True
    assert result.confirmable is False
    assert any(i.code == DicomValidationCode.MALFORMED for i in result.issues)
    assert has_blocking_errors(result.issues, blocked=True) is True


def test_inconsistent_study_uids_blocked() -> None:
    result = ingest_dicom_files(inconsistent_study_files())
    assert result.blocked is True
    assert any(i.code == DicomValidationCode.INCONSISTENT_STUDY for i in result.issues)


def test_pixel_access_not_authorized_for_mock() -> None:
    case = _case()
    caps = default_capabilities()
    brain = next(c for c in caps if c.model_id == "mock-brain-mri-v1")
    decision = evaluate_pixel_access(case, model_id=brain.model_id, capability=brain)
    assert decision.authorized is False

    pixel_cap = ModelCapability(
        model_id="future-pixel-brain-v1",
        modalities=frozenset({Modality.MR}),
        regions=frozenset({AnatomicalRegion.BRAIN}),
        species=frozenset({Species.CANINE, Species.FELINE}),
        priority=1,
        source_kind=SourceKind.REAL,
        allows_pixel_analysis=True,
        input_requirements=frozenset({INPUT_PIXELS_2D}),
        availability="available",
        adapter_kind="http",
    )
    routed = ModelRouter(capabilities=[pixel_cap, *caps]).route(case)
    # Without authorized pixels / spatial frames, pixel-requiring model is not compatible.
    assert "future-pixel-brain-v1" not in routed.model_ids
    prepared = list_routable_model_ids(case, [pixel_cap, *caps])
    assert prepared == routed.model_ids
    assert "future-pixel-brain-v1" not in prepared


def test_prepared_for_models_matches_router() -> None:
    case = _case()
    caps = default_capabilities()
    pkg = build_imaging_model_input(case, capabilities=caps)
    routed = ModelRouter(capabilities=caps).route(case)
    assert pkg.prepared_for_models == routed.model_ids


def test_mock_real_execution_policy_exclusive() -> None:
    remote = ModelCapability(
        model_id="remote-vision-v1",
        modalities=frozenset({Modality.MR}),
        regions=frozenset({AnatomicalRegion.BRAIN}),
        species=frozenset({Species.CANINE, Species.FELINE}),
        priority=1,
        source_kind=SourceKind.REAL,
        availability="available",
        adapter_kind="http",
    )
    caps = [remote, *default_capabilities()]
    router = ModelRouter(capabilities=caps)
    exclusive = ModelExecutionPolicy(
        mode=VisionExecutionMode.EXCLUSIVE_REAL, capabilities=caps
    )
    decision = exclusive.apply(router.route(_case()))
    assert decision.model_ids == ["remote-vision-v1"]
    assert "mock-brain-mri-v1" not in decision.model_ids

    mixed = ModelExecutionPolicy(mode=VisionExecutionMode.MIXED, capabilities=caps)
    both = mixed.apply(router.route(_case()))
    assert "remote-vision-v1" in both.model_ids
    assert "mock-brain-mri-v1" in both.model_ids


def test_real_model_failure_no_mock_fallback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = _memory_settings(
        tmp_path,
        vision_endpoint="http://127.0.0.1:9/infer",
        vision_model_id="remote-vision-v1",
        vision_modalities=("MR",),
        vision_regions=("BRAIN",),
        vision_species=("canine", "feline"),
        vision_execution_policy="exclusive_real",
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)

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

    case = container.cases.create_case(
        CaseCreate(
            patient_name="Pax",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
        )
    )
    result = container.cases.analyze(case.case_id)
    assert result.outcome == PipelineOutcome.FAILED
    assert result.job.status in {JobStatus.FAILED, JobStatus.TIMED_OUT}
    assert result.job.routed_model_ids == ["remote-vision-v1"]
    assert "mock-brain-mri-v1" not in result.job.routed_model_ids
    assert result.job.analysis_mode == "real"
    assert result.job.route_rule_id
    assert result.report is None
    stored = container.repo.get_case(case.case_id)
    assert stored is not None
    assert stored.status == CaseLifecycleStatus.FAILED
    assert stored.draft_report is None


def test_provenance_preserved_on_mock_success(tmp_path: Path) -> None:
    container = AppContainer(
        repo=InMemoryCaseRepository(), settings=_memory_settings(tmp_path)
    )
    case = container.cases.create_case(
        CaseCreate(
            patient_name="Pax",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
        )
    )
    result = container.cases.analyze(case.case_id)
    assert result.outcome == PipelineOutcome.SUCCESS
    assert result.findings is not None
    assert result.findings.source_kind == SourceKind.MOCK
    assert result.findings.source_model_id == "mock-brain-mri-v1"
    assert result.job.analysis_mode == "mock"
    assert result.job.matched_capabilities == ["mock-brain-mri-v1"]
    assert result.report is not None
    assert result.report.generation.source_kind == SourceKind.MOCK
    assert result.report.synthetic is True
    assert result.report.clinically_validated is False


def test_xr_and_multimodal_routes() -> None:
    xr = ModelRouter().route(
        _case(modality=Modality.XR, anatomical_region=AnatomicalRegion.THORAX)
    )
    assert xr.model_ids == ["mock-xr-vision-v1"]
    multi = ModelRouter().route(
        _case(modality=Modality.OTHER, anatomical_region=AnatomicalRegion.UNKNOWN)
    )
    assert multi.model_ids == ["mock-multimodal-vlm-v1"]
    ct = ModelRouter().route(
        _case(modality=Modality.CT, anatomical_region=AnatomicalRegion.BRAIN)
    )
    assert ct.model_ids == ["mock-ct-3d-v1"]


def test_confirm_override_persists_metadata(tmp_path: Path) -> None:
    settings = _memory_settings(tmp_path)
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    app = create_app(container)
    client = TestClient(app)

    files = brain_mri_study_files(1)
    upload = client.post(
        "/api/v1/dicom/upload",
        data={
            "patient_name": "Pax",
            "species": "canine",
            "clinical_history": "seizure",
        },
        files=[("files", (files[0][0], files[0][1], "application/dicom"))],
    )
    assert upload.status_code == 201, upload.text
    ingest_id = upload.json()["ingest_id"]
    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json=ConfirmClassificationRequest(
            accept_suggestion=False,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.CERVICAL,
        ).model_dump(mode="json"),
    )
    assert confirmed.status_code == 200, confirmed.text
    body = confirmed.json()
    assert body["anatomical_region"] == "CERVICAL"
    study = body["study"]
    assert study["classification_override"] is True
    assert study["classification_confidence"] == "unknown"
    assert study["classification_status"] == "ambiguous"
    assert any("override" in r.lower() for r in study.get("classification_rationale") or [])


def test_orchestrator_records_route_trace(tmp_path: Path) -> None:
    container = AppContainer(
        repo=InMemoryCaseRepository(), settings=_memory_settings(tmp_path)
    )
    case = _case()
    case.model_input = build_imaging_model_input(
        case, capabilities=container.router.list_capabilities()
    )
    job = AIOrchestrator.new_job(case.case_id)
    result = container.orchestrator.run(case, job)
    assert result.job.route_rule_id == "capability.MR.BRAIN"
    assert result.job.matched_capabilities == ["mock-brain-mri-v1"]
    assert any("route_rule_id=" in m for m in result.messages)
