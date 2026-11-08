"""P1.9 — training export REST API."""

from pathlib import Path

from tests.test_evidence_review_api import _add, _case, _hdr
from tests.test_phase6_e2e_journey import _auth_client, _token


def test_export_verified_only_and_phi_scrub(tmp_path: Path) -> None:
    c, _vet, exp, cid, fid = _case(tmp_path)
    res = _add(c, exp, cid, fid)
    assert res.status_code == 200, res.text
    ev = next(e for f in res.json()["findings"] for e in f["evidence_references"] if "-vet-" in e["evidence_id"])

    empty = c.post(
        "/api/v1/training/export",
        json={"dataset_version": "ds-api-1", "case_ids": [cid], "include_splits": False},
        headers=_hdr(exp),
    )
    assert empty.status_code == 200, empty.text
    assert empty.json()["manifest"]["row_count"] == 0

    assert (
        c.post(
            f"/api/v1/cases/{cid}/evidence/{ev['evidence_id']}/review",
            json={"action": "verify"},
            headers=_hdr(exp),
        ).status_code
        == 200
    )

    ok = c.post(
        "/api/v1/training/export",
        json={"dataset_version": "ds-api-1", "case_ids": [cid], "include_splits": True},
        headers=_hdr(exp),
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["manifest"]["row_count"] == 1
    assert body["manifest"]["export_id"].startswith("exp-")
    assert cid in body["manifest"]["source_case_ids"]
    row = body["rows"][0]
    assert row["evidence_id"] == ev["evidence_id"]
    pid = row["patient_id"]
    assert pid.startswith("anon-") or pid.upper().startswith("SYN") or "synth" in pid.lower()
    assert "patient_name" not in row
    assert " " not in pid
    assert "ds-api-1" in body["jsonl"]
    assert body["splits"] is not None


def test_vet_cannot_export(tmp_path: Path) -> None:
    c = _auth_client(tmp_path)
    vet = _token(c, "vet@demo.local")
    res = c.post(
        "/api/v1/training/export",
        json={"dataset_version": "ds-x"},
        headers=_hdr(vet),
    )
    assert res.status_code == 403
