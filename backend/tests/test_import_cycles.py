"""Issue #48 — every app module must import on its own (no circular-import order dependence).

The app normally loads through ``app.main``, which hides cycles: the import order happens to
work. Scripts and tests that import a single module first (``import app.services.x``) broke.
"""

from __future__ import annotations

import subprocess
import sys
import textwrap
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

# Runs in a fresh interpreter so pytest's already-imported modules cannot mask a cycle.
# Before each module, every ``app`` module is dropped from sys.modules, so that module is
# the first app module loaded, exactly like ``python -c "import <module>"``.
_CHECK_ALL = textwrap.dedent(
    """
    import importlib, pkgutil, sys, traceback
    import app

    names = sorted(m.name for m in pkgutil.walk_packages(app.__path__, "app."))
    failures = []
    for name in names:
        for loaded in [m for m in sys.modules if m == "app" or m.startswith("app.")]:
            del sys.modules[loaded]
        try:
            importlib.import_module(name)
        except Exception as exc:  # report every broken module, not just the first
            failures.append(f"{name}: {type(exc).__name__}: {exc}")
    print(f"checked {len(names)}")
    if failures:
        print("\\n".join(failures))
        sys.exit(1)
    """
)


def _run(code: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=BACKEND,
        capture_output=True,
        text=True,
        timeout=300,
    )


def test_issue_48_command_works() -> None:
    res = _run("import app.services.sqlite_repository")
    assert res.returncode == 0, res.stderr


def test_every_app_module_imports_first() -> None:
    res = _run(_CHECK_ALL)
    assert res.returncode == 0, res.stdout + res.stderr
    checked = int(res.stdout.split("checked ")[1].split()[0])
    assert checked > 150  # sanity: the walk really found the package
