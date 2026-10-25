"""ISS-CLS-01 — hybrid classification signals + disagreement."""

from __future__ import annotations

from app.dicom.classifier import classify_study
from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta
from app.schemas.enums import AnatomicalRegion, ClassificationConfidence, Modality


def _study(*, modality: Modality, study_desc: str, series_desc: str) -> DicomStudyMeta:
    return DicomStudyMeta(
        study_instance_uid="1.2.3.study",
        study_description=study_desc,
        series=[
            DicomSeriesMeta(
                series_instance_uid="1.2.3.series",
                modality=modality,
                series_description=series_desc,
                body_part_examined=None,
                instances=[
                    DicomInstanceMeta(
                        sop_instance_uid="1.2.3.sop",
                        filename="x.dcm",
                        has_pixel_data=False,
                        pixel_data_analyzed=False,
                    )
                ],
            )
        ],
    )


def test_hybrid_exposes_two_signals() -> None:
    suggestion = classify_study(
        _study(modality=Modality.MR, study_desc="Brain MRI", series_desc="T1 AX BRAIN")
    )
    names = [s.name for s in suggestion.signals]
    assert names == ["metadata_rules", "series_hint"]
    assert suggestion.disagreement is False
    assert suggestion.suggested_anatomical_region == AnatomicalRegion.BRAIN


def test_hybrid_disagreement_forces_low_and_confirm() -> None:
    # Metadata says BRAIN (StudyDescription); series_hint sees CERVICAL protocol tokens.
    suggestion = classify_study(
        _study(
            modality=Modality.MR,
            study_desc="Brain MRI canine",
            series_desc="SAG C SPINE T2",
        )
    )
    assert suggestion.disagreement is True
    assert suggestion.confidence == ClassificationConfidence.LOW
    assert suggestion.needs_confirmation is True
    assert any("Hybrid disagreement" in r for r in suggestion.rationale)
