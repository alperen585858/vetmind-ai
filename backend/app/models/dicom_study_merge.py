"""Merge multi-ingest DICOM study metadata onto a case for AI packaging."""

from __future__ import annotations

from copy import deepcopy
from typing import Protocol

from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomIngestionRecord, DicomSeriesMeta, DicomStudyMeta
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


def merge_study_into(
    base: DicomStudyMeta | None,
    extra: DicomStudyMeta,
    *,
    ingest_id: str,
) -> DicomStudyMeta:
    """Union series/instances; dedupe by series_instance_uid + sop_instance_uid."""
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
        seen_sop = {i.sop_instance_uid for i in existing.instances}
        merged_inst = list(existing.instances)
        for inst in ser.instances:
            if inst.sop_instance_uid not in seen_sop:
                merged_inst.append(inst)
                seen_sop.add(inst.sop_instance_uid)
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
