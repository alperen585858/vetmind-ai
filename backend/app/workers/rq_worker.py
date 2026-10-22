"""Run: python -m app.workers.rq_worker

Requires Redis + ``pip install redis rq`` and VETMIND_REDIS_URL.
"""

from __future__ import annotations

import os
import sys


def main() -> int:
    try:
        from redis import Redis
        from rq import Connection, Worker
    except ImportError:
        print("Install optional deps: pip install redis rq", file=sys.stderr)
        return 1
    redis_url = os.getenv("VETMIND_REDIS_URL", "redis://127.0.0.1:6379/0")
    queue = os.getenv("VETMIND_RQ_QUEUE", "vetmind")
    conn = Redis.from_url(redis_url)
    with Connection(conn):
        Worker([queue]).work(with_scheduler=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
