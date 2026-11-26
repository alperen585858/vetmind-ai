"""Issue #113 — plain-language owner note: glossary, safety, workflow, PDF."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.llm import owner_summary as osum
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings
from tests.conftest import make_payload


# --- glossary / safety (pure) --------------------------------------------------------------


def test_glossary_turns_terms_into_plain_words() -> None:
    assert osum.simplify("Kardiyomegali ve bilateral plevral efüzyon [F1, F2].", "tr") == (
        "Kalpte büyüme ve her iki tarafta akciğerlerin çevresinde sıvı birikmesi."
    )
    assert osum.simplify("Mild cardiomegaly with pleural effusion [F1]. cardiomegaly noted.", "en") == (
        "Mild enlarged heart with fluid around the lungs. Enlarged heart noted."
    )
    # Turkish dotted capital I at a sentence start.
    assert osum.simplify("intervertebral disk herniasyonu.", "tr").startswith("Omurlar")


@pytest.mark.parametrize(
    ("text", "reasons"),
    [
        ("Fenobarbital 2.5 mg/kg BID başlanmalı.", ["dose"]),
        ("Bu kesinlikle tümördür.", ["certainty"]),
        ("Your pet will die within a year.", ["prognosis"]),
        ("Veteriner hekiminiz sonraki adımları anlatacak.", []),
    ],
)
def test_unsafe_reasons(text: str, reasons: list[str]) -> None:
    assert osum.unsafe_reasons(text) == reasons


# --- API -----------------------------------------------------------------------------------


def _app(tmp_path: Path, **overrides) -> tuple[TestClient, AppContainer]:
    settings = replace(
        Settings(
            storage_backend="memory",
            sqlite_path=Path("unused.sqlite3"),
            quarantine_root=tmp_path / "q",
            async_analyze_delay_ms=0,
        ),
        **overrides,
    )
    container = AppContainer(repo=InMemoryCaseRepository(), settings=settings)
    return TestClient(create_app(container)), container


def _approved_case(client: TestClient, **kw) -> str:
    case_id = client.post("/api/v1/cases", json=make_payload(**kw).model_dump(mode="json")).json()["case_id"]
    assert client.post(f"/api/v1/cases/{case_id}/analyze").status_code == 200
    res = client.post(f"/api/v1/cases/{case_id}/review", json={"reviewer_id": "expert-demo", "action": "approve"})
    assert res.status_code == 200, res.text
    return case_id


def _use_real_model(container: AppContainer) -> None:
    """Only the owner-note step talks to a (faked) Ollama model; the report stays mock."""
    svc = container.owner_summaries
    svc._settings = replace(svc._settings, llm_provider="ollama", llm_model_id="test-model")  # noqa: SLF001


def _url(case_id: str, tail: str = "") -> str:
    return f"/api/v1/cases/{case_id}/owner-summary{tail}"


def test_needs_an_approved_report(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json")).json()["case_id"]
    state = client.get(_url(case_id)).json()
    assert state["summary"] is None and state["report_approved"] is False
    res = client.post(_url(case_id))
    assert res.status_code == 409 and res.json()["detail"]["code"] == "owner_summary_needs_approved_report"


def test_generate_edit_approve_pdf(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    case_id = _approved_case(client, patient_name="Karamel", owner_name="Ayşe Yılmaz")
    state = client.post(_url(case_id)).json()
    s = state["summary"]
    assert s["status"] == "draft" and s["source"] == "template" and s["report_version"] >= 1
    for heading in ("Ne yapıldı?", "Ne görüldü?", "Bu ne anlama geliyor?", "Sonraki adımlar"):
        assert heading in s["text"]
    # Names never appear in the note; the citation tags are gone.
    assert "Karamel" not in s["text"] and "Ayşe" not in s["text"] and "[F1" not in s["text"]
    assert "tanı veya tedavi önerisi değildir" in state["disclaimer"]

    # No PDF before approval.
    assert client.get(_url(case_id, ".pdf")).status_code == 409

    edited = client.put(_url(case_id), json={"text": s["text"] + "\n\nKontrol için iki hafta sonra gelin."}).json()["summary"]
    assert edited["edited"] is True and edited["status"] == "draft"
    approved = client.post(_url(case_id, "/approve")).json()["summary"]
    assert approved["status"] == "approved" and approved["approved_at"]

    pdf = client.get(_url(case_id, ".pdf"))
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:5] == b"%PDF-" and len(pdf.content) > 1500
    kinds = [e["event_type"] for e in container.audit.list_events(limit=500)]
    for k in ("owner_summary.generate", "owner_summary.edit", "owner_summary.approve", "owner_summary.pdf"):
        assert k in kinds


def test_editing_an_approved_note_needs_a_new_approval(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    case_id = _approved_case(client)
    client.post(_url(case_id))
    client.post(_url(case_id, "/approve"))
    after = client.put(_url(case_id), json={"text": "Yeni metin."}).json()["summary"]
    assert after["status"] == "draft" and after["approved_by"] is None
    assert client.get(_url(case_id, ".pdf")).status_code == 409


def test_edit_flags_unsafe_text_and_rejects_empty(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    case_id = _approved_case(client)
    client.post(_url(case_id))
    flagged = client.put(_url(case_id), json={"text": "Günde 10 mg/kg verin."}).json()["summary"]
    assert flagged["warnings"] == ["dose"]
    assert client.put(_url(case_id), json={"text": "   "}).status_code == 422


def test_english_note(tmp_path: Path) -> None:
    client, _ = _app(tmp_path)
    case_id = _approved_case(client)
    s = client.post(_url(case_id), json={"language": "en"}).json()
    assert s["summary"]["language"] == "en" and "What was seen?" in s["summary"]["text"]
    assert "not a diagnosis" in s["disclaimer"]


def test_report_revision_makes_the_note_stale(tmp_path: Path) -> None:
    client, container = _app(tmp_path)
    case_id = _approved_case(client)
    client.post(_url(case_id))
    client.post(_url(case_id, "/approve"))
    # Simulate a later approved report version (revision after approval).
    case = container.repo.get_case(case_id)
    newer = case.report_versions[-1].model_copy(update={"version": case.report_versions[-1].version + 1})
    case.report_versions.append(newer)
    container.repo.save_case(case)
    state = client.get(_url(case_id)).json()
    assert state["stale"] is True
    assert client.get(_url(case_id, ".pdf")).status_code == 409
    assert client.post(_url(case_id, "/approve")).json()["detail"]["code"] == "owner_summary_stale"
    fresh = client.post(_url(case_id)).json()
    assert fresh["stale"] is False and fresh["summary"]["report_version"] == newer.version


def test_unsafe_model_text_falls_back_to_the_template(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client, container = _app(tmp_path)
    case_id = _approved_case(client)  # report made by the mock pipeline
    _use_real_model(container)
    monkeypatch.setattr(osum, "_openai_compatible_chat", lambda **kw: "Kesinlikle tümör. 5 mg/kg verin.")
    s = client.post(_url(case_id)).json()["summary"]
    assert s["source"] == "template" and "Ne görüldü?" in s["text"]
    assert set(s["warnings"]) == {"model_text_rejected:dose", "model_text_rejected:certainty"}

    monkeypatch.setattr(
        osum,
        "_openai_compatible_chat",
        lambda **kw: "Ne yapıldı?\nMR çekildi [F1].\n\nNe görüldü?\nKüçük bir değişiklik var.\n\nBu ne anlama geliyor?\nVeteriner hekiminiz açıklayacak.\n\nSonraki adımlar\nKontrol.",
    )
    good = client.post(_url(case_id)).json()["summary"]
    assert good["source"] == "llm" and good["warnings"] == [] and "[F1]" not in good["text"]


def test_model_never_sees_names(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client, container = _app(tmp_path)
    case_id = _approved_case(client, patient_name="Karamel", owner_name="Ayşe Yılmaz")
    _use_real_model(container)
    case = container.repo.get_case(case_id)
    snap = case.report_versions[-1]
    snap.content.impression.text = "Karamel adlı hastada Ayşe Yılmaz'ın belirttiği şikâyet [F1]."
    container.repo.save_case(case)
    sent: list[str] = []

    def fake(**kw):
        sent.append(" ".join(m["content"] for m in kw["messages"]))
        return "Ne yapıldı?\nÇekim yapıldı."

    monkeypatch.setattr(osum, "_openai_compatible_chat", fake)
    client.post(_url(case_id))
    assert sent and "Karamel" not in sent[0] and "Ayşe" not in sent[0]


def test_roles(tmp_path: Path) -> None:
    settings_kw = dict(
        auth_enabled=True,
        auth_api_key="k",
        jwt_secret="test-secret-owner-summary-1234567890",
        tenant_isolation=True,
    )
    client, _ = _app(tmp_path, **settings_kw)

    def hdr(email: str) -> dict[str, str]:
        tok = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"}).json()["access_token"]
        return {"Authorization": f"Bearer {tok}"}

    vet, expert, vet_b = hdr("vet@demo.local"), hdr("expert@demo.local"), hdr("vet-b@demo.local")
    case_id = client.post("/api/v1/cases", json=make_payload().model_dump(mode="json"), headers=vet).json()["case_id"]
    client.post(f"/api/v1/cases/{case_id}/analyze", headers=vet)
    assert client.post(
        f"/api/v1/cases/{case_id}/review", json={"reviewer_id": "x", "action": "approve"}, headers=expert
    ).status_code == 200
    assert client.post(_url(case_id), headers=vet).status_code == 200
    assert client.get(_url(case_id), headers=expert).status_code == 200  # radiologist reads
    assert client.post(_url(case_id), headers=expert).status_code == 403
    assert client.get(_url(case_id), headers=vet_b).status_code == 404  # other clinic


def test_pdf_layout(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.schemas.case import CaseRecord, OwnerSummary
    from app.schemas.enums import AnatomicalRegion, Modality, Species
    from app.services import pdf_report

    seen: list[tuple[str, str]] = []
    real = __import__("reportlab.platypus", fromlist=["Paragraph"]).Paragraph

    def capture(text, style, *a, **k):
        seen.append((style.name, str(text)))
        return real(text, style, *a, **k)

    monkeypatch.setattr(pdf_report, "Paragraph", capture)
    monkeypatch.setattr(pdf_report, "_resolve_font", lambda: "Helvetica")
    case = CaseRecord(case_id="case-own-1", patient_name="Pamuk", species=Species.FELINE,
                      modality=Modality.MR, anatomical_region=AnatomicalRegion.BRAIN)
    summary = OwnerSummary(text="Ne yapıldı?\nMR çekildi.\n\nNe görüldü?\nKüçük bir değişiklik.", report_version=1,
                           status="approved", approved_by="vet@demo.local")
    pdf = pdf_report.build_owner_summary_pdf(case, summary, osum.DISCLAIMER["tr"])
    assert pdf[:5] == b"%PDF-"
    styles = {name for name, _ in seen}
    texts = " | ".join(t for _, t in seen)
    assert "Hayvan Sahibi İçin Bilgilendirme" in texts and "Pamuk" in texts
    assert [t for n, t in seen if n == "OH"] == ["Ne yapıldı?", "Ne görüldü?"]
    assert seen[-1][0] == "ON" and "tanı veya tedavi önerisi değildir" in seen[-1][1]
    assert {"OT", "OM", "OB"} <= styles
