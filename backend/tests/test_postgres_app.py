"""The whole app on PostgreSQL (#102): a case written through the API is there after a
restart, and no SQLite file appears. Runs when VETMIND_TEST_DATABASE_URL is set."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import AppContainer
from app.main import create_app
from app.settings import Settings
from tests.test_sql_stores import _reset_postgres

PG_URL = os.getenv("VETMIND_TEST_DATABASE_URL")
pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(not PG_URL, reason="Set VETMIND_TEST_DATABASE_URL to run the Postgres app test."),
]


def _app(tmp_path: Path) -> tuple[TestClient, AppContainer]:
    settings = Settings(
        storage_backend="postgres",
        database_url=PG_URL,
        sqlite_path=tmp_path / "data" / "vetmind.sqlite3",
        quarantine_root=tmp_path / "data" / "quarantine",
        analyze_gate_path=tmp_path / "data" / "gate.count",
        rag_backend="lexical",
        async_analyze_delay_ms=0,
    )
    container = AppContainer(settings=settings)
    return TestClient(create_app(container)), container


def test_case_survives_restart_and_no_sqlite_files(tmp_path: Path) -> None:
    from app.storage import sql

    _reset_postgres(PG_URL)
    sql._migrated.discard(sql.Database(PG_URL).url)  # schema was dropped: migrate again

    client, container = _app(tmp_path)
    assert container.storage_backend == "postgres"
    res = client.post(
        "/api/v1/cases",
        json={"patient_name": "Zeytin", "species": "canine", "modality": "XR", "anatomical_region": "THORAX"},
    )
    assert res.status_code in (200, 201), res.text
    case_id = res.json()["case_id"]
    container.audit.record(event_type="test.event", actor="t", resource="r")
    assert container.lessons is not None  # created against the database

    client2, container2 = _app(tmp_path)
    assert client2.get(f"/api/v1/cases/{case_id}").json()["patient_name"] == "Zeytin"
    assert any(e["event_type"] == "test.event" for e in container2.audit.list_events())
    assert not list(tmp_path.rglob("*.sqlite3"))
