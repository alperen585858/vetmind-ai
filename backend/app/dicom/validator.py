"""Validate multi-file DICOM uploads into a single Study → Series → Instance tree."""

from __future__ import annotations

from dataclasses import dataclass, field, replace

from app.dicom.parser import ParsedInstance
from app.schemas.dicom import (
    DicomInstanceMeta,
    DicomSeriesMeta,
    DicomStudyMeta,
    DicomValidationIssue,
)
from app.schemas.enums import DicomValidationCode, DicomValidationSeverity, Modality


def _slice_fingerprint(item: ParsedInstance) -> tuple:
    """Identity used to tell true duplicates from colliding-SOP distinct slices.

    Some PACS/export tools stamp the same SOPInstanceUID on every frame of a
    series while InstanceNumber / ImagePositionPatient / pixels still differ.
    Those must be kept for multi-slice analysis.

    Filename is only a last-resort discriminator when spatial tags are absent —
    otherwise a renamed byte-identical copy would be treated as a new slice.
    """
    if item.instance_number is not None or item.image_position_patient is not None:
        return (
            item.instance_number,
            item.image_position_patient,
            item.rows,
            item.columns,
        )
    return (
        None,
        None,
        item.rows,
        item.columns,
        item.filename,
    )


def _is_distinct_colliding_slice(prior: ParsedInstance, item: ParsedInstance) -> bool:
    """True when SOP collides but the file is clearly another frame/slice."""
    return _slice_fingerprint(prior) != _slice_fingerprint(item)


def _mint_disambiguated_sop(original: str, item: ParsedInstance, index: int) -> str:
    """Mint a unique study-tree SOP while preserving DICOM UID character set."""
    inst = item.instance_number if item.instance_number is not None else index + 1
    # Digits-only suffix from filename keeps UID legal if InstanceNumber collides.
    digits = "".join(ch for ch in (item.filename or "") if ch.isdigit())[-8:] or str(index + 1)
    return f"{original}.{inst}.{digits}"


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
        # Incomplete instances are excluded from the study tree. Emit WARNING (advisory)
        # so confirm gating stays on ValidationResult.blocked (not "any ERROR").
        if not item.study_instance_uid:
            issues.append(
                _warning(
                    DicomValidationCode.MISSING_STUDY_UID,
                    "Missing StudyInstanceUID; instance excluded from study tree.",
                    filename=item.filename,
                    sop=item.sop_instance_uid,
                )
            )
        if not item.series_instance_uid:
            issues.append(
                _warning(
                    DicomValidationCode.MISSING_SERIES_UID,
                    "Missing SeriesInstanceUID; instance excluded from study tree.",
                    filename=item.filename,
                    sop=item.sop_instance_uid,
                )
            )
        if not item.sop_instance_uid:
            issues.append(
                _warning(
                    DicomValidationCode.MISSING_SOP_UID,
                    "Missing SOPInstanceUID; instance excluded from study tree.",
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
        # Promote incomplete-UID warnings to hard block when nothing usable remains.
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

    # Soft-dedupe true duplicates; keep distinct slices that share a broken SOP UID.
    first_by_sop: dict[str, ParsedInstance] = {}
    seen_effective: set[str] = set()
    deduped: list[ParsedInstance] = []
    for index, item in enumerate(complete):
        assert item.sop_instance_uid is not None
        original_sop = item.sop_instance_uid
        prior = first_by_sop.get(original_sop)
        if prior is None:
            first_by_sop[original_sop] = item
            seen_effective.add(original_sop)
            deduped.append(item)
            continue

        if _is_distinct_colliding_slice(prior, item):
            minted = _mint_disambiguated_sop(original_sop, item, index)
            # Extremely defensive: ensure uniqueness if mint collides.
            suffix = 2
            while minted in seen_effective:
                minted = f"{_mint_disambiguated_sop(original_sop, item, index)}.{suffix}"
                suffix += 1
            issues.append(
                _warning(
                    DicomValidationCode.DUPLICATE_SOP,
                    (
                        "Duplicate SOPInstanceUID on a distinct slice; kept "
                        f"'{item.filename}' with disambiguated UID "
                        f"(original {original_sop})."
                    ),
                    filename=item.filename,
                    sop=original_sop,
                )
            )
            extras = dict(item.extras or {})
            extras["original_sop_instance_uid"] = original_sop
            fixed = replace(item, sop_instance_uid=minted, extras=extras)
            seen_effective.add(minted)
            deduped.append(fixed)
            continue

        # True duplicate (same SOP + same slice fingerprint): keep first only.
        issues.append(
            _warning(
                DicomValidationCode.DUPLICATE_SOP,
                f"Duplicate SOPInstanceUID dropped (kept '{prior.filename}').",
                filename=item.filename,
                sop=original_sop,
            )
        )

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
                "Upload includes unsupported modality values (MR/CT/XR and CR/DX/DR→XR are accepted for routing).",
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
    from app.imaging.pixel_ops import slice_sort_key

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

    ordered_series: list[DicomSeriesMeta] = []
    for series in series_map.values():
        sorted_instances = sorted(
            series.instances,
            key=lambda inst: slice_sort_key(
                image_position_patient=inst.image_position_patient,
                instance_number=inst.instance_number,
                sop_instance_uid=inst.sop_instance_uid,
            ),
        )
        ordered_series.append(series.model_copy(update={"instances": sorted_instances}))
    ordered_series.sort(
        key=lambda s: (
            s.series_number is None,
            s.series_number if s.series_number is not None else 0,
            s.series_instance_uid,
        )
    )

    return DicomStudyMeta(
        study_instance_uid=first.study_instance_uid or "unknown",
        study_description=first.study_description,
        accession_number=first.accession_number,
        study_date=first.study_date,
        patient_id_synthetic=first.patient_id,
        patient_name_from_dicom=first.patient_name,
        series=ordered_series,
    )
