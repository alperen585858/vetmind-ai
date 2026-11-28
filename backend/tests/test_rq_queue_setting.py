"""The API enqueues on VETMIND_RQ_QUEUE so the GPU worker (vetmind-gpu) can receive jobs."""

from __future__ import annotations

import pytest

from app.settings import load_settings
from app.workers import job_backend as jb


def test_rq_queue_defaults_to_vetmind(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("VETMIND_RQ_QUEUE", raising=False)
    assert load_settings().rq_queue == "vetmind"


def test_rq_queue_read_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VETMIND_RQ_QUEUE", " vetmind-gpu ")
    assert load_settings().rq_queue == "vetmind-gpu"


def test_build_job_backend_passes_queue_name(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, str] = {}

    def fake_init(self, redis_url: str, queue_name: str = "vetmind") -> None:  # noqa: ANN001
        seen["redis_url"] = redis_url
        seen["queue_name"] = queue_name

    monkeypatch.setattr(jb.RqJobBackend, "__init__", fake_init)
    backend = jb.build_job_backend(
        backend="rq", delay_ms=0, redis_url="redis://x:6379/0", queue_name="vetmind-gpu"
    )
    assert isinstance(backend, jb.RqJobBackend)
    assert seen == {"redis_url": "redis://x:6379/0", "queue_name": "vetmind-gpu"}


def test_build_job_backend_empty_queue_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, str] = {}
    monkeypatch.setattr(
        jb.RqJobBackend, "__init__",
        lambda self, redis_url, queue_name="vetmind": seen.update(q=queue_name),
    )
    jb.build_job_backend(backend="rq", delay_ms=0, redis_url="redis://x", queue_name="")
    assert seen["q"] == "vetmind"
