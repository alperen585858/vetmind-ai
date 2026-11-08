"""P1.8 — Accept ≠ verify; training:verify capability required."""

from pathlib import Path

from app.auth import rbac
from tests.test_evidence_review_api import BOX, _add, _case, _hdr


def test_expert_can_verify_and_unverify(tmp_path: Path) -> None:
    c, _vet, exp, cid, fid = _case(tmp_path)
    res = _add(c, exp, cid, fid)
    assert res.status_code == 200, res.text
    ev = next(e for f in res.json()["findings"] for e in f["evidence_references"] if "-vet-" in e["evidence_id"])
    assert (ev.get("expert_verification_status") or "unverified") == "unverified"

    ok = c.post(
        f"/api/v1/cases/{cid}/evidence/{ev['evidence_id']}/review",
        json={"action": "verify"},
        headers=_hdr(exp),
    )
    assert ok.status_code == 200, ok.text
    verified = next(
        e
        for f in ok.json()["findings"]
        for e in f["evidence_references"]
        if e["evidence_id"] == ev["evidence_id"]
    )
    assert verified["expert_verification_status"] == "verified"
    assert verified["expert_verified_by"]

    undo = c.post(
        f"/api/v1/cases/{cid}/evidence/{ev['evidence_id']}/review",
        json={"action": "unverify"},
        headers=_hdr(exp),
    )
    assert undo.status_code == 200, undo.text
    again = next(
        e
        for f in undo.json()["findings"]
        for e in f["evidence_references"]
        if e["evidence_id"] == ev["evidence_id"]
    )
    assert again["expert_verification_status"] == "unverified"


def test_vet_with_review_cannot_verify(tmp_path: Path, monkeypatch) -> None:
    """Even if a vet gains CAP_REVIEW, verify stays expert-gated."""
    monkeypatch.setitem(
        rbac.ROLE_CAPABILITIES,
        "vet",
        rbac.ROLE_CAPABILITIES["vet"] | {rbac.CAP_REVIEW},
    )
    c, vet, exp, cid, fid = _case(tmp_path)
    res = _add(c, exp, cid, fid)
    assert res.status_code == 200, res.text
    ev = next(e for f in res.json()["findings"] for e in f["evidence_references"] if "-vet-" in e["evidence_id"])

    # Vet can accept (CAP_REVIEW) but not verify.
    accept = c.post(
        f"/api/v1/cases/{cid}/evidence/{ev['evidence_id']}/review",
        json={"action": "accept"},
        headers=_hdr(vet),
    )
    assert accept.status_code == 200, accept.text

    denied = c.post(
        f"/api/v1/cases/{cid}/evidence/{ev['evidence_id']}/review",
        json={"action": "verify"},
        headers=_hdr(vet),
    )
    assert denied.status_code == 403, denied.text
    assert "training:verify" in denied.json()["detail"]
