"""Check VetMind's Pydantic handoff contract shapes without clinical inputs.

Run from repo root:
  python benchmarks/check_contract_shapes.py
  python benchmarks/check_contract_shapes.py --output artifacts/schema_shapes.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
BACKEND = ROOT / "backend"
if BACKEND.is_dir() and str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from evaluation.adapters.shape_guard import check_pipeline_contract_shapes  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only VetMind schema type drift check")
    parser.add_argument("--output", type=Path, default=None, help="Optional JSON result path")
    args = parser.parse_args(argv)
    result = check_pipeline_contract_shapes()
    content = json.dumps(result.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n"
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        # No case identifiers, patient text or source values enter this report.
        args.output.write_text(content, encoding="utf-8")
        print(f"Schema check: {result.status} ({result.rules_checked} rules)")
    else:
        print(content, end="")
    return 0 if result.status == "compatible" else 2


if __name__ == "__main__":
    raise SystemExit(main())
