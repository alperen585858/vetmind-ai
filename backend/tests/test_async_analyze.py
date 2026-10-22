import time

from fastapi.testclient import TestClient

from tests.conftest import make_payload


def test_async_analyze_completes(client: TestClient) -> None:
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    enqueued = client.post(f"/api/v1/cases/{case_id}/analyze/async")
    assert enqueued.status_code == 202, enqueued.text
    job = enqueued.json()
    assert job["status"] == "queued"
    job_id = job["job_id"]

    deadline = time.time() + 5
    status = "queued"
    while time.time() < deadline:
        polled = client.get(f"/api/v1/jobs/{job_id}")
        assert polled.status_code == 200
        status = polled.json()["status"]
        if status in {"completed", "failed"}:
            break
        time.sleep(0.05)

    assert status == "completed"
    findings = client.get(f"/api/v1/cases/{case_id}/findings")
    assert findings.status_code == 200
    report = client.get(f"/api/v1/cases/{case_id}/report")
    assert report.status_code == 200


def test_async_conflict_while_running(client: TestClient) -> None:
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    first = client.post(f"/api/v1/cases/{case_id}/analyze/async")
    assert first.status_code == 202
    second = client.post(f"/api/v1/cases/{case_id}/analyze/async")
    # While ANALYZING, second enqueue should 409
    assert second.status_code == 409
