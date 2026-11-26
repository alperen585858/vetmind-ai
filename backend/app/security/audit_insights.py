"""Suspicious-event rules and summary numbers for the admin audit screen (issue #106).

Pure functions over audit event dicts (newest or oldest first, either works) so they are
easy to test. Rules only *flag*; nothing here locks or changes an account.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any, Iterable

FAILED_LOGIN_THRESHOLD = 5
FAILED_LOGIN_WINDOW = timedelta(minutes=15)
TOP_TYPES = 8


def _ts(event: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(str(event.get("timestamp")))


def _is_failed_login(e: dict[str, Any]) -> bool:
    return e.get("event_type") == "auth.login" and e.get("outcome") == "denied"


def _is_refresh_reuse(e: dict[str, Any]) -> bool:
    return e.get("event_type") == "auth.refresh" and e.get("outcome") == "denied" and e.get("detail") == "reused"


def find_suspicious(
    events: Iterable[dict[str, Any]],
    *,
    threshold: int = FAILED_LOGIN_THRESHOLD,
    window: timedelta = FAILED_LOGIN_WINDOW,
) -> list[dict[str, Any]]:
    """Groups worth a look, most recent first.

    - ``failed_logins``: at least ``threshold`` wrong passwords for one account within ``window``
    - ``rate_limited``: the attempt limiter blocked this account / IP key
    - ``refresh_reuse``: an already-rotated refresh token came back (possible token theft)
    """
    failed: dict[str, list[datetime]] = defaultdict(list)
    limited: dict[str, list[datetime]] = defaultdict(list)
    reuse: list[datetime] = []
    for e in events:
        if _is_failed_login(e):
            failed[e.get("actor") or "?"].append(_ts(e))
        elif e.get("event_type") == "auth.rate_limited":
            limited[e.get("actor") or "?"].append(_ts(e))
        elif _is_refresh_reuse(e):
            reuse.append(_ts(e))

    items: list[dict[str, Any]] = []
    for actor, times in failed.items():
        times.sort()
        best, start = 0, 0
        for end in range(len(times)):
            while times[end] - times[start] > window:
                start += 1
            best = max(best, end - start + 1)
        if best >= threshold:
            items.append(_item("failed_logins", actor, times, best))
    for actor, times in limited.items():
        items.append(_item("rate_limited", actor, sorted(times), len(times)))
    if reuse:
        items.append(_item("refresh_reuse", None, sorted(reuse), len(reuse)))
    items.sort(key=lambda i: i["last_at"], reverse=True)
    return items


def _item(kind: str, actor: str | None, times: list[datetime], count: int) -> dict[str, Any]:
    return {
        "kind": kind,
        "actor": actor,
        "count": count,
        "first_at": times[0].isoformat(),
        "last_at": times[-1].isoformat(),
    }


def flagged_actors(suspicious: list[dict[str, Any]]) -> set[str]:
    return {i["actor"] for i in suspicious if i["kind"] == "failed_logins" and i["actor"]}


def is_flagged(event: dict[str, Any], brute_force_actors: set[str]) -> bool:
    """Whether a list row should carry the "suspicious" badge."""
    if event.get("event_type") == "auth.rate_limited" or _is_refresh_reuse(event):
        return True
    return _is_failed_login(event) and (event.get("actor") or "") in brute_force_actors


def summarize(events: Iterable[dict[str, Any]], *, now: datetime) -> dict[str, Any]:
    """Counts for the summary cards: last 24 hours and last 7 days."""
    day_ago, week_ago = now - timedelta(days=1), now - timedelta(days=7)
    events = list(events)
    last_day = [e for e in events if _ts(e) >= day_ago]
    last_week = [e for e in events if _ts(e) >= week_ago]
    by_type = Counter(e.get("event_type") or "?" for e in last_week)
    return {
        "events_24h": len(last_day),
        "events_7d": len(last_week),
        "logins_24h": sum(1 for e in last_day if e.get("event_type") == "auth.login" and e.get("outcome") == "success"),
        "failed_logins_24h": sum(1 for e in last_day if _is_failed_login(e)),
        "rate_limited_24h": sum(1 for e in last_day if e.get("event_type") == "auth.rate_limited"),
        "by_type_7d": [{"event_type": t, "count": n} for t, n in by_type.most_common(TOP_TYPES)],
    }


# --- CSV ------------------------------------------------------------------------------

CSV_COLUMNS = ("timestamp", "event_type", "actor", "outcome", "clinic_id", "resource", "detail")
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def csv_cell(value: Any) -> str:
    """Spreadsheet-safe cell: text starting like a formula gets a leading apostrophe."""
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_START) else text
