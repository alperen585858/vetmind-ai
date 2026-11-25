"""Sliding-window attempt limiter for the auth endpoints (issue #31 step 5).

Default: in-process memory (per uvicorn worker).
Optional: Redis when ``VETMIND_REDIS_URL`` is set and the ``redis`` package is installed
(see requirements-optional.txt) so multi-worker limits stay coherent.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from typing import Callable, Protocol

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Limit:
    attempts: int
    window_seconds: int


# Failed logins: per account and per client IP.
LOGIN_PER_EMAIL = Limit(5, 15 * 60)
LOGIN_PER_IP = Limit(20, 15 * 60)
# Wrong current password on /password/change, per signed-in user.
PASSWORD_CHANGE_PER_USER = Limit(5, 15 * 60)
# Every /password/forgot request (each may send an email).
FORGOT_PER_EMAIL = Limit(3, 15 * 60)
FORGOT_PER_IP = Limit(10, 15 * 60)
# Failed /password/reset attempts (bad or used token).
RESET_PER_IP = Limit(10, 15 * 60)
# Every /register request.
REGISTER_PER_IP = Limit(10, 60 * 60)
# Issue #41: every /verify-email/resend request (each may send an email) and failed
# /verify-email attempts (bad, used or expired link).
VERIFY_RESEND_PER_EMAIL = Limit(3, 15 * 60)
VERIFY_RESEND_PER_IP = Limit(10, 15 * 60)
VERIFY_PER_IP = Limit(10, 15 * 60)


class RateLimiterProtocol(Protocol):
    enabled: bool
    backend: str

    def retry_after(self, scope: str, key: str, limit: Limit) -> int | None: ...

    def hit(self, scope: str, key: str, limit: Limit) -> None: ...

    def reset(self, scope: str, key: str) -> None: ...


class RateLimiter:
    def __init__(
        self,
        *,
        enabled: bool = True,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = 20_000,
    ) -> None:
        self.enabled = enabled
        self.backend = "memory"
        self._clock = clock
        self._max_keys = max_keys
        self._hits: OrderedDict[tuple[str, str], deque[float]] = OrderedDict()
        self._lock = threading.Lock()

    def _bucket(self, scope: str, key: str, window: int, now: float) -> deque[float]:
        k = (scope, key)
        bucket = self._hits.get(k)
        if bucket is None:
            bucket = deque()
            self._hits[k] = bucket
            while len(self._hits) > self._max_keys:
                self._hits.popitem(last=False)  # forget the least recently touched key
        else:
            self._hits.move_to_end(k)
        while bucket and bucket[0] <= now - window:
            bucket.popleft()
        return bucket

    def retry_after(self, scope: str, key: str, limit: Limit) -> int | None:
        """Seconds to wait if ``key`` already used up ``limit`` in this scope, else None."""
        if not self.enabled or not key:
            return None
        now = self._clock()
        with self._lock:
            bucket = self._bucket(scope, key, limit.window_seconds, now)
            if len(bucket) < limit.attempts:
                return None
            return max(1, math.ceil(bucket[0] + limit.window_seconds - now))

    def hit(self, scope: str, key: str, limit: Limit) -> None:
        if not self.enabled or not key:
            return
        now = self._clock()
        with self._lock:
            self._bucket(scope, key, limit.window_seconds, now).append(now)

    def reset(self, scope: str, key: str) -> None:
        with self._lock:
            self._hits.pop((scope, key), None)


class RedisRateLimiter:
    """Shared sliding window via Redis sorted sets (optional dependency)."""

    def __init__(self, redis_url: str, *, enabled: bool = True) -> None:
        import redis  # type: ignore[import-untyped]

        self.enabled = enabled
        self.backend = "redis"
        self._r = redis.Redis.from_url(redis_url, decode_responses=True)
        self._prefix = "vetmind:rl:"

    def _key(self, scope: str, key: str) -> str:
        return f"{self._prefix}{scope}:{key}"

    def retry_after(self, scope: str, key: str, limit: Limit) -> int | None:
        if not self.enabled or not key:
            return None
        now = time.time()
        k = self._key(scope, key)
        pipe = self._r.pipeline()
        pipe.zremrangebyscore(k, 0, now - limit.window_seconds)
        pipe.zcard(k)
        pipe.zrange(k, 0, 0, withscores=True)
        _, count, oldest = pipe.execute()
        if int(count) < limit.attempts:
            return None
        if not oldest:
            return 1
        return max(1, math.ceil(oldest[0][1] + limit.window_seconds - now))

    def hit(self, scope: str, key: str, limit: Limit) -> None:
        if not self.enabled or not key:
            return
        now = time.time()
        k = self._key(scope, key)
        member = f"{now}:{threading.get_ident()}"
        pipe = self._r.pipeline()
        pipe.zadd(k, {member: now})
        pipe.zremrangebyscore(k, 0, now - limit.window_seconds)
        pipe.expire(k, limit.window_seconds + 5)
        pipe.execute()

    def reset(self, scope: str, key: str) -> None:
        self._r.delete(self._key(scope, key))


def build_rate_limiter(*, enabled: bool, redis_url: str | None) -> RateLimiterProtocol:
    if enabled and redis_url:
        try:
            limiter = RedisRateLimiter(redis_url, enabled=enabled)
            # Ping once so a bad URL falls back immediately.
            limiter._r.ping()  # noqa: SLF001 — startup probe
            log.info("Auth rate limiter using Redis at %s", redis_url.split("@")[-1])
            return limiter
        except Exception as exc:  # noqa: BLE001 — optional path must not block startup
            log.warning("Redis rate limiter unavailable (%s); using in-memory limiter.", exc)
    return RateLimiter(enabled=enabled)
