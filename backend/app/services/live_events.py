"""Live updates over Server-Sent Events (SSE).

- ``LiveEventBroker`` fans events out to the connected browsers of given subjects.
  Publishers are plain sync service methods (FastAPI runs them in a threadpool), so
  ``publish`` is thread-safe and hands events to each subscriber's asyncio loop.
- ``StreamTicketService`` issues short-lived, single-use tickets. ``EventSource`` cannot
  send an ``Authorization`` header, so the browser first asks for a ticket with its JWT
  and then opens ``/api/v1/live/stream?ticket=…``. The JWT never appears in a URL.

Events carry ids and display data only — message bodies go to participants, nothing is
logged. This is a single-process broker; running several API workers would need a shared
bus (e.g. Redis pub/sub) behind the same interface.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable

HEARTBEAT_S = 15.0
QUEUE_MAX = 200


@dataclass
class _Subscriber:
    subject: str
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue
    dropped: bool = False


class LiveEventBroker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subs: dict[str, list[_Subscriber]] = {}

    def subscribe(self, subject: str) -> _Subscriber:
        sub = _Subscriber(subject=subject, loop=asyncio.get_running_loop(), queue=asyncio.Queue(QUEUE_MAX))
        with self._lock:
            self._subs.setdefault(subject, []).append(sub)
        return sub

    def unsubscribe(self, sub: _Subscriber) -> None:
        with self._lock:
            subs = self._subs.get(sub.subject, [])
            if sub in subs:
                subs.remove(sub)
            if not subs:
                self._subs.pop(sub.subject, None)

    def is_online(self, subject: str) -> bool:
        with self._lock:
            return bool(self._subs.get(subject))

    def publish(self, subjects: set[str] | list[str], event: dict[str, Any]) -> int:
        """Send ``event`` to every open stream of ``subjects``. Returns streams reached."""
        with self._lock:
            targets = [s for subj in set(subjects) if subj for s in self._subs.get(subj, [])]
        for sub in targets:
            try:
                sub.loop.call_soon_threadsafe(self._offer, sub, event)
            except RuntimeError:  # loop closed — the stream is going away
                continue
        return len(targets)

    @staticmethod
    def _offer(sub: _Subscriber, event: dict[str, Any]) -> None:
        try:
            sub.queue.put_nowait(event)
        except asyncio.QueueFull:
            # Slow client: tell it to resync instead of growing memory.
            sub.dropped = True


@dataclass(frozen=True)
class StreamIdentity:
    subject: str
    role: str
    clinic_id: str | None


@dataclass
class StreamTicketService:
    ttl_seconds: int = 60
    clock: Callable[[], float] = time.monotonic
    _tickets: dict[str, tuple[StreamIdentity, float]] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def issue(self, identity: StreamIdentity) -> str:
        raw = secrets.token_urlsafe(24)
        now = self.clock()
        with self._lock:
            # Drop expired tickets while we are here.
            for key in [k for k, (_, exp) in self._tickets.items() if exp <= now]:
                del self._tickets[key]
            self._tickets[raw] = (identity, now + self.ttl_seconds)
        return raw

    def consume(self, raw: str) -> StreamIdentity | None:
        with self._lock:
            entry = self._tickets.pop(raw, None)
        if entry is None:
            return None
        identity, expires = entry
        return identity if expires > self.clock() else None


def format_sse(event: dict[str, Any]) -> str:
    name = str(event.get("type", "message"))
    data = json.dumps(event, ensure_ascii=False, default=str)
    return f"event: {name}\ndata: {data}\n\n"


async def event_stream(
    broker: LiveEventBroker,
    subject: str,
    *,
    is_disconnected: Callable[[], Awaitable[bool]],
    heartbeat_s: float = HEARTBEAT_S,
) -> AsyncIterator[str]:
    """Yield SSE frames for ``subject`` until the client goes away."""
    sub = broker.subscribe(subject)
    try:
        yield "retry: 3000\n\n"
        yield format_sse({"type": "ready"})
        while True:
            if await is_disconnected():
                break
            if sub.dropped:
                sub.dropped = False
                yield format_sse({"type": "resync"})
            try:
                event = await asyncio.wait_for(sub.queue.get(), timeout=heartbeat_s)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            yield format_sse(event)
    finally:
        broker.unsubscribe(sub)
