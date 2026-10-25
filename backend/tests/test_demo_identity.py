"""One reviewer identity (login email) for assignment, worklist and notifications in demo mode."""

from __future__ import annotations

from pathlib import Path

from tests.test_phase6_e2e_journey import _auth_client, _client, _demo_upload_confirm_analyze, _hdr, _token

EXPERT = "expert@demo.local"
EXPERT_HDR = {"X-VetMind-Demo-Role": "expert", "X-VetMind-Demo-Subject": EXPERT}


def test_assignment_by_email_shows_in_worklist_and_bell(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = _demo_upload_confirm_analyze(client)

    res = client.patch(f"/api/v1/cases/{case_id}/assignment", json={"assigned_reviewer_id": EXPERT})
    assert res.status_code == 200, res.text

    mine = client.get("/api/v1/cases/worklist", params={"assigned_to": EXPERT}).json()
    assert [r["case_id"] for r in mine] == [case_id]

    bell = client.get("/api/v1/notifications", headers=EXPERT_HDR).json()
    assert bell["unread_count"] == 1
    assert bell["items"][0]["case_id"] == case_id

    marked = client.post("/api/v1/notifications/read-all", headers=EXPERT_HDR).json()
    assert marked["marked"] == 1
    # Other demo users never see the expert's notifications.
    vet_bell = client.get(
        "/api/v1/notifications",
        headers={"X-VetMind-Demo-Role": "vet", "X-VetMind-Demo-Subject": "vet@demo.local"},
    ).json()
    assert all(n["case_id"] != case_id or n["kind"] != "radiologist_assigned" for n in vet_bell["items"])


def test_demo_subject_header_ignored_when_auth_enabled(tmp_path: Path) -> None:
    client = _auth_client(tmp_path)
    expert = _token(client, EXPERT)
    vet = _token(client, "vet@demo.local")
    case_id = _demo_upload_confirm_analyze(client, headers=_hdr(expert))
    client.patch(
        f"/api/v1/cases/{case_id}/assignment",
        json={"assigned_reviewer_id": EXPERT},
        headers=_hdr(expert),
    )

    # A vet token cannot read the expert's bell by spoofing the demo header.
    spoof = client.get("/api/v1/notifications", headers={**_hdr(vet), "X-VetMind-Demo-Subject": EXPERT}).json()
    assert all(n["recipient_subject"] == "vet@demo.local" for n in spoof["items"])
    own = client.get("/api/v1/notifications", headers=_hdr(expert)).json()
    assert any(n["case_id"] == case_id for n in own["items"])
