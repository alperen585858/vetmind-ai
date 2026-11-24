"""Live messaging: undoable delete, SSE broker/tickets, pushed events, presence."""

from __future__ import annotations

import asyncio
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.live_events import (
    LiveEventBroker,
    StreamIdentity,
    StreamTicketService,
    event_stream,
    format_sse,
)
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-live",
        tenant_isolation=True,
        async_analyze_delay_ms=0,
    )
    return TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))


def _token(client: TestClient, email: str) -> str:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": "demo1234"})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _hdr(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _thread(client: TestClient, vet: str) -> tuple[str, str]:
    res = client.post(
        "/api/v1/messages/threads",
        json={
            "channel": "radiologist",
            "recipient_subject": "expert@demo.local",
            "subject": "Vaka",
            "body": "İlk mesaj",
        },
        headers=_hdr(vet),
    )
    assert res.status_code == 201, res.text
    return res.json()["thread"]["thread_id"], res.json()["messages"][0]["message_id"]


# --- undoable delete -----------------------------------------------------------------


def test_delete_then_undo_restores_message(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    tid, mid = _thread(client, vet)

    assert client.delete(f"/api/v1/messages/threads/{tid}/messages/{mid}", headers=_hdr(vet)).status_code == 200
    # Deleted messages do not count as unread for the other side.
    listed = client.get("/api/v1/messages/threads", headers=_hdr(expert)).json()
    assert next(t for t in listed if t["thread_id"] == tid)["unread_count"] == 0

    # Only the deleter can undo.
    assert (
        client.post(f"/api/v1/messages/threads/{tid}/messages/{mid}/restore", headers=_hdr(expert)).status_code
        == 403
    )
    restored = client.post(f"/api/v1/messages/threads/{tid}/messages/{mid}/restore", headers=_hdr(vet))
    assert restored.status_code == 200, restored.text
    msg = restored.json()["messages"][0]
    assert msg["deleted"] is False and msg["body"] == "İlk mesaj"

    other = client.get(f"/api/v1/messages/threads/{tid}", headers=_hdr(expert)).json()["messages"][0]
    assert other["body"] == "İlk mesaj"

    # Restoring a message that is not deleted is a conflict.
    again = client.post(f"/api/v1/messages/threads/{tid}/messages/{mid}/restore", headers=_hdr(vet))
    assert again.status_code == 409


def test_text_is_purged_after_undo_window(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    tid, mid = _thread(client, vet)
    assert client.delete(f"/api/v1/messages/threads/{tid}/messages/{mid}", headers=_hdr(vet)).status_code == 200

    container = client.app.state.container  # type: ignore[attr-defined]
    store = container.messaging_store
    thread = store.get_thread(tid)
    old = thread.messages[0].deleted_at - timedelta(minutes=10)
    store.save_thread(thread.model_copy(update={"messages": [thread.messages[0].model_copy(update={"deleted_at": old})]}))

    late = client.post(f"/api/v1/messages/threads/{tid}/messages/{mid}/restore", headers=_hdr(vet))
    assert late.status_code == 410
    view = client.get(f"/api/v1/messages/threads/{tid}", headers=_hdr(vet)).json()["messages"][0]
    assert view["deleted"] is True and view["body"] == "" and view["restorable_until"] is None
    assert store.get_thread(tid).messages[0].body == ""  # purged in storage, not just hidden


def test_read_receipt_is_reported_on_own_messages(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    tid, _ = _thread(client, vet)
    before = client.get(f"/api/v1/messages/threads/{tid}", headers=_hdr(vet)).json()["messages"][0]
    assert before["read_by_other"] is False
    client.post(f"/api/v1/messages/threads/{tid}/read", headers=_hdr(expert))
    after = client.get(f"/api/v1/messages/threads/{tid}", headers=_hdr(vet)).json()["messages"][0]
    assert after["read_by_other"] is True


# --- tickets and stream --------------------------------------------------------------


def test_stream_ticket_is_single_use_and_expires() -> None:
    now = [100.0]
    tickets = StreamTicketService(ttl_seconds=60, clock=lambda: now[0])
    who = StreamIdentity(subject="vet@demo.local", role="vet", clinic_id="clinic-demo-a")
    raw = tickets.issue(who)
    assert tickets.consume(raw) == who
    assert tickets.consume(raw) is None  # single use

    late = tickets.issue(who)
    now[0] += 61
    assert tickets.consume(late) is None


def test_stream_requires_a_valid_ticket(tmp_path: Path) -> None:
    client = _client(tmp_path)
    assert client.get("/api/v1/live/stream?ticket=not-a-real-ticket").status_code == 401
    vet = _token(client, "vet@demo.local")
    res = client.post("/api/v1/messages/stream-ticket", headers=_hdr(vet))
    assert res.status_code == 200
    assert res.json()["expires_in"] == 60 and len(res.json()["ticket"]) > 20
    # Ticket endpoint itself needs a signed-in user.
    assert client.post("/api/v1/messages/stream-ticket").status_code == 401


def test_event_stream_yields_ready_events_and_heartbeats() -> None:
    async def run() -> list[str]:
        broker = LiveEventBroker()
        frames: list[str] = []
        calls = {"n": 0}

        async def gone() -> bool:
            calls["n"] += 1
            return calls["n"] > 3

        gen = event_stream(broker, "vet@demo.local", is_disconnected=gone, heartbeat_s=0.05)
        frames.append(await gen.__anext__())  # retry
        frames.append(await gen.__anext__())  # ready
        assert broker.is_online("vet@demo.local")
        broker.publish({"vet@demo.local", "someone-else"}, {"type": "message.created", "x": 1})
        frames.append(await gen.__anext__())
        frames.append(await gen.__anext__())  # heartbeat (nothing queued)
        async for _ in gen:
            pass
        assert not broker.is_online("vet@demo.local")
        return frames

    frames = asyncio.run(run())
    assert frames[0].startswith("retry:")
    assert frames[1] == format_sse({"type": "ready"})
    assert frames[2].startswith("event: message.created\n")
    assert frames[3] == ": ping\n\n"


# --- events pushed by the services -----------------------------------------------------


def _collect(client: TestClient, subject: str, action) -> list[dict]:
    """Subscribe ``subject``, run the (sync) ``action`` in a thread, return events received."""
    container = client.app.state.container  # type: ignore[attr-defined]

    async def run() -> list[dict]:
        sub = container.live_events.subscribe(subject)
        try:
            await asyncio.to_thread(action)
            events: list[dict] = []
            while True:
                try:
                    events.append(await asyncio.wait_for(sub.queue.get(), timeout=0.3))
                except asyncio.TimeoutError:
                    return events
        finally:
            container.live_events.unsubscribe(sub)

    return asyncio.run(run())


def test_new_message_delete_undo_and_read_are_pushed(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    tid, mid = _thread(client, vet)

    def act() -> None:
        client.post(f"/api/v1/messages/threads/{tid}/messages", json={"body": "Merhaba"}, headers=_hdr(vet))
        client.delete(f"/api/v1/messages/threads/{tid}/messages/{mid}", headers=_hdr(vet))
        client.post(f"/api/v1/messages/threads/{tid}/messages/{mid}/restore", headers=_hdr(vet))

    events = _collect(client, "expert@demo.local", act)
    types = [e["type"] for e in events]
    assert "message.created" in types and "message.deleted" in types and "message.restored" in types
    created = next(e for e in events if e["type"] == "message.created")
    assert created["thread_id"] == tid and created["message"]["body"] == "Merhaba"
    assert any(e["type"] == "notification" for e in events)

    read_events = _collect(
        client, "vet@demo.local", lambda: client.post(f"/api/v1/messages/threads/{tid}/read", headers=_hdr(expert))
    )
    assert any(e["type"] == "thread.read" and e["reader"] == "expert@demo.local" for e in read_events)


def test_typing_goes_to_others_only_and_outsiders_get_nothing(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    tid, _ = _thread(client, vet)

    def act() -> None:
        assert client.post(f"/api/v1/messages/threads/{tid}/typing", headers=_hdr(vet)).status_code == 204

    to_expert = _collect(client, "expert@demo.local", act)
    assert [e["type"] for e in to_expert] == ["typing"]
    assert to_expert[0]["subject"] == "vet@demo.local"
    assert _collect(client, "vet@demo.local", act) == []  # not echoed to the typer
    outsider = _collect(
        client,
        "expert-b@demo.local",
        lambda: client.post(f"/api/v1/messages/threads/{tid}/messages", json={"body": "gizli"}, headers=_hdr(vet)),
    )
    assert outsider == []


def test_typing_requires_access(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    expert_b = _token(client, "expert-b@demo.local")
    tid, _ = _thread(client, vet)
    assert client.post(f"/api/v1/messages/threads/{tid}/typing", headers=_hdr(expert_b)).status_code == 404


def test_counterpart_online_reflects_open_stream(tmp_path: Path) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    tid, _ = _thread(client, vet)
    container = client.app.state.container  # type: ignore[attr-defined]

    def online() -> bool:
        listed = client.get("/api/v1/messages/threads", headers=_hdr(vet)).json()
        return next(t for t in listed if t["thread_id"] == tid)["counterpart_online"]

    assert online() is False

    async def run() -> bool:
        sub = container.live_events.subscribe("expert@demo.local")
        try:
            return await asyncio.to_thread(online)
        finally:
            container.live_events.unsubscribe(sub)

    assert asyncio.run(run()) is True


@pytest.mark.parametrize("body", ["", "   "])
def test_blank_reply_rejected(tmp_path: Path, body: str) -> None:
    client = _client(tmp_path)
    vet = _token(client, "vet@demo.local")
    tid, _ = _thread(client, vet)
    res = client.post(f"/api/v1/messages/threads/{tid}/messages", json={"body": body}, headers=_hdr(vet))
    assert res.status_code == 422


def test_demo_mode_uses_signed_in_token_for_attribution(tmp_path: Path) -> None:
    """Auth off + a browser that holds a JWT (no demo headers): messages are still
    attributed to the signed-in user, not 'anonymous'."""
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=False,
        jwt_secret="test-secret-live-demo",
        async_analyze_delay_ms=0,
    )
    client = TestClient(create_app(AppContainer(repo=InMemoryCaseRepository(), settings=settings)))
    vet = _token(client, "vet@demo.local")
    res = client.post(
        "/api/v1/messages/threads",
        json={"channel": "admin", "subject": "Destek", "body": "Merhaba"},
        headers=_hdr(vet),
    )
    assert res.status_code == 201, res.text
    assert res.json()["thread"]["owner_subject"] == "vet@demo.local"
    assert res.json()["messages"][0]["author_subject"] == "vet@demo.local"
    # A forged token does not give an identity.
    bad = client.post(
        "/api/v1/messages/threads",
        json={"channel": "admin", "subject": "Destek", "body": "Merhaba"},
        headers={"Authorization": "Bearer not.a.jwt"},
    )
    assert bad.json()["messages"][0]["author_subject"] != "vet@demo.local"
