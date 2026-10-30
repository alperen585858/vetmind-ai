"""Pixel decode opt-in gate on metadata prep."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.dicom.fixtures import build_synthetic_instance
from app.imaging.metadata_prep import MetadataOnlyPreparationPipeline
from app.imaging.profiles import profile_for_modality
from app.routing.capabilities import ModelCapability, INPUT_PIXELS_2D
from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta
from app.schemas.enums import AnatomicalRegion, Modality, SourceKind, Species
from app.schemas.findings import StudyInfo
from app.storage.quarantine import QuarantineStore


def _pixel_cap() -> ModelCapability:
    return ModelCapability(
        model_id="future-xr-pixel",
        modalities=frozenset({Modality.XR}),
        regions=frozenset({AnatomicalRegion.THORAX}),
        source_kind=SourceKind.REAL,
        allows_pixel_analysis=True,
        input_requirements=frozenset({INPUT_PIXELS_2D}),
        preprocessing_contract_id="profile.xray_2d",
    )


def test_pixel_decode_denied_without_opt_in(tmp_path: Path) -> None:
    cap = _pixel_cap()
    q = QuarantineStore(tmp_path / "q")
    raw = build_synthetic_instance(include_pixels=True)
    refs = q.store_files("ing-1", [("0000.dcm", raw)])
    rel = refs[0].relative_path
    case = CaseRecord(
        case_id="c-opt",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.XR,
        anatomical_region=AnatomicalRegion.THORAX,
        classification_confirmed=True,
        imaging_source_permission_verified=True,
        imaging_analysis_consent_verified=True,
        dicom_ingest_id="ing-1",
        study=StudyInfo(dicom_available=True),
        dicom_study=DicomStudyMeta(
            study_instance_uid="1.2.3",
            series=[
                DicomSeriesMeta(
                    series_instance_uid="1.2.3.4",
                    modality=Modality.XR,
                    instances=[
                        DicomInstanceMeta(
                            sop_instance_uid="1.2.3.4.5",
                            has_pixel_data=True,
                            quarantine_relative_path=rel,
                        )
                    ],
                )
            ],
        ),
    )
    pipeline = MetadataOnlyPreparationPipeline(
        capabilities=[cap],
        pixel_analysis_opt_in=False,
        quarantine_root=tmp_path / "q",
    )
    contract = profile_for_modality(Modality.XR, cap.model_id)
    with pytest.raises(Exception, match="opt-in|denied|Pixel"):
        pipeline.prepare(case=case, contract=contract)


def test_pixel_decode_allowed_with_opt_in(tmp_path: Path) -> None:
    cap = _pixel_cap()
    q = QuarantineStore(tmp_path / "q")
    raw = build_synthetic_instance(include_pixels=True)
    refs = q.store_files("ing-2", [("0000.dcm", raw)])
    rel = refs[0].relative_path
    case = CaseRecord(
        case_id="c-opt2",
        patient_name="P",
        species=Species.CANINE,
        modality=Modality.XR,
        anatomical_region=AnatomicalRegion.THORAX,
        classification_confirmed=True,
        imaging_source_permission_verified=True,
        imaging_analysis_consent_verified=True,
        dicom_ingest_id="ing-2",
        study=StudyInfo(dicom_available=True),
        dicom_study=DicomStudyMeta(
            study_instance_uid="1.2.3",
            series=[
                DicomSeriesMeta(
                    series_instance_uid="1.2.3.4",
                    modality=Modality.XR,
                    instances=[
                        DicomInstanceMeta(
                            sop_instance_uid="1.2.3.4.5",
                            has_pixel_data=True,
                            quarantine_relative_path=rel,
                            transfer_syntax_uid="1.2.840.10008.1.2.1",
                        )
                    ],
                )
            ],
        ),
    )
    pipeline = MetadataOnlyPreparationPipeline(
        capabilities=[cap],
        pixel_analysis_opt_in=True,
        quarantine_root=tmp_path / "q",
    )
    contract = profile_for_modality(Modality.XR, cap.model_id)
    mi = pipeline.prepare(case=case, contract=contract)
    assert mi.metadata_only is False
    assert any(f.pixel_tensor_ready for s in mi.series for f in s.frames)
