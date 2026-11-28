"""Issue #106 — audit query in memory and JSONL modes (SQL modes: test_sql_stores.py)."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.security.audit import AuditLogger, AuditQuery
from tests.test_sql_stores import audit_sample_events


@pytest.fixture(params=["memory", "file"])
def log(request, tmp_path: Path) -> AuditLogger:
    events = audit_sample_events()
    if request.param == "memory":
        logger = AuditLogger()
        logger._memory.extend(events)  # noqa: SLF001 — memory mode has no insert path
        return logger
    path = tmp_path / "audit.jsonl"
    # A torn last line (crash mid-write) must not break the screen.
    path.write_text("".join(json.dumps(asdict(e)) + "\n" for e in events) + "{torn line", encoding="utf-8")
    return AuditLogger(path)


def _ids(log: AuditLogger, **kw) -> list[str]:
    return [e["event_id"] for e in log.query(AuditQuery(**kw))[0]]


def test_same_results_as_sql(log: AuditLogger) -> None:
    assert _ids(log) == ["aud-005", "aud-004", "aud-003", "aud-002", "aud-001"]
    assert _ids(log, event_type="auth.") == ["aud-004", "aud-002", "aud-001"]
    assert _ids(log, actor="x_y") == ["aud-004"]
    assert _ids(log, clinic_id="clinic-demo-a") == ["aud-003", "aud-001"]
    page, cur = log.query(AuditQuery(limit=4))
    assert len(page) == 4 and cur
    rest, end = log.query(AuditQuery(limit=4, cursor=cur))
    assert [e["event_id"] for e in rest] == ["aud-001"] and end is None


def test_limit_is_capped_and_bad_cursor_ignored() -> None:
    log = AuditLogger()
    for i in range(3):
        log.record(event_type="auth.login", actor=f"u{i}", resource="/r")
    assert len(log.query(AuditQuery(limit=10_000))[0]) == 3
    assert len(log.query(AuditQuery(limit=0))[0]) == 1
    assert len(log.query(AuditQuery(cursor="garbage"))[0]) == 3


def test_file_mode_reads_history_from_disk(tmp_path: Path) -> None:
    path = tmp_path / "a.jsonl"
    AuditLogger(path).record(event_type="auth.login", actor="old@x", resource="/r")
    fresh = AuditLogger(path)  # new process: memory is empty, the file has history
    assert [e["actor"] for e in fresh.query(AuditQuery())[0]] == ["old@x"]
