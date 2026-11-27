"""Vet ↔ radiologist / support-team messaging (B2B)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.services.repository import InMemoryCaseRepository
from app.settings import Settings


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        storage_backend="memory",
        sqlite_path=tmp_path / "unused.sqlite3",
        quarantine_root=tmp_path / "q",
        auth_enabled=True,
        auth_api_key="test-api-key",
        jwt_secret="test-secret-messaging",
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


def test_vet_radiologist_thread_and_reply(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")

    created = client.post(
        "/api/v1/messages/threads",
        json={
            "channel": "radiologist",
            "recipient_subject": "expert@demo.local",
            "subject": "Rapor sorusu",
            "body": "MR bulgusu hakkında bilgi alabilir miyim?",
        },
        headers=_hdr(owner),
    )
    assert created.status_code == 201, created.text
    tid = created.json()["thread"]["thread_id"]
    assert created.json()["thread"]["channel"] == "radiologist"

    expert_list = client.get("/api/v1/messages/threads", headers=_hdr(expert))
    assert expert_list.status_code == 200
    assert any(t["thread_id"] == tid for t in expert_list.json())

    reply = client.post(
        f"/api/v1/messages/threads/{tid}/messages",
        json={"body": "Rapor onaylandıktan sonra detay paylaşacağız."},
        headers=_hdr(expert),
    )
    assert reply.status_code == 200, reply.text

    detail = client.get(f"/api/v1/messages/threads/{tid}", headers=_hdr(owner))
    assert detail.status_code == 200
    assert len(detail.json()["messages"]) == 2

    ntf = client.get("/api/v1/notifications", headers=_hdr(expert))
    assert any(i["kind"] == "support_message" for i in ntf.json()["items"])


def test_vet_support_channel_isolated_from_expert(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")
    admin = _token(client, "admin@demo.local")

    created = client.post(
        "/api/v1/messages/threads",
        json={"channel": "admin", "subject": "Hesap yardımı", "body": "Şifre sıfırlama"},
        headers=_hdr(owner),
    )
    assert created.status_code == 201, created.text
    tid = created.json()["thread"]["thread_id"]

    expert_list = client.get("/api/v1/messages/threads", headers=_hdr(expert)).json()
    assert not any(t["thread_id"] == tid for t in expert_list)

    admin_list = client.get("/api/v1/messages/threads", headers=_hdr(admin)).json()
    assert any(t["thread_id"] == tid for t in admin_list)

    reply = client.post(
        f"/api/v1/messages/threads/{tid}/messages",
        json={"body": "Destek ekibi yardımcı olacak."},
        headers=_hdr(admin),
    )
    assert reply.status_code == 200
    assert reply.json()["author_role"] == "admin"
    assert reply.json()["author_subject"] == "admin@demo.local"

    detail = client.get(f"/api/v1/messages/threads/{tid}", headers=_hdr(owner)).json()
    roles = {m["author_role"] for m in detail["messages"]}
    assert "admin" in roles
    assert "vet" in roles


def test_delete_own_message_and_thread(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")

    created = client.post(
        "/api/v1/messages/threads",
        json={"channel": "radiologist", "recipient_subject": "expert@demo.local", "subject": "Silinecek", "body": "İlk mesaj"},
        headers=_hdr(owner),
    )
    assert created.status_code == 201, created.text
    tid = created.json()["thread"]["thread_id"]
    first_id = created.json()["messages"][0]["message_id"]

    reply = client.post(
        f"/api/v1/messages/threads/{tid}/messages",
        json={"body": "Uzman yanıtı"},
        headers=_hdr(expert),
    )
    assert reply.status_code == 200, reply.text
    reply_id = reply.json()["message_id"]

    # Vet cannot delete expert's message
    forbidden = client.delete(
        f"/api/v1/messages/threads/{tid}/messages/{reply_id}",
        headers=_hdr(owner),
    )
    assert forbidden.status_code == 403

    # Expert deletes own reply → soft delete, conversation keeps a placeholder
    deleted = client.delete(
        f"/api/v1/messages/threads/{tid}/messages/{reply_id}",
        headers=_hdr(expert),
    )
    assert deleted.status_code == 200, deleted.text
    msgs = {m["message_id"]: m for m in deleted.json()["messages"]}
    assert msgs[reply_id]["deleted"] is True
    assert msgs[reply_id]["body"] == "Uzman yanıtı"  # deleter still sees what undo brings back
    assert msgs[reply_id]["restorable_until"]
    assert msgs[first_id]["deleted"] is False

    # The other side only sees "deleted", never the text
    seen = client.get(f"/api/v1/messages/threads/{tid}", headers=_hdr(owner)).json()
    other = next(m for m in seen["messages"] if m["message_id"] == reply_id)
    assert other["deleted"] is True and other["body"] == "" and other["restorable_until"] is None

    # Deleting every message keeps the conversation (it is removed with "delete thread")
    last = client.delete(
        f"/api/v1/messages/threads/{tid}/messages/{first_id}",
        headers=_hdr(owner),
    )
    assert last.status_code == 200
    assert client.get(f"/api/v1/messages/threads/{tid}", headers=_hdr(owner)).status_code == 200


def test_delete_thread_endpoint(tmp_path: Path) -> None:
    client = _client(tmp_path)
    owner = _token(client, "vet@demo.local")

    created = client.post(
        "/api/v1/messages/threads",
        json={"channel": "admin", "subject": "Konuşma sil", "body": "Merhaba"},
        headers=_hdr(owner),
    )
    tid = created.json()["thread"]["thread_id"]

    gone = client.delete(f"/api/v1/messages/threads/{tid}", headers=_hdr(owner))
    assert gone.status_code == 204
    assert client.get(f"/api/v1/messages/threads/{tid}", headers=_hdr(owner)).status_code == 404


def test_clinic_manager_and_vet_message_each_other(tmp_path: Path) -> None:
    client = _client(tmp_path)
    manager = _token(client, "clinic-owner@demo.local")
    vet = _token(client, "vet@demo.local")
    expert = _token(client, "expert@demo.local")

    # The manager sees the clinic's own vet, not the other clinic's vet.
    recipients = client.get("/api/v1/messages/recipients", headers=_hdr(manager))
    assert recipients.status_code == 200, recipients.text
    clinic_peers = {r["subject"] for r in recipients.json() if r["channel"] == "clinic"}
    assert clinic_peers == {"vet@demo.local"}

    # The vet sees the manager as a clinic recipient.
    vet_recipients = client.get("/api/v1/messages/recipients", headers=_hdr(vet)).json()
    assert {r["subject"] for r in vet_recipients if r["channel"] == "clinic"} == {"clinic-owner@demo.local"}

    created = client.post(
        "/api/v1/messages/threads",
        json={
            "channel": "clinic",
            "recipient_subject": "vet@demo.local",
            "subject": "Geciken rapor",
            "body": "Pax vakasının raporu gecikti, radyologla görüşebilir misin?",
        },
        headers=_hdr(manager),
    )
    assert created.status_code == 201, created.text
    thread = created.json()["thread"]
    assert thread["channel"] == "clinic"
    assert thread["counterpart_role"] == "vet"
    tid = thread["thread_id"]

    vet_threads = client.get("/api/v1/messages/threads", headers=_hdr(vet)).json()
    assert any(t["thread_id"] == tid and t["counterpart_role"] == "clinic_owner" for t in vet_threads)

    reply = client.post(
        f"/api/v1/messages/threads/{tid}/messages",
        json={"body": "Tamam, bugün yazıyorum."},
        headers=_hdr(vet),
    )
    assert reply.status_code == 200, reply.text

    # A radiologist cannot read the clinic's internal conversation.
    expert_threads = client.get("/api/v1/messages/threads", headers=_hdr(expert)).json()
    assert not any(t["thread_id"] == tid for t in expert_threads)
    assert client.get(f"/api/v1/messages/threads/{tid}", headers=_hdr(expert)).status_code == 404


def test_clinic_manager_cannot_message_other_clinic_vet(tmp_path: Path) -> None:
    client = _client(tmp_path)
    manager = _token(client, "clinic-owner@demo.local")
    res = client.post(
        "/api/v1/messages/threads",
        json={
            "channel": "clinic",
            "recipient_subject": "vet-b@demo.local",
            "subject": "Merhaba",
            "body": "Test",
        },
        headers=_hdr(manager),
    )
    assert res.status_code == 404, res.text
