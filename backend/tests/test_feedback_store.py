"""Feedback / Audit Store (ISS-AUD-01) — training-signal events."""

from __future__ import annotations

from pathlib import Path

from tests.test_phase6_e2e_journey import _auth_client, _client, _demo_upload_confirm_analyze, _hdr, _token


def test_reject_writes_feedback_event(tmp_path: Path) -> None:
    client = _client(tmp_path, feedback_log_path=None)
    case_id = _demo_upload_confirm_analyze(client)
    res = client.post(
        f"/api/v1/cases/{case_id}/review",
        json={
            "reviewer_id": "expert-demo",
            "action": "reject",
            "comment": "Bulgu yanlış lateralite içeriyor.",
            "reason_codes": ["wrong_finding", "report_quality"],
        },
    )
    assert res.status_code == 200, res.text

    listed = client.get("/api/v1/feedback").json()
    assert listed["count"] >= 1
    event = next(e for e in listed["events"] if e["case_id"] == case_id)
    assert event["decision"] == "reject"
    assert "wrong_finding" in event["reason_codes"]
    assert event["model_ids"]
    assert event["finding_ids"]
    assert event["source_kind"] in {"mock", "real", "mixed", "synthetic"}
    assert "Bulgu yanlış" in (event["free_text"] or "")


def test_feedback_export_admin_only(tmp_path: Path) -> None:
    client = _auth_client(tmp_path, feedback_log_path=tmp_path / "feedback.jsonl")
    expert = _token(client, "expert@demo.local")
    admin = _token(client, "admin@demo.local")
    case_id = _demo_upload_confirm_analyze(client, headers=_hdr(expert))
    rev = client.post(
        f"/api/v1/cases/{case_id}/review",
        headers=_hdr(expert),
        json={
            "reviewer_id": "expert-demo",
            "action": "request_revision",
            "comment": "Eksik bulgu eklenmeli — en az on karakter.",
            "reason_codes": ["missing_finding"],
        },
    )
    assert rev.status_code == 200, rev.text

    denied = client.get("/api/v1/feedback", headers=_hdr(expert))
    assert denied.status_code == 403

    ok = client.get("/api/v1/feedback/export", headers=_hdr(admin))
    assert ok.status_code == 200, ok.text
    assert case_id in ok.text
    assert "missing_finding" in ok.text
