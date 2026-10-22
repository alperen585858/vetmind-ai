"""Validate multi-file DICOM uploads into a single Study → Series → Instance tree."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.dicom.parser import ParsedInstance
from app.schemas.dicom import (
    DicomInstanceMeta,
    DicomSeriesMeta,
    DicomStudyMeta,
    DicomValidationIssue,
)
from app.schemas.enums import DicomValidationCode, DicomValidationSeverity, Modality


@dataclass
class ValidationResult:
    study: DicomStudyMeta | None = None
    issues: list[DicomValidationIssue] = field(default_factory=list)
    blocked: bool = False
    block_reason: str | None = None

    @property
    def error_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == DicomValidationSeverity.ERROR)


def _error(
    code: DicomValidationCode,
    message: str,
    *,
    filename: str | None = None,
    sop: str | None = None,
) -> DicomValidationIssue:
    return DicomValidationIssue(
        code=code,
        severity=DicomValidationSeverity.ERROR,
        message=message,
        filename=filename,
        sop_instance_uid=sop,
    )


def _warning(
    code: DicomValidationCode,
    message: str,
    *,
    filename: str | None = None,
    sop: str | None = None,
) -> DicomValidationIssue:
    return DicomValidationIssue(
        code=code,
        severity=DicomValidationSeverity.WARNING,
        message=message,
        filename=filename,
        sop_instance_uid=sop,
    )


def validate_parsed_instances(parsed: list[ParsedInstance]) -> ValidationResult:
    issues: list[DicomValidationIssue] = []

    if not parsed:
        issues.append(
            _error(DicomValidationCode.EMPTY_UPLOAD, "No files were uploaded.")
        )
        return ValidationResult(blocked=True, block_reason="Empty upload.", issues=issues)

    usable: list[ParsedInstance] = []
    for item in parsed:
        if item.malformed:
            issues.append(
                _error(
                    DicomValidationCode.MALFORMED,
                    item.error_message or "Malformed DICOM file.",
                    filename=item.filename,
                )
            )
            continue
        usable.append(item)

    if not usable:
        return ValidationResult(
            blocked=True,
            block_reason="All uploaded files failed DICOM parsing.",
            issues=issues,
        )

    for item in usable:
        if not item.study_instance_uid:
            issues.append(
                _error(
                    DicomValidationCode.MISSING_STUDY_UID,
                    "Missing StudyInstanceUID.",
                    filename=item.filename,
                    sop=item.sop_instance_uid,
                )
            )
        if not item.series_instance_uid:
            issues.append(
                _error(
                    DicomValidationCode.MISSING_SERIES_UID,
                    "Missing SeriesInstanceUID.",
                    filename=item.filename,
                    sop=item.sop_instance_uid,
                )
            )
        if not item.sop_instance_uid:
            issues.append(
                _error(
                    DicomValidationCode.MISSING_SOP_UID,
                    "Missing SOPInstanceUID.",
                    filename=item.filename,
                )
            )
        if item.has_pixel_data:
            issues.append(
                _warning(
                    DicomValidationCode.PIXEL_DATA_PRESENT_IGNORED,
                    "Pixel data tag present; ignored for diagnosis (metadata-only pipeline).",
                    filename=item.filename,
                    sop=item.sop_instance_uid,
                )
            )

    # Drop instances missing required UIDs from hierarchy assembly.
    complete = [
        i
        for i in usable
        if i.study_instance_uid and i.series_instance_uid and i.sop_instance_uid
    ]
    if not complete:
        return ValidationResult(
            blocked=True,
            block_reason="No instances with complete Study/Series/SOP UIDs.",
            issues=issues,
        )

    study_uids = {i.study_instance_uid for i in complete}
    if len(study_uids) > 1:
        issues.append(
            _error(
                DicomValidationCode.INCONSISTENT_STUDY,
                f"Upload spans {len(study_uids)} distinct StudyInstanceUID values; one study per upload required.",
            )
        )
        return ValidationResult(
            blocked=True,
            block_reason="Inconsistent StudyInstanceUID across files.",
            issues=issues,
        )

    seen_sops: dict[str, str] = {}
    deduped: list[ParsedInstance] = []
    for item in complete:
        assert item.sop_instance_uid is not None
        prior = seen_sops.get(item.sop_instance_uid)
        if prior is not None:
            # Soft-dedupe: keep first instance, warn (not hard-fail) so upload can continue.
            issues.append(
                _warning(
                    DicomValidationCode.DUPLICATE_SOP,
                    f"Duplicate SOPInstanceUID dropped (kept '{prior}').",
                    filename=item.filename,
                    sop=item.sop_instance_uid,
                )
            )
            continue
        seen_sops[item.sop_instance_uid] = item.filename
        deduped.append(item)

    if not deduped:
        return ValidationResult(
            blocked=True,
            block_reason="All instances were duplicates.",
            issues=issues,
        )

    _supported_mods = {Modality.MR, Modality.CT, Modality.XR}
    modalities = {i.modality for i in deduped if i.modality is not None}
    if Modality.OTHER in modalities:
        issues.append(
            _error(
                DicomValidationCode.UNSUPPORTED_MODALITY,
                "Upload includes unsupported modality values (only MR/CT/XR are accepted for routing).",
            )
        )
    if len({m for m in modalities if m in _supported_mods}) > 1:
        issues.append(
            _warning(
                DicomValidationCode.MIXED_MODALITY,
                "Multiple supported modalities found in one study; classification may need confirmation.",
            )
        )

    # Block if every instance is unsupported modality.
    supported = [i for i in deduped if i.modality in _supported_mods]
    if not supported and any(i.modality == Modality.OTHER for i in deduped):
        return ValidationResult(
            blocked=True,
            block_reason="Unsupported modality only; cannot route to imaging models.",
            issues=issues,
            study=_build_study(deduped),
        )

    # Soft-block when required UID errors remain on some files but we still have a study.
    hard_codes = {
        DicomValidationCode.INCONSISTENT_STUDY,
        DicomValidationCode.EMPTY_UPLOAD,
    }
    if any(i.code in hard_codes and i.severity == DicomValidationSeverity.ERROR for i in issues):
        return ValidationResult(blocked=True, block_reason="Hard validation failure.", issues=issues)

    if any(
        i.code == DicomValidationCode.UNSUPPORTED_MODALITY
        and i.severity == DicomValidationSeverity.ERROR
        for i in issues
    ) and not supported:
        return ValidationResult(
            blocked=True,
            block_reason="Unsupported modality.",
            issues=issues,
            study=_build_study(deduped),
        )

    # Duplicate SOP is an error but we already dropped dupes; allow continue with warning-level block=False.
    study = _build_study(deduped)
    return ValidationResult(study=study, issues=issues, blocked=False)


def _build_study(instances: list[ParsedInstance]) -> DicomStudyMeta:
    first = instances[0]
    series_map: dict[str, DicomSeriesMeta] = {}
    for item in instances:
        assert item.series_instance_uid is not None
        assert item.sop_instance_uid is not None
        series = series_map.get(item.series_instance_uid)
        if series is None:
            series = DicomSeriesMeta(
                series_instance_uid=item.series_instance_uid,
                series_number=item.series_number,
                modality=item.modality,
                series_description=item.series_description,
                body_part_examined=item.body_part_examined,
                instances=[],
            )
            series_map[item.series_instance_uid] = series
        series.instances.append(
            DicomInstanceMeta(
                sop_instance_uid=item.sop_instance_uid,
                instance_number=item.instance_number,
                filename=item.filename,
                transfer_syntax_uid=item.transfer_syntax_uid,
                rows=item.rows,
                columns=item.columns,
                pixel_spacing=item.pixel_spacing,
                slice_thickness=item.slice_thickness,
                image_orientation_patient=item.image_orientation_patient,
                image_position_patient=item.image_position_patient,
                has_pixel_data=item.has_pixel_data,
                pixel_data_analyzed=False,
            )
        )

    return DicomStudyMeta(
        study_instance_uid=first.study_instance_uid or "unknown",
        study_description=first.study_description,
        accession_number=first.accession_number,
        study_date=first.study_date,
        patient_id_synthetic=first.patient_id,
        patient_name_from_dicom=first.patient_name,
        series=list(series_map.values()),
    )
