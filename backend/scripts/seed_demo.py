#!/usr/bin/env python3
"""Load, reset or remove the scripted demo cases (synthetic DICOM fixtures only).

Run (from backend/, with the same VETMIND_* env as the server):
  python scripts/seed_demo.py           # add demo cases (refuses if they already exist)
  python scripts/seed_demo.py --reset   # remove demo cases, then add them again
  python scripts/seed_demo.py --remove  # remove demo cases only; real cases are untouched

Only cases flagged ``demo_seed`` are ever removed. Restart the backend afterwards when
it runs with in-memory storage; SQLite/PostgreSQL changes are visible immediately.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.container import AppContainer  # noqa: E402
from app.demo_seed import demo_case_ids, remove_demo_cases, seed_demo_cases  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--reset", action="store_true", help="remove demo cases, then seed again")
    mode.add_argument("--remove", action="store_true", help="remove demo cases only")
    args = parser.parse_args()

    container = AppContainer()
    if container.storage_backend == "memory":
        print("VETMIND_STORAGE=memory: nothing persists outside the server process.", file=sys.stderr)
        return 1

    if args.remove or args.reset:
        print(f"Removed {remove_demo_cases(container)} demo case(s).")
        if args.remove:
            return 0
    elif demo_case_ids(container):
        print("Demo cases already exist. Use --reset to recreate them.", file=sys.stderr)
        return 1

    ids = seed_demo_cases(container)
    print(f"Created {len(ids)} demo case(s): {', '.join(ids)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
