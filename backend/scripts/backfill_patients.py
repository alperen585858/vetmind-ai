#!/usr/bin/env python3
"""Create patient records for existing cases (issue #108).

Run (from backend/, with the same VETMIND_* env as the server):
  python scripts/backfill_patients.py --dry-run   # show what would happen
  python scripts/backfill_patients.py             # create patients and link cases

Groups that may be two different animals (same name and species, different breeds) are
listed and left unlinked; link those by hand from the case page.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.container import AppContainer  # noqa: E402
from app.patients_backfill import backfill_patients  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="report only, change nothing")
    args = parser.parse_args()

    container = AppContainer()
    if container.storage_backend == "memory":
        print("VETMIND_STORAGE=memory: nothing persists outside the server process.", file=sys.stderr)
        return 1
    report = backfill_patients(container.repo, container.patient_store, dry_run=args.dry_run)
    verb = "Would create" if args.dry_run else "Created"
    print(f"{verb} {report.created} patient(s) for {report.linked_cases} case(s).")
    for clinic, name, species, breeds in report.ambiguous:
        print(f"  left alone (maybe different animals): {clinic or '-'} / {name} / {species} / breeds: {', '.join(breeds)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
