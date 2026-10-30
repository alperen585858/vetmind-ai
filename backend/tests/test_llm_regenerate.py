from pathlib import Path

import httpx

from app.llm.chat_providers import OpenAICompatibleProvider
from tests.test_llm_chat_providers import _sequence_transport
from tests.test_phase6_e2e_journey import _auth_client, _client, _demo_upload_confirm_analyze, _hdr, _token

NOTE = "Derin ağrı algısını değerlendir ve ayırıcı tanıya histiyositik sarkomu ekle. Sahibi Ali Demir."


def test_regenerate_with_mock_creates_new_version(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = _demo_upload_confirm_analyze(client)
    before = client.get(f"/api/v1/cases/{case_id}/report").json()

    res = client.post(
        f"/api/v1/cases/{case_id}/report/regenerate", json={"reviewer_id": "expert-demo", "note": NOTE}
    )
    assert res.status_code == 200, res.text
    case = res.json()
    draft = case["draft_report"]
    assert case["status"] == "awaiting_review"
    assert draft["version"] == before["version"] + 1
    assert draft["revision_notes"].startswith("Uzman revizyon talebiyle yeniden üretildi")
    assert "Uzman revizyon talebi alındı" in draft["recommendations"]["text"]  # mock shows the request
    versions = client.get(f"/api/v1/cases/{case_id}/report/versions").json()
    assert [v["version"] for v in versions][-2:] == [before["version"], draft["version"]]


def test_regenerate_sends_redacted_request_and_previous_draft(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = _demo_upload_confirm_analyze(client)
    calls: list = []
    body = {
        "technique": "Köpek, beyin MR incelemesi.",
        "findings": "Şüpheli ekstra-aksiyel kitle etkisi [F1].",
        "impression": "Meningiom olası; histiyositik sarkom ayırıcı tanıda yer alır [F1, S1].",
        "recommendations": "Derin ağrı algısı muayenesi önerilir. Uzman radyolog incelemesi gereklidir.",
    }
    provider = OpenAICompatibleProvider(
        model_id="m", api_key="k", prompt_version="vetmind-report-v3",
        transport=_sequence_transport(body, calls=calls),
    )
    client.app.state.container.llm.set_provider(provider)

    res = client.post(
        f"/api/v1/cases/{case_id}/report/regenerate", json={"reviewer_id": "expert-demo", "note": NOTE}
    )
    assert res.status_code == 200, res.text
    user = calls[0]["messages"][1]["content"]
    assert "EXPERT REVISION REQUEST" in user and "<expert_request>" in user
    assert "histiyositik sarkomu ekle" in user
    assert "Ali Demir" not in user  # expert note is redacted like the history
    assert "PREVIOUS DRAFT" in user
    draft = res.json()["draft_report"]
    assert draft["impression"]["text"] == body["impression"]
    assert draft["ai_sections"]["impression"] == body["impression"]  # feedback baseline = new AI text


def test_regenerate_failure_keeps_current_draft(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = _demo_upload_confirm_analyze(client)
    before = client.get(f"/api/v1/cases/{case_id}/report").json()
    provider = OpenAICompatibleProvider(
        model_id="m", api_key="k", transport=httpx.MockTransport(lambda r: httpx.Response(503))
    )
    client.app.state.container.llm.set_provider(provider)
    res = client.post(
        f"/api/v1/cases/{case_id}/report/regenerate", json={"reviewer_id": "expert-demo", "note": NOTE}
    )
    assert res.status_code == 502 and "unchanged" in res.json()["detail"]
    after = client.get(f"/api/v1/cases/{case_id}/report").json()
    assert after["version"] == before["version"] and after["report_id"] == before["report_id"]


def test_regenerate_rules(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = _demo_upload_confirm_analyze(client)
    short = client.post(f"/api/v1/cases/{case_id}/report/regenerate", json={"reviewer_id": "e", "note": "kısa"})
    assert short.status_code == 422
    client.post(f"/api/v1/cases/{case_id}/review", json={"reviewer_id": "expert-demo", "action": "approve"})
    approved = client.post(
        f"/api/v1/cases/{case_id}/report/regenerate", json={"reviewer_id": "expert-demo", "note": NOTE}
    )
    assert approved.status_code == 409

    auth = _auth_client(tmp_path / "auth")
    vet = _token(auth, "vet@demo.local")
    denied = auth.post(
        f"/api/v1/cases/{case_id}/report/regenerate",
        json={"reviewer_id": "x", "note": NOTE},
        headers=_hdr(vet),
    )
    assert denied.status_code == 403
