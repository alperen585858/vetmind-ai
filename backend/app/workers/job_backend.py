"""Pluggable analyze job backends: thread (default) or RQ (optional Redis)."""

from __future__ import annotations

import logging
import threading
import time
from typing import Callable, Protocol

logger = logging.getLogger(__name__)


class JobBackend(Protocol):
    name: str

    def enqueue_analyze(self, case_id: str, job_id: str, work: Callable[[], None]) -> None: ...


class ThreadJobBackend:
    name = "thread"

    def __init__(self, delay_ms: int = 0) -> None:
        self._delay_ms = max(0, delay_ms)

    def enqueue_analyze(self, case_id: str, job_id: str, work: Callable[[], None]) -> None:
        def _runner() -> None:
            if self._delay_ms:
                time.sleep(self._delay_ms / 1000.0)
            try:
                work()
            except Exception:  # noqa: BLE001
                logger.exception("Thread analyze job failed case=%s job=%s", case_id, job_id)

        threading.Thread(target=_runner, name=f"analyze-{job_id}", daemon=True).start()


class RqJobBackend:
    """Enqueue analyze work on Redis Queue. Requires redis + rq packages."""

    name = "rq"

    def __init__(self, redis_url: str, queue_name: str = "vetmind") -> None:
        try:
            from redis import Redis
            from rq import Queue
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "RQ backend requires: pip install redis rq. "
                "Or set VETMIND_JOB_BACKEND=thread."
            ) from exc
        self._queue = Queue(queue_name, connection=Redis.from_url(redis_url))

    def enqueue_analyze(self, case_id: str, job_id: str, work: Callable[[], None]) -> None:
        # RQ needs importable callables — wrap via module function with ids.
        from app.workers.rq_tasks import run_analyze_job

        self._queue.enqueue(run_analyze_job, case_id, job_id, job_timeout=300)


def build_job_backend(*, backend: str, delay_ms: int, redis_url: str | None) -> JobBackend:
    if backend == "rq":
        if not redis_url:
            raise RuntimeError("VETMIND_JOB_BACKEND=rq requires VETMIND_REDIS_URL.")
        return RqJobBackend(redis_url)
    return ThreadJobBackend(delay_ms=delay_ms)
