"""Merge multi-ingest DICOM study metadata onto a case for AI packaging."""

from __future__ import annotations

from copy import deepcopy
from typing import Protocol

from app.schemas.case import CaseRecord
from app.schemas.dicom import (
    DicomIngestionRecord,
    DicomInstanceMeta,
    DicomSeriesMeta,
    DicomStudyMeta,
)
from app.schemas.workflow import AttachmentRef


class _IngestLookup(Protocol):
    def get_ingestion(self, ingest_id: str) -> DicomIngestionRecord | None: ...


def _tag_instances(study: DicomStudyMeta, ingest_id: str) -> DicomStudyMeta:
    series_out: list[DicomSeriesMeta] = []
    for ser in study.series:
        tagged = [
            inst.model_copy(update={"ingest_id": ingest_id or inst.ingest_id})
            for inst in ser.instances
        ]
        series_out.append(ser.model_copy(update={"instances": tagged}))
    return study.model_copy(update={"series": series_out})


def _slice_fingerprint(inst: DicomInstanceMeta) -> tuple:
    """True-duplicate identity (mirrors validator soft-dedupe)."""
    if inst.instance_number is not None or inst.image_position_patient is not None:
        return (
            inst.instance_number,
            inst.image_position_patient,
            inst.rows,
            inst.columns,
        )
    return (
        None,
        None,
        inst.rows,
        inst.columns,
        inst.filename,
    )


def _mint_disambiguated_sop(original: str, inst: DicomInstanceMeta, index: int) -> str:
    inst_no = inst.instance_number if inst.instance_number is not None else index + 1
    digits = "".join(ch for ch in (inst.filename or "") if ch.isdigit())[-8:] or str(index + 1)
    return f"{original}.{inst_no}.{digits}"


def merge_study_into(
    base: DicomStudyMeta | None,
    extra: DicomStudyMeta,
    *,
    ingest_id: str,
) -> DicomStudyMeta:
    """Union series/instances; soft-dedupe SOP while keeping distinct colliding slices."""
    tagged = _tag_instances(extra, ingest_id)
    if base is None:
        return tagged
    by_series: dict[str, DicomSeriesMeta] = {
        s.series_instance_uid: deepcopy(s) for s in base.series
    }
    for ser in tagged.series:
        existing = by_series.get(ser.series_instance_uid)
        if existing is None:
            by_series[ser.series_instance_uid] = ser
            continue
        first_by_sop: dict[str, DicomInstanceMeta] = {
            i.sop_instance_uid: i for i in existing.instances
        }
        seen_effective = {i.sop_instance_uid for i in existing.instances}
        merged_inst = list(existing.instances)
        for index, inst in enumerate(ser.instances):
            sop = inst.sop_instance_uid
            prior = first_by_sop.get(sop)
            if prior is None and sop not in seen_effective:
                merged_inst.append(inst)
                first_by_sop[sop] = inst
                seen_effective.add(sop)
                continue
            if prior is None:
                # Effective UID collision with a previously minted id — treat as new only
                # when fingerprint differs from any kept instance sharing this SOP string.
                prior = next(
                    (i for i in merged_inst if i.sop_instance_uid == sop),
                    merged_inst[0],
                )
            if _slice_fingerprint(prior) != _slice_fingerprint(inst):
                minted = _mint_disambiguated_sop(sop, inst, index)
                suffix = 2
                while minted in seen_effective:
                    minted = f"{_mint_disambiguated_sop(sop, inst, index)}.{suffix}"
                    suffix += 1
                fixed = inst.model_copy(update={"sop_instance_uid": minted})
                merged_inst.append(fixed)
                seen_effective.add(minted)
                continue
            # True duplicate (same SOP + same slice fingerprint): keep first only.
        by_series[ser.series_instance_uid] = existing.model_copy(update={"instances": merged_inst})
    study_uid = base.study_instance_uid or tagged.study_instance_uid
    return base.model_copy(
        update={
            "study_instance_uid": study_uid,
            "series": list(by_series.values()),
        }
    )


def linked_dicom_ingest_ids(case: CaseRecord) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    if case.dicom_ingest_id:
        ordered.append(case.dicom_ingest_id)
        seen.add(case.dicom_ingest_id)
    for att in case.attachment_refs or []:
        if isinstance(att, AttachmentRef) and att.kind == "dicom" and att.ingest_id not in seen:
            ordered.append(att.ingest_id)
            seen.add(att.ingest_id)
    return ordered


def merge_case_dicom_attachments(case: CaseRecord, repo: _IngestLookup) -> CaseRecord:
    """Load study metadata from every linked DICOM ingest and merge onto case.dicom_study."""
    study = case.dicom_study
    for ingest_id in linked_dicom_ingest_ids(case):
        record = repo.get_ingestion(ingest_id)
        if record is None or record.study is None:
            continue
        study = merge_study_into(study, record.study, ingest_id=ingest_id)
    if study is not None:
        case.dicom_study = study
        if case.study.study_instance_uid is None and study.study_instance_uid:
            case.study.study_instance_uid = study.study_instance_uid
        case.study.series_count = study.series_count
        case.study.instance_count = study.instance_count
        case.study.dicom_available = study.instance_count > 0
    return case
