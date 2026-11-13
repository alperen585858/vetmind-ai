"""Sliding-window attempt limiter for the auth endpoints (issue #31 step 5).

In-process memory: limits apply per backend process. That matches the default single
uvicorn worker; several workers each keep their own counters (a shared store such as
Redis would be needed to make the limit global).
"""

from __future__ import annotations

import math
import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from typing import Callable


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


class RateLimiter:
    def __init__(
        self,
        *,
        enabled: bool = True,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = 20_000,
    ) -> None:
        self.enabled = enabled
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
