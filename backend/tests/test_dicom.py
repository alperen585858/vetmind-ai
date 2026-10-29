"""DICOM metadata foundation tests."""

from fastapi.testclient import TestClient

from app.dicom.classifier import classify_study
from app.dicom.fixtures import (
    brain_mri_study_files,
    cervical_mri_study_files,
    inconsistent_study_files,
    unsupported_modality_file,
)
from app.dicom.ingest import ingest_dicom_files
from app.dicom.parser import parse_dicom_bytes
from app.schemas.enums import AnatomicalRegion, DicomValidationCode, Modality, Species
from app.schemas.dicom import ConfirmClassificationRequest


def test_parse_synthetic_brain_instance() -> None:
    filename, data = brain_mri_study_files(1)[0]
    parsed = parse_dicom_bytes(data, filename)
    assert not parsed.malformed
    assert parsed.modality == Modality.MR
    assert parsed.study_instance_uid
    assert parsed.series_instance_uid
    assert parsed.sop_instance_uid
    assert parsed.has_pixel_data is True


def test_ingest_brain_mri_classifies_brain() -> None:
    result = ingest_dicom_files(brain_mri_study_files(2))
    assert result.blocked is False
    assert result.study is not None
    assert result.study.series_count == 1
    assert result.study.instance_count == 2
    assert result.classification is not None
    assert result.classification.suggested_modality == Modality.MR
    assert result.classification.suggested_anatomical_region == AnatomicalRegion.BRAIN
    assert any(i.code == DicomValidationCode.PIXEL_DATA_PRESENT_IGNORED for i in result.issues)


def test_ingest_cervical_mri_classifies_cervical() -> None:
    result = ingest_dicom_files(cervical_mri_study_files(2))
    assert result.blocked is False
    assert result.classification is not None
    assert result.classification.suggested_anatomical_region == AnatomicalRegion.CERVICAL


def test_malformed_file_blocked() -> None:
    result = ingest_dicom_files([("bad.dcm", b"not-a-dicom-file")])
    assert result.blocked is True
    assert any(i.code == DicomValidationCode.MALFORMED for i in result.issues)


def test_inconsistent_study_blocked() -> None:
    result = ingest_dicom_files(inconsistent_study_files())
    assert result.blocked is True
    assert any(i.code == DicomValidationCode.INCONSISTENT_STUDY for i in result.issues)


def test_unsupported_modality_blocked() -> None:
    result = ingest_dicom_files([unsupported_modality_file()])
    assert result.blocked is True
    assert any(i.code == DicomValidationCode.UNSUPPORTED_MODALITY for i in result.issues)


def test_duplicate_sop_reported() -> None:
    files = brain_mri_study_files(1)
    # Same bytes twice → same SOP UID → duplicate
    files = [files[0], ("dup.dcm", files[0][1])]
    result = ingest_dicom_files(files)
    dups = [i for i in result.issues if i.code == DicomValidationCode.DUPLICATE_SOP]
    assert len(dups) == 1
    assert dups[0].severity.value == "warning"
    assert "kept" in dups[0].message.lower() or "dropped" in dups[0].message.lower()
    assert result.blocked is False
    assert result.study is not None
    assert result.study.instance_count == 1
    # Identity tree has unique SOPs after soft-dedupe
    sops = [i.sop_instance_uid for s in result.study.series for i in s.instances]
    assert len(sops) == len(set(sops)) == 1


def test_classifier_unknown_without_tokens() -> None:
    result = ingest_dicom_files(brain_mri_study_files(1))
    assert result.study is not None
    # Mutate descriptions away from brain/cervical tokens
    study = result.study.model_copy(deep=True)
    study.study_description = "SYNTHETIC GENERIC STUDY"
    for series in study.series:
        series.series_description = "SERIES A"
        series.body_part_examined = "EXTREMITY"
    suggestion = classify_study(study)
    assert suggestion.suggested_anatomical_region in {
        AnatomicalRegion.OTHER,
        AnatomicalRegion.UNKNOWN,
    }
    assert suggestion.needs_confirmation is True


def test_api_upload_confirm_analyze(client: TestClient) -> None:
    files = brain_mri_study_files(2)
    upload = client.post(
        "/api/v1/dicom/upload",
        data={
            "patient_name": "Synthetic Demo",
            "species": Species.CANINE.value,
            "clinical_history": "Synthetic DICOM metadata demo.",
        },
        files=[("files", (name, data, "application/dicom")) for name, data in files],
    )
    assert upload.status_code == 201, upload.text
    body = upload.json()
    assert body["blocked"] is False
    ingest_id = body["ingest_id"]
    assert body["classification"]["suggested_anatomical_region"] == "BRAIN"

    got = client.get(f"/api/v1/dicom/ingestions/{ingest_id}")
    assert got.status_code == 200
    assert got.json()["ingest_id"] == ingest_id

    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={"accept_suggestion": True},
    )
    assert confirmed.status_code == 200, confirmed.text
    case = confirmed.json()
    assert case["classification_confirmed"] is True
    assert case["modality"] == "MR"
    assert case["anatomical_region"] == "BRAIN"
    assert case["study"]["dicom_available"] is True
    assert case["study"]["metadata_only"] is True
    assert case["dicom_study"]["study_instance_uid"]

    analyzed = client.post(f"/api/v1/cases/{case['case_id']}/analyze")
    assert analyzed.status_code == 200
    assert analyzed.json()["outcome"] == "success"
    findings = client.get(f"/api/v1/cases/{case['case_id']}/findings").json()
    assert findings["source_kind"] == "mock"
    assert any("ImagingModelInput" in w or "metadata_only" in w for w in findings["warnings"])


def test_api_confirm_override_region(client: TestClient) -> None:
    files = brain_mri_study_files(1)
    upload = client.post(
        "/api/v1/dicom/upload",
        data={"patient_name": "Override Demo", "species": "canine"},
        files=[("files", (name, data, "application/dicom")) for name, data in files],
    )
    ingest_id = upload.json()["ingest_id"]
    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={
            "accept_suggestion": False,
            "modality": "MR",
            "anatomical_region": "CERVICAL",
        },
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["anatomical_region"] == "CERVICAL"


def test_api_blocked_cannot_confirm(client: TestClient) -> None:
    name, data = unsupported_modality_file()
    upload = client.post(
        "/api/v1/dicom/upload",
        data={"patient_name": "US Demo", "species": "canine"},
        files=[("files", (name, data, "application/dicom"))],
    )
    assert upload.status_code == 201
    assert upload.json()["blocked"] is True
    ingest_id = upload.json()["ingest_id"]
    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json=ConfirmClassificationRequest(accept_suggestion=True).model_dump(mode="json"),
    )
    assert confirmed.status_code == 409


def test_synthetic_case_create_still_works(client: TestClient) -> None:
    from tests.conftest import make_payload

    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    assert created.status_code == 201
    assert created.json()["classification_confirmed"] is True


def test_api_fixture_download(client: TestClient) -> None:
    res = client.get("/api/v1/dicom/fixtures/brain_mri/0")
    assert res.status_code == 200
    assert len(res.content) > 128
    assert res.content[128:132] == b"DICM"


def test_api_demo_fixture_brain(client: TestClient) -> None:
    upload = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "Demo Pax", "species": "canine"},
    )
    assert upload.status_code == 201, upload.text
    body = upload.json()
    assert body["blocked"] is False
    assert body["classification"]["suggested_anatomical_region"] == "BRAIN"
    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{body['ingest_id']}/confirm",
        json={"accept_suggestion": True},
    )
    assert confirmed.status_code == 200
    analyzed = client.post(f"/api/v1/cases/{confirmed.json()['case_id']}/analyze")
    assert analyzed.status_code == 200
    assert analyzed.json()["outcome"] == "success"


def test_case_list_includes_study_summary_fields(client: TestClient) -> None:
    upload = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "List Pax", "species": "canine", "breed": "Retriever"},
    )
    ingest_id = upload.json()["ingest_id"]
    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={"accept_suggestion": True},
    )
    assert confirmed.status_code == 200
    listing = client.get("/api/v1/cases")
    assert listing.status_code == 200
    row = next(r for r in listing.json() if r["case_id"] == confirmed.json()["case_id"])
    assert row["breed"] == "Retriever"
    assert row["modality"] == "MR"
    assert row["classification_confirmed"] is True
    assert row["study_instance_uid"]
    assert row["series_count"] >= 1
    assert row["instance_count"] >= 1


def test_analyze_blocked_when_classification_unconfirmed(client: TestClient) -> None:
    """Invalid transition: analyze requires classification_confirmed."""
    from app.schemas.enums import CaseLifecycleStatus
    from tests.conftest import make_payload

    payload = make_payload().model_dump(mode="json")
    created = client.post("/api/v1/cases", json=payload)
    assert created.status_code == 201
    case_id = created.json()["case_id"]

    container = client.app.state.container
    case = container.cases.get_case(case_id)
    case.classification_confirmed = False
    case.status = CaseLifecycleStatus.AWAITING_CLASSIFICATION_CONFIRMATION
    container.repo.save_case(case)
    denied = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert denied.status_code == 409
    assert "classification" in denied.json()["detail"].lower()


def test_confirm_wires_consent_flags_without_pixel_auth(client: TestClient) -> None:
    """UI consent maps to case flags; mock adapters still cannot run pixel inference."""
    upload = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "Consent Pax", "species": "canine"},
    )
    assert upload.status_code == 201
    ingest_id = upload.json()["ingest_id"]
    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={
            "accept_suggestion": True,
            "imaging_source_permission_verified": True,
            "imaging_analysis_consent_verified": True,
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    case = confirmed.json()
    assert case["imaging_source_permission_verified"] is True
    assert case["imaging_analysis_consent_verified"] is True
    assert case["study"]["metadata_only"] is True
    model_input = case.get("model_input") or {}
    # Consent alone must not authorize pixels for mock capabilities.
    assert model_input.get("pixel_analysis_authorized") is False
    assert model_input.get("metadata_only") is True
    prepared = model_input.get("prepared_for_models") or []
    assert any(str(m).startswith("mock-") for m in prepared)


def test_api_upload_rejects_oversized_per_file(client: TestClient, monkeypatch) -> None:
    """Per-file budget is enforced (TestClient cannot reliably ship 25+ MiB bodies)."""
    import app.api.dicom as dicom_api

    monkeypatch.setattr(dicom_api, "_MAX_FILE_BYTES", 1_000)
    monkeypatch.setattr(dicom_api, "_MAX_TOTAL_BYTES", 50_000)
    chunk = b"x" * 1_500
    res = client.post(
        "/api/v1/dicom/upload",
        data={"patient_name": "Big", "species": "canine"},
        files=[("files", ("big.dcm", chunk, "application/dicom"))],
    )
    assert res.status_code == 413


def test_api_upload_rejects_total_budget(client: TestClient, monkeypatch) -> None:
    """When each file is under per-file cap, total still cannot exceed aggregate."""
    import app.api.dicom as dicom_api

    monkeypatch.setattr(dicom_api, "_MAX_TOTAL_BYTES", 5_000)
    monkeypatch.setattr(dicom_api, "_MAX_FILE_BYTES", 4_000)
    # Tiny opaque blobs (not real studies) — only size accounting is under test.
    a = b"A" * 3_000
    b = b"B" * 3_000
    assert len(a) <= 4_000 and len(b) <= 4_000
    assert len(a) + len(b) > 5_000
    res = client.post(
        "/api/v1/dicom/upload",
        data={"patient_name": "Budget", "species": "canine"},
        files=[
            ("files", ("a.dcm", a, "application/dicom")),
            ("files", ("b.dcm", b, "application/dicom")),
        ],
    )
    assert res.status_code == 413
    assert "Total upload exceeds" in res.json()["detail"]


def test_case_dicom_files_from_quarantine(client: TestClient) -> None:
    """Case viewer must serve the uploaded study bytes, not synthetic fixture defaults."""
    upload = client.post(
        "/api/v1/dicom/demo/brain_mri",
        data={"patient_name": "Viewer Pax", "species": "canine"},
    )
    assert upload.status_code == 201, upload.text
    ingest_id = upload.json()["ingest_id"]
    confirmed = client.post(
        f"/api/v1/dicom/ingestions/{ingest_id}/confirm",
        json={"accept_suggestion": True},
    )
    assert confirmed.status_code == 200
    case_id = confirmed.json()["case_id"]

    listing = client.get(f"/api/v1/cases/{case_id}/dicom/files")
    assert listing.status_code == 200, listing.text
    files = listing.json()["files"]
    assert len(files) >= 1
    assert listing.json()["ingest_id"] == ingest_id

    first = client.get(f"/api/v1/cases/{case_id}/dicom/files/0")
    assert first.status_code == 200
    assert first.content[128:132] == b"DICM"
    assert "brain_mr" in (first.headers.get("content-disposition") or "").lower() or len(first.content) > 128
