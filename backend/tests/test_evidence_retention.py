"""Evidence overlays of open cases survive TTL cleanup; missing figures are reported, not dropped."""

import os
import time
from pathlib import Path

from app.models.evidence_store import EvidenceArtifactStore
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, FindingStatus, Modality, ModelExecutionStatus, SourceKind, Species
from app.schemas.findings import BoundingBoxEvidence, EvidenceReference, Finding, StructuredFindings
from app.schemas.report import DraftReport, GenerationMetadata, ReportSection
from app.security.retention import cleanup_vision_artifacts, open_case_ids
from app.services.report_evidence_snapshot import freeze_evidence_into_report


def _old_dir(path: Path) -> None:
    path.mkdir(parents=True)
    (path / "overlay.png").write_bytes(b"x")
    old = time.time() - 10 * 86400
    os.utime(path, (old, old))


def test_open_case_overlays_are_protected(tmp_path: Path) -> None:
    _old_dir(tmp_path / "_evidence" / "case-open")
    _old_dir(tmp_path / "_evidence" / "case-done")
    open_case = CaseRecord.model_construct(case_id="case-open", status="awaiting_review")
    done_case = CaseRecord.model_construct(case_id="case-done", status="approved")
    removed = cleanup_vision_artifacts(
        tmp_path, older_than_days=1, protected_case_ids=open_case_ids([open_case, done_case])
    )
    assert removed == ["_evidence/case-done"]
    assert (tmp_path / "_evidence" / "case-open" / "overlay.png").exists()


def test_missing_overlay_is_reported_on_freeze(tmp_path: Path) -> None:
    store = EvidenceArtifactStore(tmp_path)
    ev = EvidenceReference(
        evidence_id="ev-gone", description="box", bbox=BoundingBoxEvidence(x_min=1, y_min=1, x_max=2, y_max=2),
        overlay_ref="_evidence/c/ev-gone/overlay.png", origin="ai_proposed",
        review_status="accepted", include_in_report=True,
    )
    sf = StructuredFindings(
        case_id="c", species=Species.CANINE, modality=Modality.MR, anatomical_region=AnatomicalRegion.BRAIN,
        source_model_id="m", source_model_version="1", source_kind=SourceKind.MOCK,
        execution_status=ModelExecutionStatus.SUCCESS,
        findings=[Finding(finding_id="f", finding_code="X", description="d", anatomical_location="l",
                          finding_status=FindingStatus.SUSPECTED, source_model="m", evidence_references=[ev])],
    )
    case = CaseRecord(case_id="c", patient_name="P", species=Species.CANINE, modality=Modality.MR,
                      anatomical_region=AnatomicalRegion.BRAIN, structured_findings=sf)
    s = ReportSection(text="t")
    draft = DraftReport(report_id="r", case_id="c", generation=GenerationMetadata(provider_id="p", model_id="m", model_version="1"),
                        technique=s, findings=s, impression=s, recommendations=s)
    out = freeze_evidence_into_report(case, draft, store=store)
    assert out.evidence_figures == []
    assert any("ev-gone" in w and "missing" in w for w in out.validation_warnings)


def test_pdf_skips_figure_whose_file_changed_after_approval(tmp_path: Path, monkeypatch) -> None:
    import hashlib

    import app.services.pdf_report as pdf
    from app.schemas.report import ReportEvidenceFigure

    shown: list[bytes] = []
    monkeypatch.setattr(pdf, "_image_flowable", lambda png: shown.append(png) or None)
    rel = "_report_evidence/c/v1/ev/overlay.png"
    (tmp_path / rel).parent.mkdir(parents=True)
    (tmp_path / rel).write_bytes(b"approved-image")
    fig = ReportEvidenceFigure(
        finding_id="f", evidence_id="ev", origin="ai_proposed", overlay_ref=rel,
        overlay_content_sha256=hashlib.sha256(b"approved-image").hexdigest(), caption="c", disclaimer="d",
    )
    case = CaseRecord(case_id="c", patient_name="P", species=Species.CANINE, modality=Modality.MR,
                      anatomical_region=AnatomicalRegion.BRAIN)
    s = ReportSection(text="t")
    draft = DraftReport(report_id="r", case_id="c", generation=GenerationMetadata(provider_id="p", model_id="m", model_version="1"),
                        technique=s, findings=s, impression=s, recommendations=s, evidence_figures=[fig])

    pdf.build_approved_report_pdf(case, draft, evidence_root=tmp_path)
    assert shown == [b"approved-image"]

    (tmp_path / rel).write_bytes(b"swapped-image")
    shown.clear()
    pdf.build_approved_report_pdf(case, draft, evidence_root=tmp_path)
    assert shown == [], "a figure that no longer matches its approved hash must not be printed"
