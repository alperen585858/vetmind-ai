"""Delete = hide from your own list, except permanent delete by admin (any) or the
clinic (before approval). Approved reports are medical records and are kept."""

from pathlib import Path

from tests.test_phase6_e2e_journey import _auth_client, _demo_upload_confirm_analyze, _hdr, _token


def _ids(c, token) -> set[str]:
    return {row["case_id"] for row in c.get("/api/v1/cases", headers=_hdr(token)).json()}


def _approved_case(c, vet, exp) -> str:
    cid = _demo_upload_confirm_analyze(c, headers=_hdr(vet))
    res = c.post(f"/api/v1/cases/{cid}/review", json={"reviewer_id": "x", "action": "approve"}, headers=_hdr(exp))
    assert res.status_code == 200, res.text
    return cid


def test_non_admin_delete_of_approved_case_only_hides_it(tmp_path: Path) -> None:
    c = _auth_client(tmp_path)
    vet, exp, admin = (_token(c, f"{r}@demo.local") for r in ("vet", "expert", "admin"))
    clinic = _token(c, "clinic-owner@demo.local")
    cid = _approved_case(c, vet, exp)

    for token in (clinic, exp, vet):
        assert c.delete(f"/api/v1/cases/{cid}", headers=_hdr(token)).status_code == 204
        assert cid not in _ids(c, token)
    assert cid in _ids(c, admin)  # record kept for everyone who did not hide it
    assert c.get(f"/api/v1/cases/{cid}", headers=_hdr(admin)).status_code == 200


def test_vet_hard_deletes_unapproved_case_with_its_files(tmp_path: Path) -> None:
    c = _auth_client(tmp_path)
    vet, admin = _token(c, "vet@demo.local"), _token(c, "admin@demo.local")
    cid = _demo_upload_confirm_analyze(c, headers=_hdr(vet))
    store = c.app.state.container.evidence_store
    working = store.root / "_evidence" / cid
    working.mkdir(parents=True, exist_ok=True)
    (working / "overlay.png").write_bytes(b"x")

    assert c.delete(f"/api/v1/cases/{cid}", headers=_hdr(vet)).status_code == 204
    assert c.get(f"/api/v1/cases/{cid}", headers=_hdr(admin)).status_code == 404
    assert not working.exists()


def test_admin_hard_deletes_approved_case(tmp_path: Path) -> None:
    c = _auth_client(tmp_path)
    vet, exp, admin = (_token(c, f"{r}@demo.local") for r in ("vet", "expert", "admin"))
    cid = _approved_case(c, vet, exp)
    frozen = c.app.state.container.evidence_store.root / "_report_evidence" / cid / "v1"
    frozen.mkdir(parents=True, exist_ok=True)
    assert c.delete(f"/api/v1/cases/{cid}", headers=_hdr(admin)).status_code == 204
    assert c.get(f"/api/v1/cases/{cid}", headers=_hdr(admin)).status_code == 404
    assert not frozen.parent.exists()
