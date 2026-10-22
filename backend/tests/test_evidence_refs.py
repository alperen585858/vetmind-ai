"""F6: structured DICOM evidence references vs ImagingModelInput."""

from app.models.model_input_builder import build_imaging_model_input
from app.models.normalizer import normalize_outputs
from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta
from app.schemas.enums import (
    AnatomicalRegion,
    FindingStatus,
    Modality,
    ModelExecutionStatus,
    SourceKind,
    Species,
)
from app.schemas.findings import EvidenceReference, Finding, StructuredFindings, StudyInfo


def _case_with_dicom() -> CaseRecord:
    study_uid = "1.2.840.10008.1.2.1.999"
    series_uid = "1.2.840.10008.1.2.1.888"
    sop_uid = "1.2.840.10008.1.2.1.777"
    case = CaseRecord(
        case_id="case-ev",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
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
    case.model_input = build_imaging_model_input(case)
    return case


def _findings_with_evidence(ev: EvidenceReference) -> StructuredFindings:
    return StructuredFindings(
        case_id="case-ev",
        study=StudyInfo(),
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        source_model_id="future-real-adapter",
        source_model_version="1.0.0",
        source_kind=SourceKind.REAL,
        execution_status=ModelExecutionStatus.SUCCESS,
        findings=[
            Finding(
                finding_id="f1",
                finding_code="EV-TEST",
                description="Finding with structured evidence",
                anatomical_location="brain",
                finding_status=FindingStatus.SUSPECTED,
                source_model="future-real-adapter",
                source_model_version="1.0.0",
                evidence_references=[ev],
                synthetic=False,
            )
        ],
        contributing_model_ids=["future-real-adapter"],
        contributing_source_kinds=[SourceKind.REAL],
        warnings=[],
    )


def test_valid_sop_reference_not_flagged() -> None:
    case = _case_with_dicom()
    mi = case.model_input
    assert mi is not None
    sop = mi.series[0].frames[0].sop_instance_uid
    series = mi.series[0].series_instance_uid
    out = normalize_outputs(
        [
            _findings_with_evidence(
                EvidenceReference(
                    evidence_id="ev-ok",
                    description="Linked to supplied instance",
                    study_instance_uid=mi.study_instance_uid,
                    series_instance_uid=series,
                    sop_instance_uid=sop,
                    frame_index=1,
                )
            )
        ],
        model_input=mi,
    )
    assert out.findings[0].evidence_references[0].sop_instance_uid == sop
    assert not any("dangling" in w.lower() for w in out.warnings)
    assert not any("does not match" in w.lower() for w in out.warnings)


def test_invalid_sop_reference_flagged() -> None:
    case = _case_with_dicom()
    mi = case.model_input
    assert mi is not None
    out = normalize_outputs(
        [
            _findings_with_evidence(
                EvidenceReference(
                    evidence_id="ev-bad",
                    description="Unknown SOP",
                    sop_instance_uid="1.2.840.10008.1.2.1.000000",
                    series_instance_uid=mi.series[0].series_instance_uid,
                )
            )
        ],
        model_input=mi,
    )
    assert any("dangling" in w.lower() for w in out.warnings)
    # Evidence preserved (not dropped / fabricated away)
    assert out.findings[0].evidence_references[0].evidence_id == "ev-bad"


def test_free_text_evidence_still_compatible() -> None:
    case = _case_with_dicom()
    out = normalize_outputs(
        [
            _findings_with_evidence(
                EvidenceReference(
                    evidence_id="ev-text",
                    description="Mock series hint only",
                    series_hint="T2W transverse (placeholder)",
                )
            )
        ],
        model_input=case.model_input,
    )
    assert not any("dangling" in w.lower() for w in out.warnings)
    assert out.findings[0].evidence_references[0].series_hint


def test_invalid_uid_syntax_flagged() -> None:
    case = _case_with_dicom()
    out = normalize_outputs(
        [
            _findings_with_evidence(
                EvidenceReference(
                    evidence_id="ev-syntax",
                    description="Bad UID",
                    sop_instance_uid="not-a-uid!",
                )
            )
        ],
        model_input=case.model_input,
    )
    assert any("invalid" in w.lower() and "sop_instance_uid" in w for w in out.warnings)
