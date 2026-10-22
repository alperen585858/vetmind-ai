"""Phase 4 report versioning lifecycle."""

from __future__ import annotations

import threading

from fastapi.testclient import TestClient

from tests.conftest import make_payload


def _analyze(client: TestClient) -> str:
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    res = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert res.status_code == 200, res.text
    return case_id


def test_pipeline_creates_version_one(client: TestClient) -> None:
    case_id = _analyze(client)
    report = client.get(f"/api/v1/cases/{case_id}/report").json()
    assert report["version"] == 1
    assert report["immutable"] is False
    versions = client.get(f"/api/v1/cases/{case_id}/report/versions").json()
    assert len(versions) >= 1
    assert versions[0]["version"] == 1
    assert versions[0]["is_current"] is True


def test_approve_freezes_immutable_version(client: TestClient) -> None:
    case_id = _analyze(client)
    approved = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve", "comment": "ok"},
    )
    assert approved.status_code == 200, approved.text
    report = approved.json()["draft_report"]
    assert report["status"] == "approved"
    assert report["immutable"] is True
    assert report["clinically_validated"] is False
    assert report["reviewed_by"] == "expert-demo"

    # Second approve blocked
    again = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve"},
    )
    assert again.status_code == 409

    # Re-analyze blocked while approved
    re = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert re.status_code == 409


def test_revision_forks_new_version_preserving_approved(client: TestClient) -> None:
    case_id = _analyze(client)
    client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "approve", "comment": "v1 ok"},
    )
    # Request revision after approve → new mutable version
    revised = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={
            "reviewer_id": "expert-demo",
            "action": "request_revision",
            "comment": "Lütfen izlenimi netleştirin",
            "edited_impression": "Revize edilmiş değerlendirme metni",
        },
    )
    assert revised.status_code == 200, revised.text
    body = revised.json()
    assert body["status"] == "revision_requested"
    draft = body["draft_report"]
    assert draft["version"] >= 2
    assert draft["immutable"] is False
    assert "Revize" in draft["impression"]["text"]

    versions = client.get(f"/api/v1/cases/{case_id}/report/versions").json()
    approved_snaps = [v for v in versions if v["status"] == "approved" and v["immutable"]]
    assert approved_snaps, "approved v1 must remain in history"
    v1 = client.get(f"/api/v1/cases/{case_id}/report/versions/1").json()
    assert v1["immutable"] is True
    assert v1["content"]["status"] == "approved"


def test_reject_persists_history(client: TestClient) -> None:
    case_id = _analyze(client)
    rejected = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={"reviewer_id": "expert-demo", "action": "reject", "comment": "Yetersiz"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    hist = rejected.json()["review_history"]
    assert any(h["action"] == "reject" for h in hist)
    # Refresh persistence
    case = client.get(f"/api/v1/cases/{case_id}").json()
    assert case["status"] == "rejected"
    assert case["draft_report"]["status"] == "rejected"


def test_get_report_by_version_and_missing(client: TestClient) -> None:
    case_id = _analyze(client)
    v1 = client.get(f"/api/v1/cases/{case_id}/report", params={"version": 1})
    assert v1.status_code == 200
    assert "ğ" in v1.text or "SYNTHETIC" in v1.text or len(v1.json()["findings"]["text"]) > 0
    missing = client.get(f"/api/v1/cases/{case_id}/report", params={"version": 99})
    assert missing.status_code == 404


def test_concurrent_approve_only_one_succeeds(client: TestClient) -> None:
    case_id = _analyze(client)
    results: list[int] = []

    def _approve() -> None:
        res = client.post(
            f"/api/v1/cases/{case_id}/review",
            json={"reviewer_id": "expert-demo", "action": "approve", "comment": "race"},
        )
        results.append(res.status_code)

    t1 = threading.Thread(target=_approve)
    t2 = threading.Thread(target=_approve)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    assert results.count(200) == 1
    assert results.count(409) == 1
    case = client.get(f"/api/v1/cases/{case_id}").json()
    assert case["draft_report"]["immutable"] is True
    approved_versions = [
        v for v in case.get("report_versions") or [] if v.get("status") == "approved"
    ]
    assert len(approved_versions) == 1
