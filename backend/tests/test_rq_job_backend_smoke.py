"""RQ job backend wiring smoke (skipped when Redis unavailable)."""

from __future__ import annotations

import os

import pytest

from app.workers.job_backend import RqJobBackend, build_job_backend


def _redis_available() -> bool:
    url = os.getenv("VETMIND_REDIS_URL", "redis://127.0.0.1:6379/0")
    try:
        from redis import Redis

        client = Redis.from_url(url, socket_connect_timeout=0.5)
        client.ping()
        return True
    except Exception:
        return False


@pytest.mark.skipif(not _redis_available(), reason="Redis not reachable for RQ smoke")
def test_rq_job_backend_enqueue_smoke() -> None:
    url = os.getenv("VETMIND_REDIS_URL", "redis://127.0.0.1:6379/0")
    backend = build_job_backend(backend="rq", delay_ms=0, redis_url=url)
    assert backend.name == "rq"
    assert isinstance(backend, RqJobBackend)
