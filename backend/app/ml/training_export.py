"""Training-label export: annotation acceptance ≠ expert verification.

Export rows require expert_verification_status=verified. Patient-level split
prevents train/test leakage by patient_id.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Literal, Sequence

from app.schemas.case import CaseRecord
from app.schemas.findings import EvidenceReference, StructuredFindings

VerificationFilter = Literal["verified_only", "accepted_or_verified", "all"]


@dataclass(frozen=True)
class TrainingExportRow:
    case_id: str
    patient_id: str
    finding_id: str
    evidence_id: str
    acceptance_status: str  # review_status
    expert_verification_status: str
    expert_id: str | None
    verified_at: str | None
    image_source: str | None
    series_instance_uid: str | None
    sop_instance_uid: str | None
    frame_index: int | None
    bbox: dict[str, Any] | None
    annotation_version: str
    dataset_version: str
    study_instance_uid: str | None = None
    modality: str | None = None


def _stable_anon_patient_key(*parts: str | None) -> str:
    material = "|".join(p.strip() for p in parts if p and p.strip())
    if not material:
        material = "unknown"
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]
    return f"anon-{digest}"


def _patient_id(case: CaseRecord) -> str:
    """PHI-safe patient key for splits — never emit PatientName plaintext."""
    study = case.dicom_study
    if study is not None and study.patient_id_synthetic:
        return str(study.patient_id_synthetic)
    # Hash stable clinic identifiers; do not return raw names.
    return _stable_anon_patient_key(case.patient_name, case.case_id)


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _bbox_dict(ev: EvidenceReference) -> dict[str, Any] | None:
    if ev.bbox is None:
        return None
    return ev.bbox.model_dump()


def iter_export_rows(
    cases: Sequence[CaseRecord],
    *,
    dataset_version: str,
    policy: VerificationFilter = "verified_only",
) -> list[TrainingExportRow]:
    if not dataset_version.strip():
        raise ValueError("dataset_version is required")
    rows: list[TrainingExportRow] = []
    for case in cases:
        sf: StructuredFindings | None = case.structured_findings
        if sf is None:
            continue
        patient = _patient_id(case)
        study_uid = None
        if case.dicom_study is not None:
            study_uid = case.dicom_study.study_instance_uid
        for finding in sf.findings:
            for ev in finding.evidence_references:
                acceptance = ev.review_status
                verification = ev.expert_verification_status
                if policy == "verified_only" and verification != "verified":
                    continue
                if policy == "accepted_or_verified":
                    if acceptance not in {"accepted", "edited"} and verification != "verified":
                        continue
                modality = None
                if case.modality is not None:
                    modality = str(getattr(case.modality, "value", case.modality))
                elif sf.modality is not None:
                    modality = str(getattr(sf.modality, "value", sf.modality))
                rows.append(
                    TrainingExportRow(
                        case_id=case.case_id,
                        patient_id=patient,
                        finding_id=finding.finding_id,
                        evidence_id=ev.evidence_id,
                        acceptance_status=acceptance,
                        expert_verification_status=verification,
                        expert_id=ev.expert_verified_by or ev.reviewed_by,
                        verified_at=_iso(ev.expert_verified_at or ev.reviewed_at),
                        image_source=ev.image_source or ev.sop_instance_uid,
                        series_instance_uid=ev.series_instance_uid,
                        sop_instance_uid=ev.sop_instance_uid,
                        frame_index=ev.frame_index,
                        bbox=_bbox_dict(ev),
                        annotation_version=ev.annotation_version or "1",
                        dataset_version=dataset_version,
                        study_instance_uid=study_uid or ev.study_instance_uid,
                        modality=modality,
                    )
                )
    return rows


def export_jsonl(
    cases: Sequence[CaseRecord],
    *,
    dataset_version: str,
    policy: VerificationFilter = "verified_only",
) -> str:
    rows = iter_export_rows(cases, dataset_version=dataset_version, policy=policy)
    return "\n".join(json.dumps(asdict(r), ensure_ascii=False) for r in rows)


def patient_split_rows(
    rows: Sequence[TrainingExportRow],
    *,
    train_frac: float = 0.7,
    val_frac: float = 0.15,
    salt: str = "vetmind-ml",
) -> dict[str, list[TrainingExportRow]]:
    """Split export rows by patient_id (never by frame)."""
    import sys
    from pathlib import Path

    # Prefer in-repo ml helpers without requiring install.
    root = Path(__file__).resolve().parents[3]
    ml_root = root / "ml"
    if str(ml_root) not in sys.path:
        sys.path.insert(0, str(ml_root.parent))
    from ml.evaluation.patient_split import assert_no_patient_leakage, split_patients

    patients = [r.patient_id for r in rows]
    splits = split_patients(patients, train_frac=train_frac, val_frac=val_frac, salt=salt)
    assert_no_patient_leakage(splits)
    by_patient = {name: set(ids) for name, ids in splits.items()}
    out: dict[str, list[TrainingExportRow]] = {k: [] for k in splits}
    for row in rows:
        for name, pids in by_patient.items():
            if row.patient_id in pids:
                out[name].append(row)
                break
    # Re-check frame-level leakage
    seen: dict[str, str] = {}
    for name, group in out.items():
        for row in group:
            if row.patient_id in seen and seen[row.patient_id] != name:
                raise AssertionError(
                    f"Patient leakage after row assign: {row.patient_id} in "
                    f"{seen[row.patient_id]} and {name}"
                )
            seen[row.patient_id] = name
    return out


def set_expert_verification(
    evidence: EvidenceReference,
    *,
    status: Literal["unverified", "verified", "rejected"],
    expert_id: str,
) -> EvidenceReference:
    """Mark verification independently of acceptance/review_status."""
    return evidence.model_copy(
        update={
            "expert_verification_status": status,
            "expert_verified_by": expert_id,
            "expert_verified_at": datetime.now(timezone.utc),
        }
    )
