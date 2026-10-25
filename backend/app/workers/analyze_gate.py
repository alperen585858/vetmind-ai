"""Cross-process analyze concurrency gate (thread + RQ workers on one host).

Process-local ``threading.Semaphore`` is insufficient when RQ spawns separate
processes. This gate uses an exclusive file lock + counter so sync and async
paths share one limit. Not a distributed cluster lock (no Redis required).
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path


@dataclass
class AnalyzeGate:
    """Try-acquire / release with no blocking wait (fail-fast like HTTP 429)."""

    max_concurrent: int
    path: Path
    _thread_lock: threading.Lock = threading.Lock()

    def __post_init__(self) -> None:
        self.max_concurrent = max(1, int(self.max_concurrent))
        self.path = Path(self.path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("0\n", encoding="utf-8")

    def try_acquire(self) -> bool:
        with self._thread_lock:
            return self._with_file_lock(self._try_inc)

    def release(self) -> None:
        with self._thread_lock:
            self._with_file_lock(self._dec)

    def _try_inc(self, f) -> bool:
        count = self._read_count(f)
        if count >= self.max_concurrent:
            return False
        self._write_count(f, count + 1)
        return True

    def _dec(self, f) -> None:
        count = self._read_count(f)
        self._write_count(f, max(0, count - 1))

    def _read_count(self, f) -> int:
        f.seek(0)
        raw = f.read().strip()
        if not raw:
            return 0
        try:
            return max(0, int(raw))
        except ValueError:
            return 0

    def _write_count(self, f, value: int) -> None:
        f.seek(0)
        f.truncate()
        f.write(f"{value}\n")
        f.flush()
        os.fsync(f.fileno())

    def _with_file_lock(self, fn):
        if os.name == "nt":
            return self._with_windows_lock(fn)
        import fcntl

        with open(self.path, "a+", encoding="utf-8") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                return fn(f)
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)

    def _with_windows_lock(self, fn):
        # fcntl is POSIX-only; msvcrt byte-range lock on byte 0 gives the same exclusion.
        import msvcrt

        with open(self.path, "a+", encoding="utf-8") as f:
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
            try:
                return fn(f)
            finally:
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)


def build_analyze_gate(*, max_concurrent: int, path: Path | None) -> AnalyzeGate:
    if path is None:
        import tempfile

        # Isolated default for unit tests / ephemeral processes (not shared cluster lock).
        root = Path(tempfile.mkdtemp(prefix="vetmind-analyze-gate-")) / "analyze_gate.count"
    else:
        root = path
    return AnalyzeGate(max_concurrent=max_concurrent, path=root)
