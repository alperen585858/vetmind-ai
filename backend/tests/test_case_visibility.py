"""Radiologist-only fields (internal notes, AI chat) are hidden from vets/owners on every
case response, and filtering never deletes them from storage."""

from pathlib import Path

from app.auth.principal import AuthPrincipal
from app.auth.visibility import case_for_principal
from app.schemas.case import CaseRecord
from tests.test_phase6_e2e_journey import _auth_client, _demo_upload_confirm_analyze, _hdr, _token


def _seeded(tmp_path: Path):
    c = _auth_client(tmp_path)
    vet, exp = _token(c, "vet@demo.local"), _token(c, "expert@demo.local")
    cid = _demo_upload_confirm_analyze(c, headers=_hdr(vet))
    assert c.post(f"/api/v1/cases/{cid}/internal-notes", json={"body": "Gizli radyolog notu"}, headers=_hdr(exp)).status_code == 200
    assert c.post(f"/api/v1/cases/{cid}/ai-chat", json={"message": "Gizli asistan sorusu"}, headers=_hdr(exp)).status_code == 200
    return c, vet, exp, cid


def test_vet_and_clinic_owner_do_not_see_chat_or_internal_notes(tmp_path: Path) -> None:
    c, vet, exp, cid = _seeded(tmp_path)
    for email in ("vet@demo.local", "clinic-owner@demo.local"):
        body = c.get(f"/api/v1/cases/{cid}", headers=_hdr(_token(c, email))).json()
        assert body["ai_chat"] == [] and body["internal_notes"] == [], email
    expert_view = c.get(f"/api/v1/cases/{cid}", headers=_hdr(exp)).json()
    assert len(expert_view["ai_chat"]) == 2 and len(expert_view["internal_notes"]) == 1


def test_vet_write_returns_filtered_case_and_keeps_stored_fields(tmp_path: Path) -> None:
    c, vet, exp, cid = _seeded(tmp_path)
    res = c.post(f"/api/v1/cases/{cid}/clinical-notes", json={"body": "Veteriner ek not"}, headers=_hdr(vet))
    assert res.status_code == 200
    assert res.json()["ai_chat"] == [] and res.json()["internal_notes"] == []
    stored = c.get(f"/api/v1/cases/{cid}", headers=_hdr(exp)).json()
    assert len(stored["internal_notes"]) == 1, "vet note must not delete radiologist notes"
    assert len(stored["ai_chat"]) == 2


def test_case_for_principal_rules() -> None:
    case = CaseRecord.model_construct(internal_notes=["x"], ai_chat=["y"])

    def p(role: str, via: str = "jwt") -> AuthPrincipal:
        return AuthPrincipal(subject=f"{role}@x", role=role, via=via)

    assert case_for_principal(case, p("owner")).ai_chat == []
    assert case_for_principal(case, p("clinic_owner")).internal_notes == []
    assert case_for_principal(case, p("expert")).ai_chat == ["y"]
    assert case_for_principal(case, p("owner", via="disabled")).ai_chat == ["y"]  # auth off: demo
    assert case_for_principal(case, None).internal_notes == ["x"]
