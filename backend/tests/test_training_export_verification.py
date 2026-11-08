"""P1.2 — acceptance ≠ expert verification; patient-level split."""

from __future__ import annotations

from datetime import datetime, timezone

from app.ml.training_export import (
    export_jsonl,
    iter_export_rows,
    patient_split_rows,
    set_expert_verification,
)
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, FindingStatus, Modality, ModelExecutionStatus, SourceKind, Species
from app.schemas.findings import EvidenceReference, Finding, StructuredFindings, StudyInfo


def _case(pid: str, *, verified: bool, accepted: bool = True) -> CaseRecord:
    ev = EvidenceReference(
        evidence_id=f"{pid}-ev",
        description="box",
        evidence_type="bbox",
        sop_instance_uid=f"sop-{pid}",
        series_instance_uid=f"ser-{pid}",
        frame_index=0,
        review_status="accepted" if accepted else "pending",
        reviewed_by="dr-accept",
        reviewed_at=datetime.now(timezone.utc),
        annotation_version="1",
        image_source=f"q/{pid}.dcm",
    )
    if verified:
        ev = set_expert_verification(ev, status="verified", expert_id="dr-verify")
    sf = StructuredFindings(
        case_id=f"case-{pid}",
        study=StudyInfo(study_id=f"case-{pid}", dicom_available=True, metadata_only=False),
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        source_model_id="vlm",
        source_model_version="1",
        source_kind=SourceKind.REAL,
        execution_status=ModelExecutionStatus.SUCCESS,
        findings=[
            Finding(
                finding_id=f"F-{pid}",
                finding_code="LESION",
                description="d",
                anatomical_location="brain",
                finding_status=FindingStatus.SUSPECTED,
                source_model="vlm",
                evidence_references=[ev],
            )
        ],
    )
    return CaseRecord(
        case_id=f"case-{pid}",
        patient_name=pid,
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        structured_findings=sf,
    )


def test_export_excludes_unverified_even_if_accepted() -> None:
    cases = [_case("p1", verified=False, accepted=True), _case("p2", verified=True)]
    rows = iter_export_rows(cases, dataset_version="ds-1.0.0", policy="verified_only")
    assert len(rows) == 1
    assert rows[0].patient_id.startswith("anon-")
    assert " " not in rows[0].patient_id
    assert rows[0].acceptance_status == "accepted"
    assert rows[0].modality == "MR"
    assert rows[0].expert_verification_status == "verified"
    assert rows[0].expert_id == "dr-verify"
    assert rows[0].dataset_version == "ds-1.0.0"
    assert rows[0].annotation_version == "1"


def test_patient_split_no_leakage() -> None:
    cases = [_case(f"patient-{i}", verified=True) for i in range(20)]
    rows = iter_export_rows(cases, dataset_version="ds-1.0.0")
    splits = patient_split_rows(rows)
    train_ids = {r.patient_id for r in splits["train"]}
    test_ids = {r.patient_id for r in splits["test"]}
    assert train_ids.isdisjoint(test_ids)
    blob = export_jsonl(cases, dataset_version="ds-1.0.0")
    assert "ds-1.0.0" in blob
