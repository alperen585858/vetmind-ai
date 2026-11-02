"""A slow chat reply must not overwrite changes saved to the case while the model was answering."""

from pathlib import Path

import app.llm.case_chat as chat
from app.schemas.case import ReviewFeedback
from app.schemas.enums import ReviewAction
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.settings import Settings
from tests.test_phase6_e2e_journey import _demo_upload_confirm_analyze


def _sqlite_client(tmp_path: Path) -> TestClient:
    # SQLite returns a fresh copy per read (unlike the in-memory repo), which is what exposes
    # a stale copy being saved over newer data.
    settings = Settings(
        storage_backend="sqlite",
        sqlite_path=tmp_path / "cases.sqlite3",
        quarantine_root=tmp_path / "q",
        async_analyze_delay_ms=0,
    )
    return TestClient(create_app(AppContainer(settings=settings)))


def test_approval_during_chat_call_is_kept(tmp_path: Path, monkeypatch) -> None:
    client = _sqlite_client(tmp_path)
    cid = _demo_upload_confirm_analyze(client)
    service = client.app.state.container.cases

    def slow_answer(case, question, history, settings, **_kwargs):
        # Someone approves the report while the model is still "thinking".
        service.submit_review(cid, ReviewFeedback(reviewer_id="expert-demo", action=ReviewAction.APPROVE))
        return "Cevap.", "ollama"

    monkeypatch.setattr(chat, "answer_case_question", slow_answer)
    res = client.post(f"/api/v1/cases/{cid}/ai-chat", json={"message": "Bu lezyon ne olabilir?"})
    assert res.status_code == 200, res.text
    case = client.get(f"/api/v1/cases/{cid}").json()
    assert case["status"] == "approved", "approval saved during the chat call was lost"
    assert [t["role"] for t in case["ai_chat"]] == ["user", "assistant"]
