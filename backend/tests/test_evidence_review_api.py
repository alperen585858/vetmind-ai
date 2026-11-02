"""Evidence review is the radiologist's job, is audited, and is frozen once the report is approved."""

import json
from pathlib import Path

from tests.test_phase6_e2e_journey import _auth_client, _demo_upload_confirm_analyze, _hdr, _token

BOX = {"x_min": 10, "y_min": 10, "x_max": 40, "y_max": 40}


def _case(tmp_path: Path):
    c = _auth_client(tmp_path)
    vet, exp = _token(c, "vet@demo.local"), _token(c, "expert@demo.local")
    cid = _demo_upload_confirm_analyze(c, headers=_hdr(vet))
    finding_id = c.get(f"/api/v1/cases/{cid}", headers=_hdr(exp)).json()["structured_findings"]["findings"][0]["finding_id"]
    return c, vet, exp, cid, finding_id


def _add(c, token, cid, finding_id):
    return c.post(
        f"/api/v1/cases/{cid}/evidence",
        json={"finding_id": finding_id, "bbox": BOX, "description": "El ile işaret"},
        headers=_hdr(token),
    )


def test_radiologist_reviews_evidence_vet_cannot(tmp_path: Path) -> None:
    c, vet, exp, cid, fid = _case(tmp_path)
    assert _add(c, vet, cid, fid).status_code == 403
    res = _add(c, exp, cid, fid)
    assert res.status_code == 200, res.text
    ev = next(e for f in res.json()["findings"] for e in f["evidence_references"] if "-vet-" in e["evidence_id"])
    rev = c.post(
        f"/api/v1/cases/{cid}/evidence/{ev['evidence_id']}/review",
        json={"action": "reject", "vet_note": "Yanlış yer"},
        headers=_hdr(exp),
    )
    assert rev.status_code == 200, rev.text
    events = [json.loads(line)["event_type"] for line in (tmp_path / "audit.jsonl").read_text().splitlines()]
    assert "evidence.manual_add" in events and "evidence.review.reject" in events


def test_evidence_frozen_after_approval(tmp_path: Path) -> None:
    c, vet, exp, cid, fid = _case(tmp_path)
    assert c.post(
        f"/api/v1/cases/{cid}/review", json={"reviewer_id": "expert@demo.local", "action": "approve"}, headers=_hdr(exp)
    ).status_code == 200
    res = _add(c, exp, cid, fid)
    assert res.status_code == 409 and "approved" in res.json()["detail"]
