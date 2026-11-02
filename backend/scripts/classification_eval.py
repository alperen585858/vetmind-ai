#!/usr/bin/env python3
"""Run the DICOM classification eval set and write confusion / P/R/F1 reports.

Run:
  cd backend && source .venv/bin/activate
  python scripts/classification_eval.py
  python scripts/classification_eval.py --cases brain-mri-canine,hybrid-disagreement

Writes eval/results/cls-<timestamp>.md and .json (prefix keeps LLM eval files separate).
Synthetic labels only — not clinical validation.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.evaluation.classification_eval import (  # noqa: E402
    load_eval_set,
    render_markdown,
    run_eval,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--set",
        type=Path,
        default=ROOT / "eval" / "classification_eval_set.json",
    )
    parser.add_argument(
        "--cases",
        default="",
        help="comma-separated case ids to run (default: all)",
    )
    parser.add_argument("--out", type=Path, default=ROOT / "eval" / "results")
    parser.add_argument(
        "--label",
        default="metadata_rules_v1",
        help="run label stored in the JSON summary",
    )
    args = parser.parse_args()

    eval_set = load_eval_set(args.set)
    if args.cases:
        wanted = {c.strip() for c in args.cases.split(",") if c.strip()}
        eval_set.cases = [c for c in eval_set.cases if c.id in wanted]
        if not eval_set.cases:
            print(f"No cases match --cases={args.cases}", file=sys.stderr)
            return 2

    print(f"▶ classify_study — {len(eval_set.cases)} case(s)")
    run = run_eval(eval_set, label=args.label)
    for c in run.cases:
        marks = []
        marks.append("M✓" if c.modality.correct else "M✗")
        marks.append("R✓" if c.region.correct else "R✗")
        if c.species is not None:
            marks.append("S✓" if c.species.correct else "S✗")
        print(f"  {' '.join(marks)}  {c.case_id:<28} {c.title}")

    args.out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    md_path = args.out / f"cls-{stamp}.md"
    json_path = args.out / f"cls-{stamp}.json"
    md = render_markdown(run, eval_set)
    md_path.write_text(md, encoding="utf-8")
    payload = {
        "set": eval_set.name,
        "set_version": eval_set.version,
        "set_note": eval_set.note,
        "synthetic": True,
        "clinical_validation": False,
        "runs": [run.to_json()],
    }
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    s = run.summary
    print(
        f"\nModality  accuracy={s.modality.accuracy:.3f}  macro-F1={s.modality.macro_f1:.3f}"
    )
    print(
        f"Region    accuracy={s.region.accuracy:.3f}  macro-F1={s.region.macro_f1:.3f}"
    )
    if s.species is not None:
        print(
            f"Species   accuracy={s.species.accuracy:.3f}  macro-F1={s.species.macro_f1:.3f}"
        )
    print(f"\nRapor: {md_path}\nHam veri: {json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
