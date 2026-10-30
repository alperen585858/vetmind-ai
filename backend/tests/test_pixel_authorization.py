"""F10: pixel access authorization policy (default deny, no pixel loading)."""

from app.models.model_input_builder import build_imaging_model_input
from app.models.pixel_authorization import (
    AUTHORIZED_POLICY_ONLY,
    DENIED_CLASSIFICATION_UNCONFIRMED,
    DENIED_CONSENT_UNVERIFIED,
    DENIED_MOCK_ADAPTER,
    DENIED_MODEL_NOT_PIXEL_CAPABLE,
    DENIED_PIXEL_OPT_IN,
    DENIED_SOURCE_PERMISSION_UNVERIFIED,
    DENIED_STUDY_INTEGRITY,
    evaluate_pixel_access,
    summarize_pixel_authorization,
)
from app.routing.capabilities import ModelCapability, default_capabilities
from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta
from app.schemas.enums import AnatomicalRegion, Modality, SourceKind, Species
from app.schemas.findings import StudyInfo


def _dicom_case(**kwargs) -> CaseRecord:
    study_uid = "1.2.840.10008.1.2.1.100"
    series_uid = "1.2.840.10008.1.2.1.200"
    sop_uid = "1.2.840.10008.1.2.1.300"
    data = dict(
        case_id="case-pix",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        classification_confirmed=True,
        imaging_source_permission_verified=False,
        imaging_analysis_consent_verified=False,
        study=StudyInfo(study_instance_uid=study_uid, dicom_available=True),
        dicom_study=DicomStudyMeta(
            study_instance_uid=study_uid,
            series=[
                DicomSeriesMeta(
                    series_instance_uid=series_uid,
                    modality=Modality.MR,
                    instances=[
                        DicomInstanceMeta(
                            sop_instance_uid=sop_uid,
                            instance_number=1,
                            filename="1.dcm",
                            has_pixel_data=True,
                        )
                    ],
                )
            ],
        ),
    )
    data.update(kwargs)
    return CaseRecord(**data)


def _future_pixel_cap() -> ModelCapability:
    return ModelCapability(
        model_id="future-pixel-brain-v1",
        modalities=frozenset({Modality.MR}),
        regions=frozenset({AnatomicalRegion.BRAIN}),
        species=frozenset({Species.CANINE, Species.FELINE}),
        priority=1,
        source_kind=SourceKind.REAL,
        allows_pixel_analysis=True,
        description="Test-only future pixel-capable model fixture",
    )


def test_mock_adapter_denied() -> None:
    case = _dicom_case(
        imaging_source_permission_verified=True,
        imaging_analysis_consent_verified=True,
    )
    mock_cap = next(c for c in default_capabilities() if c.model_id == "mock-brain-mri-v1")
    decision = evaluate_pixel_access(case, model_id=mock_cap.model_id, capability=mock_cap)
    assert decision.authorized is False
    assert DENIED_MOCK_ADAPTER in decision.reason_codes


def test_missing_permissions_denied() -> None:
    case = _dicom_case()
    cap = _future_pixel_cap()
    decision = evaluate_pixel_access(case, model_id=cap.model_id, capability=cap)
    assert decision.authorized is False
    assert DENIED_SOURCE_PERMISSION_UNVERIFIED in decision.reason_codes
    assert DENIED_CONSENT_UNVERIFIED in decision.reason_codes


def test_unconfirmed_classification_denied() -> None:
    case = _dicom_case(
        classification_confirmed=False,
        imaging_source_permission_verified=True,
        imaging_analysis_consent_verified=True,
    )
    cap = _future_pixel_cap()
    decision = evaluate_pixel_access(case, model_id=cap.model_id, capability=cap)
    assert decision.authorized is False
    assert DENIED_CLASSIFICATION_UNCONFIRMED in decision.reason_codes


def test_unsupported_model_denied() -> None:
    case = _dicom_case(
        imaging_source_permission_verified=True,
        imaging_analysis_consent_verified=True,
    )
    cap = ModelCapability(
        model_id="future-real-no-pixels",
        modalities=frozenset({Modality.MR}),
        regions=frozenset({AnatomicalRegion.BRAIN}),
        source_kind=SourceKind.REAL,
        allows_pixel_analysis=False,
    )
    decision = evaluate_pixel_access(case, model_id=cap.model_id, capability=cap)
    assert decision.authorized is False
    assert DENIED_MODEL_NOT_PIXEL_CAPABLE in decision.reason_codes


def test_study_integrity_denied_without_dicom() -> None:
    case = CaseRecord(
        case_id="case-nodicom",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        classification_confirmed=True,
        imaging_source_permission_verified=True,
        imaging_analysis_consent_verified=True,
    )
    cap = _future_pixel_cap()
    decision = evaluate_pixel_access(case, model_id=cap.model_id, capability=cap)
    assert decision.authorized is False
    assert DENIED_STUDY_INTEGRITY in decision.reason_codes


def test_pixel_opt_in_denied_without_env_flag() -> None:
    case = _dicom_case(
        imaging_source_permission_verified=True,
        imaging_analysis_consent_verified=True,
    )
    cap = _future_pixel_cap()
    decision = evaluate_pixel_access(case, model_id=cap.model_id, capability=cap)
    assert decision.authorized is False
    assert DENIED_PIXEL_OPT_IN in decision.reason_codes


def test_authorized_future_model_fixture_without_loading_pixels() -> None:
    case = _dicom_case(
        imaging_source_permission_verified=True,
        imaging_analysis_consent_verified=True,
    )
    caps = [_future_pixel_cap(), *default_capabilities()]
    pkg = build_imaging_model_input(case, capabilities=caps, pixel_analysis_opt_in=True)
    assert pkg.pixel_analysis_authorized is True
    assert AUTHORIZED_POLICY_ONLY in pkg.pixel_authorization.reason_codes
    assert pkg.metadata_only is True
    assert all(not f.pixel_tensor_ready for s in pkg.series for f in s.frames)
    # Summary must not embed quarantine paths even if present on case
    case2 = _dicom_case(
        quarantine_dir="/secret/quarantine/path",
        imaging_source_permission_verified=True,
        imaging_analysis_consent_verified=True,
    )
    summary = summarize_pixel_authorization(
        case2,
        model_ids=["future-pixel-brain-v1"],
        capabilities=caps,
        pixel_analysis_opt_in=True,
    )
    blob = " ".join(summary.reason_codes) + summary.note
    assert "/secret/" not in blob
    assert summary.authorized is True


def test_builder_default_mock_path_denies_pixels() -> None:
    case = _dicom_case(
        imaging_source_permission_verified=True,
        imaging_analysis_consent_verified=True,
    )
    pkg = build_imaging_model_input(case)
    assert pkg.pixel_analysis_authorized is False
    assert DENIED_MOCK_ADAPTER in pkg.pixel_authorization.reason_codes
