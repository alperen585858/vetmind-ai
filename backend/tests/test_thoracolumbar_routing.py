"""#49 step 2: thoracolumbar spine is classified, routed and analysed as its own region."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.dicom.classifier import classify_study
from app.models.mock_vision import MockThoracolumbarMriModel
from app.routing.capabilities import default_capabilities
from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta
from app.schemas.enums import AnatomicalRegion, ClassificationConfidence, Modality
from tests.test_phase6_e2e_journey import _client

TL = AnatomicalRegion.THORACOLUMBAR


def _study(*, modality: Modality = Modality.MR, study_desc: str, series_desc: str = "") -> DicomStudyMeta:
    return DicomStudyMeta(
        study_instance_uid="1.2.3.study",
        study_description=study_desc,
        series=[
            DicomSeriesMeta(
                series_instance_uid="1.2.3.series",
                modality=modality,
                series_description=series_desc or None,
                body_part_examined=None,
                instances=[
                    DicomInstanceMeta(
                        sop_instance_uid="1.2.3.sop", filename="x.dcm", has_pixel_data=False, pixel_data_analyzed=False
                    )
                ],
            )
        ],
    )


@pytest.mark.parametrize(
    "study_desc,series_desc",
    [
        ("MRI THORACOLUMBAR SPINE", "SAG T2 T13-L1"),
        ("LUMBAR SPINE MRI", "SAG T2"),
        ("THORACIC SPINE MRI", "SAG T2 T-SPINE"),  # spine, not chest
        ("TORAKOLOMBER MR", "SAG T2"),
        ("LOMBER OMURGA", ""),
    ],
    ids=["thoracolumbar-t13l1", "lumbar", "thoracic-spine", "torakolomber", "lomber"],
)
def test_thoracolumbar_descriptions_classify_as_thoracolumbar(study_desc: str, series_desc: str) -> None:
    s = classify_study(_study(study_desc=study_desc, series_desc=series_desc))
    assert s.suggested_anatomical_region == TL, s.rationale
    assert s.confidence in {ClassificationConfidence.HIGH, ClassificationConfidence.MEDIUM}
    assert any("torakolomber" in r for r in s.rationale)


@pytest.mark.parametrize(
    "modality,study_desc,series_desc,expected",
    [
        # MR sequence names T1/T2 and words like AXIAL1 are not vertebral levels.
        (Modality.MR, "BRAIN MRI", "AX T1 AXIAL1", AnatomicalRegion.BRAIN),
        # "THORACIC" without "spine" is still the chest.
        (Modality.XR, "THORACIC RADIOGRAPH", "LATERAL", AnatomicalRegion.THORAX),
        (Modality.XR, "THORAX 2 VIEWS", "VD", AnatomicalRegion.THORAX),
        (Modality.MR, "CERVICAL SPINE", "SAG T2 C2-C3", AnatomicalRegion.CERVICAL),
    ],
    ids=["t1-axial1-not-spine", "thoracic-radiograph-chest", "thorax", "cervical"],
)
def test_traps_do_not_become_thoracolumbar(modality, study_desc, series_desc, expected) -> None:  # noqa: ANN001
    s = classify_study(_study(modality=modality, study_desc=study_desc, series_desc=series_desc))
    assert s.suggested_anatomical_region == expected, s.rationale


def test_series_hint_agrees_on_thoracolumbar() -> None:
    s = classify_study(_study(study_desc="Spine MRI", series_desc="SAG T2 LUMBAR"))
    hint = next(sig for sig in s.signals if sig.name == "series_hint")
    assert hint.anatomical_region == TL
    assert s.disagreement is False


def test_routing_table_has_a_thoracolumbar_mr_model_and_ct_covers_it() -> None:
    caps = {c.model_id: c for c in default_capabilities()}
    assert TL in caps["mock-tl-mri-v1"].regions and Modality.MR in caps["mock-tl-mri-v1"].modalities
    assert TL in caps["mock-ct-3d-v1"].regions
    # Cervical / brain models must not pick up spine cases further down.
    assert TL not in caps["mock-cervical-mri-v1"].regions
    assert TL not in caps["mock-xr-vision-v1"].regions


def test_thoracolumbar_mock_finding_is_at_t13_l1() -> None:
    from app.schemas.case import CaseRecord
    from app.schemas.enums import Species

    case = CaseRecord(
        case_id="c-tl", patient_name="Pax", species=Species.CANINE, modality=Modality.MR, anatomical_region=TL
    )
    out = MockThoracolumbarMriModel().analyze(case)
    assert out.findings and "T13–L1" in out.findings[0].anatomical_location
    assert "C2" not in out.findings[0].description


def test_confirmed_thoracolumbar_mr_study_is_analysed_by_the_spine_model(tmp_path: Path) -> None:
    client = _client(tmp_path)
    up = client.post(
        "/api/v1/dicom/demo/cervical_mri",
        data={"patient_name": "TL-Pax", "species": "canine", "clinical_history": "Arka bacak güçsüzlüğü."},
    )
    assert up.status_code in (200, 201), up.text
    ingest_id = up.json()["ingest_id"]
    conf = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={
            "accept_suggestion": False, "owner_name": "Demo Owner", "owner_email": "owner@demo.local", "owner_email_consent": True,
            "modality": "MR",
            "anatomical_region": "THORACOLUMBAR",
            "imaging_source_permission_verified": True,
            "imaging_analysis_consent_verified": True,
        },
    )
    assert conf.status_code in (200, 201), conf.text
    case_id = conf.json()["case_id"]
    an = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert an.status_code == 200, an.text
    case = client.get(f"/api/v1/cases/{case_id}").json()
    assert case["anatomical_region"] == "THORACOLUMBAR"
    assert case["structured_findings"]["source_model_id"] == "mock-tl-mri-v1"
    assert "T13" in case["structured_findings"]["findings"][0]["anatomical_location"]


def test_thoracolumbar_radiograph_is_not_auto_routed(tmp_path: Path) -> None:
    client = _client(tmp_path)
    up = client.post(
        "/api/v1/dicom/demo/thorax_xr", data={"patient_name": "TL-XR", "species": "canine"}
    )
    ingest_id = up.json()["ingest_id"]
    conf = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={
            "accept_suggestion": False, "owner_name": "Demo Owner", "owner_email": "owner@demo.local", "owner_email_consent": True,
            "modality": "XR",
            "anatomical_region": "THORACOLUMBAR",
            "imaging_source_permission_verified": True,
            "imaging_analysis_consent_verified": True,
        },
    )
    # The radiograph mock only reads chests; a spine radiograph must not get chest findings.
    assert conf.status_code == 409


def test_thoracolumbar_demo_study_is_suggested_and_routed_without_manual_override(tmp_path: Path) -> None:
    """#49 step 4: the TL demo fixture is recognised by the classifier, so the default confirm routes it."""
    client = _client(tmp_path)
    up = client.post(
        "/api/v1/dicom/demo/thoracolumbar_mri",
        data={"patient_name": "TL-Demo", "species": "canine", "clinical_history": "Akut paraparezi."},
    )
    assert up.status_code in (200, 201), up.text
    body = up.json()
    suggestion = body["classification"]
    assert suggestion["suggested_anatomical_region"] == "THORACOLUMBAR"
    assert suggestion["confidence"] == "high"
    conf = client.post(
        f"/api/v1/dicom/ingestions/{body['ingest_id']}/confirm",
        json={
            "accept_suggestion": True, "owner_name": "Demo Owner", "owner_email": "owner@demo.local", "owner_email_consent": True,
            "imaging_source_permission_verified": True,
            "imaging_analysis_consent_verified": True,
        },
    )
    assert conf.status_code in (200, 201), conf.text
    case_id = conf.json()["case_id"]
    assert client.post(f"/api/v1/cases/{case_id}/analyze").status_code == 200
    case = client.get(f"/api/v1/cases/{case_id}").json()
    assert case["anatomical_region"] == "THORACOLUMBAR"
    assert case["structured_findings"]["source_model_id"] == "mock-tl-mri-v1"


def test_demo_seed_has_a_thoracolumbar_patient(tmp_path: Path) -> None:
    from app.container import AppContainer
    from app.demo_seed import seed_demo_cases
    from app.services.repository import InMemoryCaseRepository
    from tests.test_phase6_e2e_journey import _mem_settings

    c = AppContainer(repo=InMemoryCaseRepository(), settings=_mem_settings(tmp_path))
    cases = [c.repo.get_case(i) for i in seed_demo_cases(c)]
    tl = next(x for x in cases if x.patient_name == "Fındık")
    assert tl.anatomical_region == AnatomicalRegion.THORACOLUMBAR
    assert tl.structured_findings and tl.structured_findings.source_model_id == "mock-tl-mri-v1"
