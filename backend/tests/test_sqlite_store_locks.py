"""Shared sqlite connections must be locked (follow-up to #36).

FastAPI runs sync endpoints in a threadpool. Every store keeps ONE sqlite connection
with ``check_same_thread=False``; unlocked parallel use raised
``sqlite3.InterfaceError`` and could read back None for existing rows.

1. A guard: every class in app/ that opens such a connection creates ``self._lock``
   (``_lock``, ``_db_lock``...) and only touches ``self._conn`` inside ``with self.<lock>:``
   (public methods; ``_private`` helpers run under their caller's lock).
2. Behaviour: hammer two stores from many threads (read-modify-write included).
"""

from __future__ import annotations

import ast
import re
import threading
from pathlib import Path

from app.schemas.radiologist_payout import RadiologistPayoutSettings
from app.schemas.user_settings import UserSettingsUpdate
from app.services.radiologist_payout_store import SqliteRadiologistPayoutStore
from app.services.user_settings_store import SqliteUserSettingsStore

APP = Path(__file__).resolve().parents[1] / "app"


def _unlocked_conn_uses(cls: ast.ClassDef) -> list[str]:
    """Methods (except __init__) that use self._conn outside a `with self.<...lock>:` block."""
    bad: list[str] = []

    def is_lock_with(node: ast.AST) -> bool:
        return isinstance(node, ast.With) and any(
            isinstance(item.context_expr, ast.Attribute)
            and item.context_expr.attr.endswith("lock")  # _lock, _db_lock, ...
            for item in node.items
        )

    def visit(node: ast.AST, locked: bool, method: str) -> None:
        if (
            isinstance(node, ast.Attribute)
            and node.attr == "_conn"
            and isinstance(node.value, ast.Name)
            and node.value.id == "self"
            and not locked
        ):
            bad.append(method)
            return
        for child in ast.iter_child_nodes(node):
            visit(child, locked or is_lock_with(node), method)

    for fn in cls.body:
        # Private helpers (``_save``) are called by public methods that already hold the lock.
        if isinstance(fn, ast.FunctionDef) and not fn.name.startswith("_"):
            visit(fn, False, fn.name)
    return sorted(set(bad))


def test_every_shared_sqlite_connection_is_locked() -> None:
    problems: dict[str, list[str]] = {}
    checked = 0
    for path in APP.rglob("*.py"):
        src = path.read_text(encoding="utf-8")
        if "check_same_thread=False" not in src:
            continue
        for node in ast.walk(ast.parse(src)):
            if not isinstance(node, ast.ClassDef):
                continue
            cls_src = ast.get_source_segment(src, node) or ""
            if "check_same_thread=False" not in cls_src or "self._conn" not in cls_src:
                continue
            checked += 1
            key = f"{path.relative_to(APP)}::{node.name}"
            if not re.search(r"self\._\w*lock\b", cls_src):
                problems[key] = ["<no self._lock>"]
            elif bad := _unlocked_conn_uses(node):
                problems[key] = bad
    assert checked >= 7, checked  # case repo + 6 stores (+ auth stores use their own pattern)
    assert problems == {}, problems


def _hammer(work, threads: int = 12) -> list[BaseException]:  # noqa: ANN001
    errors: list[BaseException] = []
    start = threading.Barrier(threads)

    def run(n: int) -> None:
        try:
            start.wait()
            for j in range(120):
                work(n, j)
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    ts = [threading.Thread(target=run, args=(n,)) for n in range(threads)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return errors


def test_user_settings_store_survives_parallel_read_modify_write(tmp_path: Path) -> None:
    store = SqliteUserSettingsStore(tmp_path / "settings.sqlite3")

    def work(n: int, j: int) -> None:
        subject = f"user{j % 4}@demo.local"
        if j % 3 == 0:
            store.update(subject, UserSettingsUpdate(display_name=f"U{n}-{j}"))
        assert store.get(subject).subject == subject

    assert _hammer(work) == []


def test_payout_settings_store_survives_parallel_use(tmp_path: Path) -> None:
    store = SqliteRadiologistPayoutStore(tmp_path / "payouts.sqlite3")

    def work(n: int, j: int) -> None:
        if j % 5 == 0:
            store.save_settings(RadiologistPayoutSettings(fee_per_case=10 + n))
        assert store.get_settings().fee_per_case >= 1
        store.list_payouts()

    assert _hammer(work) == []
