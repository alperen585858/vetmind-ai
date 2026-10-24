import json
from pathlib import Path

from tests.test_phase6_e2e_journey import _auth_client, _client, _demo_upload_confirm_analyze, _hdr, _token

from app.llm.feedback import similarity


def test_feedback_captures_ai_text_vs_expert_edit(tmp_path: Path) -> None:
    client = _client(tmp_path)
    edited_id = _demo_upload_confirm_analyze(client)
    plain_id = _demo_upload_confirm_analyze(client)
    pending_id = _demo_upload_confirm_analyze(client)

    draft = client.get(f"/api/v1/cases/{edited_id}/report").json()
    ai_impression = draft["ai_sections"]["impression"]
    assert ai_impression == draft["impression"]["text"]

    res = client.post(
        f"/api/v1/cases/{edited_id}/review",
        json={
            "reviewer_id": "expert-demo",
            "action": "approve",
            "comment": "Yorum yeniden yazıldı",
            "edited_impression": "SynthPax: meningiom olası; kontrastlı seri ile değerlendirilmeli.",
        },
    )
    assert res.status_code == 200, res.text
    approved = res.json()["draft_report"]
    assert approved["ai_sections"]["impression"] == ai_impression  # survives approval
    client.post(
        f"/api/v1/cases/{plain_id}/review",
        json={"reviewer_id": "expert-demo", "action": "reject", "comment": "Yetersiz"},
    )

    summary = client.get("/api/v1/llm/feedback", params={"include_records": True}).json()
    assert summary["reviews"] == 2  # pending case excluded
    assert summary["by_decision"] == {"approved": 1, "rejected": 1}
    assert summary["sections"]["impression"]["edited_rate"] == 0.5
    assert summary["sections"]["technique"]["edited_rate"] == 0.0

    rec = next(r for r in summary["records"] if r["case_id"] == edited_id)
    assert rec["edited_sections"] == ["impression"]
    imp = next(s for s in rec["sections"] if s["section"] == "impression")
    assert imp["similarity"] < 0.5
    assert "SynthPax" not in imp["final_text"] and "[HASTA]" in imp["final_text"]
    assert all(r["case_id"] != pending_id for r in summary["records"])

    model_key = next(iter(summary["models"]))
    assert summary["models"][model_key]["approved_rate"] == 0.5
    assert summary["models"][model_key]["approved_unedited_rate"] == 0.0


def test_feedback_exports_jsonl_and_chat(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = _demo_upload_confirm_analyze(client)
    client.post(f"/api/v1/cases/{case_id}/review", json={"reviewer_id": "expert-demo", "action": "approve"})

    raw = client.get("/api/v1/llm/feedback/export").text.strip().splitlines()
    assert len(raw) == 1 and json.loads(raw[0])["decision"] == "approved"

    chat = client.get("/api/v1/llm/feedback/export", params={"format": "chat"})
    assert chat.headers["content-type"].startswith("application/x-ndjson")
    example = json.loads(chat.text.strip())
    roles = [m["role"] for m in example["messages"]]
    assert roles == ["system", "user", "assistant"]
    target = json.loads(example["messages"][2]["content"])
    assert set(target) == {"technique", "findings", "impression", "recommendations"}
    assert "SynthPax" not in chat.text


def test_feedback_requires_admin(tmp_path: Path) -> None:
    client = _auth_client(tmp_path)
    vet = _token(client, "vet@demo.local")
    assert client.get("/api/v1/llm/feedback", headers=_hdr(vet)).status_code == 403
    admin = _token(client, "admin@demo.local")
    assert client.get("/api/v1/llm/feedback", headers=_hdr(admin)).status_code == 200


def test_similarity() -> None:
    assert similarity("a b c", " a b c ") == 1.0
    assert 0 < similarity("meningiom olası", "meningiom olası değil") < 1
