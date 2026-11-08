"""P1.7 — bbox edit/manual persist as native; bad transforms → 400; version bump."""

from pathlib import Path

from tests.test_evidence_review_api import BOX, _add, _case, _hdr


def test_edit_persists_native_bbox_and_bumps_version(tmp_path: Path) -> None:
    c, _vet, exp, cid, fid = _case(tmp_path)
    res = _add(c, exp, cid, fid)
    assert res.status_code == 200, res.text
    ev = next(e for f in res.json()["findings"] for e in f["evidence_references"] if "-vet-" in e["evidence_id"])
    assert ev["annotation_version"] == "1"
    edited = c.post(
        f"/api/v1/cases/{cid}/evidence/{ev['evidence_id']}/review",
        json={
            "action": "edit",
            "bbox": {
                "x_min": 12,
                "y_min": 14,
                "x_max": 60,
                "y_max": 70,
                "coordinate_space": "pixel_2d_native",
            },
            "vet_note": "moved",
        },
        headers=_hdr(exp),
    )
    assert edited.status_code == 200, edited.text
    refs = [e for f in edited.json()["findings"] for e in f["evidence_references"]]
    neu = next(e for e in refs if e.get("supersedes_evidence_id") == ev["evidence_id"])
    assert neu["origin"] == "vet_manual"
    assert neu["bbox"]["coordinate_space"] == "pixel_2d_native"
    assert neu["bbox"]["x_min"] == 12
    assert neu["annotation_version"] == "2"
    assert neu["reviewed_by"]


def test_model_input_without_chain_rejected(tmp_path: Path) -> None:
    c, _vet, exp, cid, fid = _case(tmp_path)
    res = c.post(
        f"/api/v1/cases/{cid}/evidence",
        json={
            "finding_id": fid,
            "bbox": {
                "x_min": 1,
                "y_min": 1,
                "x_max": 10,
                "y_max": 10,
                "coordinate_space": "model_input",
                "transform_chain": [],
            },
        },
        headers=_hdr(exp),
    )
    assert res.status_code == 400, res.text
    assert "transform_chain" in res.json()["detail"].lower() or "model_input" in res.json()["detail"].lower()


def test_patient_space_bbox_rejected(tmp_path: Path) -> None:
    c, _vet, exp, cid, fid = _case(tmp_path)
    res = c.post(
        f"/api/v1/cases/{cid}/evidence",
        json={
            "finding_id": fid,
            "bbox": {**BOX, "coordinate_space": "patient"},
        },
        headers=_hdr(exp),
    )
    assert res.status_code == 400, res.text
