"""Document ingest (PDF/text) → multimodal stub pipeline."""

from fastapi.testclient import TestClient

from app.ingest.filetype import detect_file_kind
from app.schemas.enums import FileContentKind, Species


def test_detect_pdf_and_text() -> None:
    assert detect_file_kind("a.pdf", b"%PDF-1.4 rest") == FileContentKind.PDF
    assert detect_file_kind("note.txt", b"Hello clinical note") == FileContentKind.TEXT
    assert detect_file_kind("x.jpg", b"\xff\xd8\xff\xe0rest") == FileContentKind.JPEG


def test_document_upload_confirm_analyze(client: TestClient) -> None:
    text = (
        "SYNTHETIC PRIOR REPORT\n"
        "Species: canine\n"
        "History: intermittent cough. Not a real clinical document.\n"
    ).encode("utf-8")
    upload = client.post(
        "/api/v1/documents/upload",
        data={
            "patient_name": "Doc Demo",
            "species": Species.CANINE.value,
            "clinical_history": "Document-context demo.",
        },
        files=[("files", ("prior_report.txt", text, "text/plain"))],
    )
    assert upload.status_code == 201, upload.text
    body = upload.json()
    assert body["blocked"] is False
    assert body["quarantined_file_count"] == 1
    assert body["documents"][0]["content_kind"] == "text"
    assert "cough" in (body["documents"][0]["extracted_text"] or "")

    confirmed = client.post(
        f"/api/v1/documents/ingestions/{body['ingest_id']}/confirm",
        json={},
    )
    assert confirmed.status_code == 200, confirmed.text
    case = confirmed.json()
    assert case["document_context"] is not None
    assert case["modality"] == "OTHER"
    assert case["scenario"] == "document_context"

    analyzed = client.post(f"/api/v1/cases/{case['case_id']}/analyze")
    assert analyzed.status_code == 200, analyzed.text
    assert analyzed.json()["outcome"] == "success"
    findings = client.get(f"/api/v1/cases/{case['case_id']}/findings").json()
    assert findings["source_model_id"] == "mock-multimodal-vlm-v1"
    assert any(f["finding_code"] == "MOCK-VLM-DOCUMENT-CONTEXT" for f in findings["findings"])


def test_document_rejects_dicom(client: TestClient) -> None:
    from app.dicom.fixtures import brain_mri_study_files

    name, data = brain_mri_study_files(1)[0]
    upload = client.post(
        "/api/v1/documents/upload",
        data={"patient_name": "Wrong Path", "species": "canine"},
        files=[("files", (name, data, "application/dicom"))],
    )
    assert upload.status_code == 422
