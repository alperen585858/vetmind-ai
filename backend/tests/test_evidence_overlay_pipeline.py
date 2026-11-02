"""Brain MR/CT evidence geometry, renderer, review, and immutable snapshot."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.imaging.evidence_renderer import render_bbox_overlay, render_from_model_space_bbox
from app.imaging.geometry import map_bbox_forward, map_bbox_inverse, resize_step
from app.models.evidence_attach import attach_rendered_evidence
from app.models.evidence_store import EvidenceArtifactStore
from app.schemas.case import CaseRecord
from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    Modality,
    ModelExecutionStatus,
    SourceKind,
    Species,
)
from app.schemas.findings import (
    BoundingBoxEvidence,
    EvidenceReference,
    Finding,
    StructuredFindings,
    StudyInfo,
)
from app.schemas.report import DraftReport, GenerationMetadata, ReportSection
from app.services.evidence_review import review_evidence
from app.services.report_evidence_snapshot import freeze_evidence_into_report


def test_bbox_invert_after_2x_resize() -> None:
    steps = [resize_step(src_h=100, src_w=100, dst_h=200, dst_w=200)]
    # Native box
    native = (10.0, 20.0, 40.0, 50.0)
    model = map_bbox_forward(*native, steps)
    assert model == pytest.approx((20.0, 40.0, 80.0, 100.0))
    back = map_bbox_inverse(*model, steps)
    assert back == pytest.approx(native)


def test_renderer_maps_model_space_to_native() -> None:
    img = np.linspace(0, 1, 64 * 64, dtype=np.float32).reshape(64, 64)
    steps = [resize_step(src_h=64, src_w=64, dst_h=32, dst_w=32)]
    # Box in model (32x32) space corresponding to native (8,8)-(24,24)
    rendered = render_from_model_space_bbox(
        img,
        x_min=4,
        y_min=4,
        x_max=12,
        y_max=12,
        transform_chain=steps,
        origin="ai_proposed",
    )
    assert rendered.png_bytes[:8] == b"\x89PNG\r\n\x1a\n"
    assert rendered.width == 64


def test_attach_and_review_then_freeze(tmp_path: Path) -> None:
    store = EvidenceArtifactStore(tmp_path)
    case = CaseRecord(
        case_id="case-ev-1",
        patient_name="Rex",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
    )
    ev = EvidenceReference(
        evidence_id="ev-1",
        description="AI box",
        evidence_type="bbox",
        origin="ai_proposed",
        review_status="pending",
        include_in_report=False,
        bbox=BoundingBoxEvidence(x_min=5, y_min=5, x_max=20, y_max=20),
    )
    findings = StructuredFindings(
        case_id=case.case_id,
        study=StudyInfo(),
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        source_model_id="vet-mri",
        source_model_version="0.1",
        source_kind=SourceKind.REAL,
        execution_status=ModelExecutionStatus.SUCCESS,
        findings=[
            Finding(
                finding_id="F1",
                finding_code="BRAIN_LESION_SUSPECTED",
                description="Suspected lesion",
                anatomical_location="right temporal",
                finding_status=FindingStatus.SUSPECTED,
                source_model="vet-mri",
                evidence_references=[ev],
            )
        ],
    )
    slice_img = np.random.rand(48, 48).astype(np.float32)
    attached = attach_rendered_evidence(case, findings, store=store, slice_override=slice_img)
    assert attached.findings[0].evidence_references[0].overlay_ref
    assert attached.findings[0].evidence_references[0].review_status == "pending"
    assert attached.findings[0].evidence_references[0].include_in_report is False

    case.structured_findings = attached
    reviewed = review_evidence(
        case,
        "ev-1",
        action="accept",
        reviewer_id="expert@demo.local",
        include_in_report=True,
    )
    assert reviewed.findings[0].evidence_references[0].review_status == "accepted"
    assert reviewed.findings[0].evidence_references[0].include_in_report is True

    draft = DraftReport(
        report_id="r1",
        case_id=case.case_id,
        generation=GenerationMetadata(
            provider_id="mock",
            model_id="m",
            model_version="1",
            source_kind=SourceKind.MOCK,
        ),
        technique=ReportSection(text="t"),
        findings=ReportSection(text="f"),
        impression=ReportSection(text="i"),
        recommendations=ReportSection(text="r"),
        version=1,
    )
    frozen = freeze_evidence_into_report(case, draft, store=store, findings=reviewed)
    assert len(frozen.evidence_figures) == 1
    fig = frozen.evidence_figures[0]
    assert fig.overlay_ref.startswith("_report_evidence/")
    assert fig.overlay_content_sha256
    path = store.resolve(fig.overlay_ref)
    assert path.is_file()
    assert path.read_bytes()[:4] == b"\x89PNG"


def test_reject_never_in_snapshot(tmp_path: Path) -> None:
    store = EvidenceArtifactStore(tmp_path)
    case = CaseRecord(
        case_id="case-ev-2",
        patient_name="Mia",
        species=Species.FELINE,
        modality=Modality.CT,
        anatomical_region=AnatomicalRegion.BRAIN,
    )
    findings = StructuredFindings(
        case_id=case.case_id,
        study=StudyInfo(),
        species=Species.FELINE,
        modality=Modality.CT,
        anatomical_region=AnatomicalRegion.BRAIN,
        source_model_id="vet-ct",
        source_model_version="0.1",
        source_kind=SourceKind.REAL,
        execution_status=ModelExecutionStatus.SUCCESS,
        findings=[
            Finding(
                finding_id="F1",
                finding_code="MASS",
                description="x",
                anatomical_location="brain",
                finding_status=FindingStatus.SUSPECTED,
                source_model="vet-ct",
                evidence_references=[
                    EvidenceReference(
                        evidence_id="ev-rej",
                        description="box",
                        origin="ai_proposed",
                        review_status="pending",
                        bbox=BoundingBoxEvidence(x_min=1, y_min=1, x_max=10, y_max=10),
                    )
                ],
            )
        ],
    )
    attached = attach_rendered_evidence(
        case, findings, store=store, slice_override=np.ones((32, 32), dtype=np.float32)
    )
    case.structured_findings = attached
    review_evidence(case, "ev-rej", action="reject", reviewer_id="e1")
    draft = DraftReport(
        report_id="r2",
        case_id=case.case_id,
        generation=GenerationMetadata(
            provider_id="mock", model_id="m", model_version="1", source_kind=SourceKind.MOCK
        ),
        technique=ReportSection(text="t"),
        findings=ReportSection(text="f"),
        impression=ReportSection(text="i"),
        recommendations=ReportSection(text="r"),
        version=2,
    )
    frozen = freeze_evidence_into_report(case, draft, store=store)
    assert frozen.evidence_figures == []


def test_native_bbox_render_no_invent() -> None:
    img = np.zeros((40, 40), dtype=np.float32)
    bbox = BoundingBoxEvidence(x_min=5, y_min=5, x_max=15, y_max=15)
    out = render_bbox_overlay(img, bbox, origin="ai_proposed")
    assert out.coordinate_space == "pixel_2d_native"
