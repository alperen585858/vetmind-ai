"""Metadata-based modality / anatomical-region classification with explicit uncertainty."""

from __future__ import annotations

from app.schemas.dicom import ClassificationSuggestion, DicomStudyMeta
from app.schemas.enums import AnatomicalRegion, ClassificationConfidence, Modality

_BRAIN_TOKENS = (
    "BRAIN",
    "HEAD",
    "CRANIAL",
    "CRANIUM",
    "INTRACRANIAL",
    "CEREBR",
    "SKULL",
)
_CERVICAL_TOKENS = (
    "CERVICAL",
    "C-SPINE",
    "CSPINE",
    "C SPINE",
    "NECK",
    "CERVIX",  # rare misuse; still flagged low-confidence
    "C1",
    "C2",
    "C3",
    "C4",
    "C5",
    "C6",
    "C7",
)


def _haystack(study: DicomStudyMeta) -> tuple[str, dict[str, str | None]]:
    parts: list[str] = []
    tags: dict[str, str | None] = {
        "StudyDescription": study.study_description,
    }
    if study.study_description:
        parts.append(study.study_description)
    body_parts: list[str] = []
    series_descs: list[str] = []
    for series in study.series:
        if series.body_part_examined:
            body_parts.append(series.body_part_examined)
            parts.append(series.body_part_examined)
        if series.series_description:
            series_descs.append(series.series_description)
            parts.append(series.series_description)
    tags["BodyPartExamined"] = "; ".join(body_parts) if body_parts else None
    tags["SeriesDescription"] = "; ".join(series_descs) if series_descs else None
    return " ".join(parts).upper(), tags


def _contains_any(text: str, tokens: tuple[str, ...]) -> list[str]:
    return [t for t in tokens if t in text]


def classify_study(study: DicomStudyMeta) -> ClassificationSuggestion:
    rationale: list[str] = []
    text, source_tags = _haystack(study)

    modalities = [s.modality for s in study.series if s.modality is not None]
    if not modalities:
        suggested_modality = Modality.OTHER
        rationale.append("No Modality tag found on series; defaulting to OTHER.")
        modality_confidence = ClassificationConfidence.UNKNOWN
    else:
        # Prefer MR/CT majority; fall back to first.
        supported = [m for m in modalities if m in {Modality.MR, Modality.CT}]
        if supported:
            suggested_modality = max(set(supported), key=supported.count)
            rationale.append(f"Modality derived from DICOM Modality tag(s): {suggested_modality.value}.")
            modality_confidence = (
                ClassificationConfidence.HIGH
                if len(set(supported)) == 1
                else ClassificationConfidence.MEDIUM
            )
        else:
            suggested_modality = Modality.OTHER
            rationale.append("Only unsupported modalities present.")
            modality_confidence = ClassificationConfidence.LOW

    brain_hits = _contains_any(text, _BRAIN_TOKENS)
    cervical_hits = _contains_any(text, _CERVICAL_TOKENS)

    if brain_hits and not cervical_hits:
        region = AnatomicalRegion.BRAIN
        region_confidence = (
            ClassificationConfidence.HIGH
            if any(t in {"BRAIN", "CRANIAL", "INTRACRANIAL"} for t in brain_hits)
            else ClassificationConfidence.MEDIUM
        )
        rationale.append(f"Anatomical region tokens suggesting BRAIN: {', '.join(brain_hits)}.")
    elif cervical_hits and not brain_hits:
        region = AnatomicalRegion.CERVICAL
        region_confidence = (
            ClassificationConfidence.HIGH
            if any(t in {"CERVICAL", "C-SPINE", "CSPINE"} for t in cervical_hits)
            else ClassificationConfidence.MEDIUM
        )
        rationale.append(f"Anatomical region tokens suggesting CERVICAL: {', '.join(cervical_hits)}.")
    elif brain_hits and cervical_hits:
        region = AnatomicalRegion.UNKNOWN
        region_confidence = ClassificationConfidence.LOW
        rationale.append(
            f"Ambiguous region tokens (brain={brain_hits}, cervical={cervical_hits}); requires confirmation."
        )
    elif text.strip():
        region = AnatomicalRegion.OTHER
        region_confidence = ClassificationConfidence.LOW
        rationale.append("Descriptive tags present but no brain/cervical tokens matched.")
    else:
        region = AnatomicalRegion.UNKNOWN
        region_confidence = ClassificationConfidence.UNKNOWN
        rationale.append("No StudyDescription / SeriesDescription / BodyPartExamined text available.")

    # Overall confidence is the weaker of modality vs region signals.
    order = [
        ClassificationConfidence.UNKNOWN,
        ClassificationConfidence.LOW,
        ClassificationConfidence.MEDIUM,
        ClassificationConfidence.HIGH,
    ]
    confidence = min(modality_confidence, region_confidence, key=lambda c: order.index(c))
    needs_confirmation = confidence in {
        ClassificationConfidence.UNKNOWN,
        ClassificationConfidence.LOW,
        ClassificationConfidence.MEDIUM,
    } or region in {AnatomicalRegion.UNKNOWN, AnatomicalRegion.OTHER}

    if suggested_modality == Modality.OTHER:
        needs_confirmation = True

    return ClassificationSuggestion(
        suggested_modality=suggested_modality,
        suggested_anatomical_region=region,
        confidence=confidence,
        needs_confirmation=needs_confirmation,
        rationale=rationale,
        source_tags=source_tags,
    )
