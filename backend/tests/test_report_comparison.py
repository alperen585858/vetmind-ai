"""Issue #108 — "change since the prior study" section of the AI report."""

from __future__ import annotations

import re

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.llm.comparison import build_comparison, comparison_warnings, format_study_date
from tests.conftest import make_payload


def _patient(client: TestClient, name: str = "Pax") -> str:
    res = client.post("/api/v1/patients", json={"name": name, "species": "canine"})
    assert res.status_code == 201, res.text
    return res.json()["patient_id"]


def _analyzed(client: TestClient, **kw) -> dict:
    case_id = client.post("/api/v1/cases", json=make_payload(**kw).model_dump(mode="json")).json()["case_id"]
    res = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert res.status_code == 200, res.text
    return client.get(f"/api/v1/cases/{case_id}").json()


def _approve(client: TestClient, case_id: str) -> None:
    res = client.post(f"/api/v1/cases/{case_id}/review", json={"reviewer_id": "expert-demo", "action": "approve"})
    assert res.status_code == 200, res.text


def test_case_without_patient_has_no_comparison(client: TestClient) -> None:
    case = _analyzed(client)
    assert case["draft_report"]["comparison"] is None


def test_patient_without_prior_says_so(client: TestClient) -> None:
    case = _analyzed(client, patient_id=_patient(client))
    comp = case["draft_report"]["comparison"]
    assert comp["prior_case_id"] is None
    assert comp["text"] == "Karşılaştırılacak önceki tetkik yok."


def test_unapproved_prior_is_not_used(client: TestClient) -> None:
    pid = _patient(client)
    _analyzed(client, patient_id=pid)  # analysed but never approved
    comp = _analyzed(client, patient_id=pid)["draft_report"]["comparison"]
    assert comp["prior_case_id"] is None


def test_persisting_findings_cite_both_studies(client: TestClient) -> None:
    pid = _patient(client)
    old = _analyzed(client, patient_id=pid)
    _approve(client, old["case_id"])
    new = _analyzed(client, patient_id=pid)
    report = new["draft_report"]
    comp = report["comparison"]
    assert comp["prior_case_id"] == old["case_id"]
    assert comp["citation_map"] == {"P1": old["case_id"]}
    assert comp["prior_report_version"] >= 1
    assert comp["persisting_finding_codes"] and not comp["new_finding_codes"] and not comp["resolved_finding_codes"]
    assert "Devam eden bulgu" in comp["text"] and "[P1]" in comp["text"]
    assert "radyolog tarafından değerlendirilmelidir" in comp["text"]
    # Every alias in the section resolves.
    known = set(comp["citation_map"]) | set(report["citation_map"])
    assert set(re.findall(r"\[([A-Z]+\d+)\]", comp["text"])) <= known
    assert not [w for w in report["validation_warnings"] if "Comparison section" in w]


def test_different_scenario_gives_new_and_resolved(client: TestClient) -> None:
    pid = _patient(client)
    old = _analyzed(client, patient_id=pid, scenario="no_findings")
    _approve(client, old["case_id"])
    new = _analyzed(client, patient_id=pid)
    comp = new["draft_report"]["comparison"]
    assert comp["prior_case_id"] == old["case_id"]
    assert comp["new_finding_codes"]
    assert "Yeni bulgu" in comp["text"]


def test_other_region_prior_is_not_compared(client: TestClient) -> None:
    pid = _patient(client)
    old = _analyzed(client, patient_id=pid, modality="XR", anatomical_region="THORAX", scenario="xr_thorax_suspected")
    _approve(client, old["case_id"])
    comp = _analyzed(client, patient_id=pid)["draft_report"]["comparison"]
    assert comp["prior_case_id"] is None


def test_patient_name_is_scrubbed_from_prior_impression(client: TestClient, container: AppContainer) -> None:
    pid = _patient(client)
    old = _analyzed(client, patient_id=pid, patient_name="Karamel")
    record = container.repo.get_case(old["case_id"])
    record.draft_report.impression.text = "Karamel adlı hastada bulgu [F1] mevcut."
    container.repo.save_case(record)
    _approve(client, old["case_id"])
    comp = _analyzed(client, patient_id=pid, patient_name="Karamel")["draft_report"]["comparison"]
    assert "Karamel" not in comp["text"]
    assert "[HASTA]" in comp["text"]
    assert "[F1] mevcut" not in comp["text"]  # the prior's own citation aliases are dropped


def test_expert_edit_is_kept_and_frozen_on_approve(client: TestClient) -> None:
    pid = _patient(client)
    old = _analyzed(client, patient_id=pid)
    _approve(client, old["case_id"])
    new = _analyzed(client, patient_id=pid)
    saved = client.put(
        f"/api/v1/cases/{new['case_id']}/report/draft",
        json={"editor_id": "expert-demo", "comparison": "Lezyon boyutu değişmedi [P1]."},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["comparison"]["text"] == "Lezyon boyutu değişmedi [P1]."
    assert saved.json()["comparison"]["source"] == "expert"
    _approve(client, new["case_id"])
    approved = client.get(f"/api/v1/cases/{new['case_id']}/report").json()
    assert approved["comparison"]["text"] == "Lezyon boyutu değişmedi [P1]."


def test_english_report_language(client: TestClient, container: AppContainer) -> None:
    pid = _patient(client)
    old = _analyzed(client, patient_id=pid)
    _approve(client, old["case_id"])
    case = container.repo.get_case(_analyzed(client, patient_id=pid)["case_id"])
    prior = container.patients.prior_for_report(case)
    comp = build_comparison(case, case.draft_report, prior, language="en")
    assert comp.text.startswith("Compared with the prior study of ")
    assert "Persisting finding" in comp.text


def test_unknown_alias_is_flagged(client: TestClient, container: AppContainer) -> None:
    case = container.repo.get_case(_analyzed(client, patient_id=_patient(client))["case_id"])
    report = case.draft_report
    report.comparison = report.comparison.model_copy(update={"text": "Bkz. [P9] ve [F99]."})
    assert comparison_warnings(report) == ["Comparison section cites unknown source(s): F99, P9"]


def test_format_study_date() -> None:
    assert format_study_date("20260803", "tr") == "03.08.2026"
    assert format_study_date("20260803", "en") == "2026-08-03"
    assert format_study_date("2026-08", "tr") is None
    assert format_study_date(None, "tr") is None
