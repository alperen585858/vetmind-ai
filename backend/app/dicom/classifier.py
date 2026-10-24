"""Metadata-based modality / anatomical-region classification with explicit uncertainty.

No LLM. Missing values are never invented. Ambiguous / conflicting / unsupported
outcomes always require human confirmation (or block automated routing).
"""

from __future__ import annotations

from app.schemas.dicom import ClassificationSuggestion, DicomStudyMeta
from app.schemas.enums import (
    AnatomicalRegion,
    ClassificationConfidence,
    ClassificationStatus,
    Modality,
    Species,
)

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
_THORAX_TOKENS = (
    "THORAX",
    "THORACIC",
    "CHEST",
    "LUNG",
    "PULMON",
    "CARDIAC",
    "HEART",
)

_CANINE_TOKENS = ("CANINE", "CANIS", "DOG")
_FELINE_TOKENS = ("FELINE", "FELIS", "CAT")

_SUPPORTED_MODALITIES = frozenset({Modality.MR, Modality.CT, Modality.XR})

_CONF_ORDER = [
    ClassificationConfidence.UNKNOWN,
    ClassificationConfidence.LOW,
    ClassificationConfidence.MEDIUM,
    ClassificationConfidence.HIGH,
]


def _haystack(study: DicomStudyMeta) -> tuple[str, dict[str, str | None]]:
    parts: list[str] = []
    tags: dict[str, str | None] = {
        "StudyDescription": study.study_description,
    }
    if study.study_description:
        parts.append(study.study_description)
    body_parts: list[str] = []
    series_descs: list[str] = []
    modality_raw: list[str] = []
    for series in study.series:
        if series.modality is not None:
            modality_raw.append(series.modality.value)
        if series.body_part_examined:
            body_parts.append(series.body_part_examined)
            parts.append(series.body_part_examined)
        if series.series_description:
            series_descs.append(series.series_description)
            parts.append(series.series_description)
    tags["BodyPartExamined"] = "; ".join(body_parts) if body_parts else None
    tags["SeriesDescription"] = "; ".join(series_descs) if series_descs else None
    tags["Modality"] = "; ".join(modality_raw) if modality_raw else None
    if study.patient_name_from_dicom:
        parts.append(study.patient_name_from_dicom)
        tags["PatientName"] = study.patient_name_from_dicom
    else:
        tags["PatientName"] = None
    return " ".join(parts).upper(), tags


def _contains_any(text: str, tokens: tuple[str, ...]) -> list[str]:
    return [t for t in tokens if t in text]


def _min_confidence(*values: ClassificationConfidence) -> ClassificationConfidence:
    return min(values, key=lambda c: _CONF_ORDER.index(c))


def _suggest_species(text: str, rationale: list[str]) -> tuple[Species | None, ClassificationConfidence]:
    """Suggest species only when DICOM text has a clear canine XOR feline signal."""
    canine = _contains_any(text, _CANINE_TOKENS)
    feline = _contains_any(text, _FELINE_TOKENS)
    if canine and feline:
        rationale.append(
            f"Conflicting species tokens (canine={canine}, feline={feline}); species left unset."
        )
        return None, ClassificationConfidence.UNKNOWN
    if canine:
        rationale.append(f"Species tokens suggesting canine: {', '.join(canine)}.")
        return Species.CANINE, ClassificationConfidence.MEDIUM
    if feline:
        rationale.append(f"Species tokens suggesting feline: {', '.join(feline)}.")
        return Species.FELINE, ClassificationConfidence.MEDIUM
    rationale.append("No reliable species tokens in DICOM metadata; species not invented.")
    return None, ClassificationConfidence.UNKNOWN


def classify_study(study: DicomStudyMeta) -> ClassificationSuggestion:
    rationale: list[str] = []
    text, source_tags = _haystack(study)

    modalities = [s.modality for s in study.series if s.modality is not None]
    mixed_supported = False
    if not modalities:
        suggested_modality = Modality.OTHER
        rationale.append("No Modality tag found on series; defaulting to OTHER.")
        modality_confidence = ClassificationConfidence.UNKNOWN
        modality_status = ClassificationStatus.MISSING_METADATA
    else:
        supported = [m for m in modalities if m in _SUPPORTED_MODALITIES]
        unsupported = [m for m in modalities if m == Modality.OTHER]
        unique_supported = list(dict.fromkeys(supported))
        if len(unique_supported) > 1:
            mixed_supported = True
            suggested_modality = max(set(supported), key=supported.count)
            rationale.append(
                f"Conflicting supported modalities in one study: "
                f"{[m.value for m in unique_supported]}; dominant={suggested_modality.value}."
            )
            modality_confidence = ClassificationConfidence.LOW
            modality_status = ClassificationStatus.CONFLICTING
        elif supported:
            suggested_modality = unique_supported[0]
            rationale.append(
                f"Modality derived from DICOM Modality tag(s): {suggested_modality.value}."
            )
            modality_confidence = ClassificationConfidence.HIGH
            modality_status = ClassificationStatus.READY
        else:
            suggested_modality = Modality.OTHER
            rationale.append(
                f"Only unsupported modalities present: {[m.value for m in unsupported] or ['unknown']}."
            )
            modality_confidence = ClassificationConfidence.LOW
            modality_status = ClassificationStatus.UNSUPPORTED

    brain_hits = _contains_any(text, _BRAIN_TOKENS)
    cervical_hits = _contains_any(text, _CERVICAL_TOKENS)
    thorax_hits = _contains_any(text, _THORAX_TOKENS)

    hit_groups = [
        (brain_hits, AnatomicalRegion.BRAIN, ("BRAIN", "CRANIAL", "INTRACRANIAL")),
        (cervical_hits, AnatomicalRegion.CERVICAL, ("CERVICAL", "C-SPINE", "CSPINE")),
        (thorax_hits, AnatomicalRegion.THORAX, ("THORAX", "THORACIC", "CHEST", "LUNG")),
    ]
    non_empty = [(hits, region, strong) for hits, region, strong in hit_groups if hits]

    region_status = ClassificationStatus.READY
    if len(non_empty) == 1:
        hits, region, strong = non_empty[0]
        region_confidence = (
            ClassificationConfidence.HIGH
            if any(t in strong for t in hits)
            else ClassificationConfidence.MEDIUM
        )
        rationale.append(f"Anatomical region tokens suggesting {region.value}: {', '.join(hits)}.")
    elif len(non_empty) > 1:
        region = AnatomicalRegion.UNKNOWN
        region_confidence = ClassificationConfidence.LOW
        detail = ", ".join(f"{r.value}={hits}" for hits, r, _ in non_empty)
        rationale.append(f"Ambiguous region tokens ({detail}); requires confirmation.")
        region_status = ClassificationStatus.AMBIGUOUS
    elif text.strip():
        region = AnatomicalRegion.OTHER
        region_confidence = ClassificationConfidence.LOW
        rationale.append("Descriptive tags present but no brain/cervical/thorax tokens matched.")
        region_status = ClassificationStatus.UNSUPPORTED
    else:
        region = AnatomicalRegion.UNKNOWN
        region_confidence = ClassificationConfidence.UNKNOWN
        rationale.append("No StudyDescription / SeriesDescription / BodyPartExamined text available.")
        region_status = ClassificationStatus.MISSING_METADATA

    # XR studies default toward THORAX when region unknown but modality is clear —
    # still low confidence and always needs confirmation (never invents a clinical claim).
    if suggested_modality == Modality.XR and region in {
        AnatomicalRegion.UNKNOWN,
        AnatomicalRegion.OTHER,
    }:
        if not thorax_hits and not brain_hits and not cervical_hits:
            region = AnatomicalRegion.THORAX
            region_confidence = ClassificationConfidence.LOW
            region_status = ClassificationStatus.AMBIGUOUS
            rationale.append(
                "XR modality without strong region tokens; defaulting to THORAX (needs confirmation)."
            )

    suggested_species, species_confidence = _suggest_species(text, rationale)

    confidence = _min_confidence(modality_confidence, region_confidence)

    # Overall status precedence: unsupported/missing/conflicting/ambiguous over ready.
    if modality_status == ClassificationStatus.UNSUPPORTED or (
        suggested_modality == Modality.OTHER and region_status == ClassificationStatus.UNSUPPORTED
    ):
        status = ClassificationStatus.UNSUPPORTED
    elif modality_status == ClassificationStatus.MISSING_METADATA and region_status in {
        ClassificationStatus.MISSING_METADATA,
        ClassificationStatus.AMBIGUOUS,
    }:
        status = ClassificationStatus.MISSING_METADATA
    elif mixed_supported or modality_status == ClassificationStatus.CONFLICTING:
        status = ClassificationStatus.CONFLICTING
    elif region_status == ClassificationStatus.AMBIGUOUS:
        status = ClassificationStatus.AMBIGUOUS
    elif region_status == ClassificationStatus.MISSING_METADATA:
        status = ClassificationStatus.MISSING_METADATA
    elif region_status == ClassificationStatus.UNSUPPORTED:
        status = ClassificationStatus.UNSUPPORTED
    else:
        status = ClassificationStatus.READY

    needs_confirmation = (
        status
        in {
            ClassificationStatus.AMBIGUOUS,
            ClassificationStatus.UNSUPPORTED,
            ClassificationStatus.MISSING_METADATA,
            ClassificationStatus.CONFLICTING,
        }
        or confidence
        in {
            ClassificationConfidence.UNKNOWN,
            ClassificationConfidence.LOW,
            ClassificationConfidence.MEDIUM,
        }
        or region in {AnatomicalRegion.UNKNOWN, AnatomicalRegion.OTHER}
        or suggested_modality == Modality.OTHER
    )

    return ClassificationSuggestion(
        suggested_modality=suggested_modality,
        suggested_anatomical_region=region,
        confidence=confidence,
        needs_confirmation=needs_confirmation,
        classification_status=status,
        suggested_species=suggested_species,
        species_confidence=species_confidence,
        rationale=rationale,
        source_tags=source_tags,
    )
