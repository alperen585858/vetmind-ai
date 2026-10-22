from fastapi.testclient import TestClient

from tests.conftest import make_payload


def test_health(client: TestClient) -> None:
    res = client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["mode"] == "mock"


def test_create_list_get_case(client: TestClient) -> None:
    created = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"))
    assert created.status_code == 201
    case_id = created.json()["case_id"]
    listed = client.get("/api/v1/cases")
    assert listed.status_code == 200
    assert any(item["case_id"] == case_id for item in listed.json())
    got = client.get(f"/api/v1/cases/{case_id}")
    assert got.status_code == 200
    assert got.json()["patient_name"] == "Pax"


def test_analyze_brain_mri_and_fetch_report(client: TestClient) -> None:
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert analyzed.status_code == 200
    body = analyzed.json()
    assert body["outcome"] == "success"
    job_id = body["job"]["job_id"]
    job = client.get(f"/api/v1/jobs/{job_id}")
    assert job.status_code == 200
    assert job.json()["status"] == "completed"
    findings = client.get(f"/api/v1/cases/{case_id}/findings")
    assert findings.status_code == 200
    assert findings.json()["findings"][0]["finding_code"] == "MOCK-BRAIN-MASS-EFFECT"
    report = client.get(f"/api/v1/cases/{case_id}/report")
    assert report.status_code == 200
    assert report.json()["synthetic"] is True
    assert "SYNTHETIC DRAFT" in report.json()["findings"]["text"]


def test_review_approve(client: TestClient) -> None:
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    client.post(f"/api/v1/cases/{case_id}/analyze")
    reviewed = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={
            "reviewer_id": "expert-demo",
            "action": "approve",
            "comment": "Synthetic review only.",
            "edited_impression": "Reviewed synthetic impression.",
        },
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["status"] == "approved"
    assert reviewed.json()["draft_report"]["status"] == "approved"
    assert reviewed.json()["draft_report"]["impression"]["text"] == "Reviewed synthetic impression."


def test_missing_case_404(client: TestClient) -> None:
    res = client.get("/api/v1/cases/does-not-exist")
    assert res.status_code == 404


def test_findings_before_analyze_404(client: TestClient) -> None:
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    res = client.get(f"/api/v1/cases/{case_id}/findings")
    assert res.status_code == 404


def test_unsupported_analyze(client: TestClient) -> None:
    payload = make_payload(scenario="unsupported").model_dump(mode="json")
    case_id = client.post("/api/v1/cases", json=payload).json()["case_id"]
    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert analyzed.status_code == 200
    assert analyzed.json()["outcome"] == "unsupported"


def test_model_failure_analyze(client: TestClient) -> None:
    payload = make_payload(scenario="model_failure").model_dump(mode="json")
    case_id = client.post("/api/v1/cases", json=payload).json()["case_id"]
    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert analyzed.status_code == 200
    assert analyzed.json()["outcome"] == "failed"
    assert analyzed.json()["job"]["status"] == "failed"


def test_review_without_draft_409(client: TestClient) -> None:
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    res = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve"},
    )
    assert res.status_code == 409
