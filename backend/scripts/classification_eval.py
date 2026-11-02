#!/usr/bin/env python3
"""Run the DICOM classification eval set and write confusion / P/R/F1 reports.

Run:
  cd backend && source .venv/bin/activate
  python scripts/classification_eval.py
  python scripts/classification_eval.py --cases brain-mri-canine,hybrid-disagreement

  # Rules vs rules + LLM signal (one run per model), same gold set. Provider settings
  # come from VETMIND_LLM_* (e.g. VETMIND_LLM_PROVIDER=ollama).
  python scripts/classification_eval.py --set eval/classification_eval_set_tr.json \\
      --models qwen2.5:7b,qwen2.5:3b

Writes eval/results/cls-<timestamp>.md and .json (prefix keeps LLM eval files separate).
Synthetic labels only — not clinical validation.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.dicom.llm_classifier import build_metadata_classifier  # noqa: E402
from app.evaluation.classification_eval import (  # noqa: E402
    RunResult,
    load_eval_set,
    render_markdown,
    run_eval,
)
from app.llm.interfaces import LLMConfigError  # noqa: E402
from app.settings import load_settings  # noqa: E402


def _comparison_table(runs: list[RunResult]) -> str:
    def fmt(field) -> str:  # noqa: ANN001
        return f"{field.accuracy:.3f} / {field.macro_f1:.3f}" if field is not None else "—"

    lines = [
        "## Comparison",
        "",
        "| run | modality acc / F1 | region acc / F1 | species acc / F1 | LLM consulted | mean ms/case |",
        "|---|---|---|---|---:|---:|",
    ]
    for run in runs:
        s = run.summary
        lines.append(
            f"| {run.llm_model or 'rules only'} | {fmt(s.modality)} | {fmt(s.region)} | {fmt(s.species)} | "
            f"{run.llm_calls}/{s.n_cases} | {run.mean_ms} |"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    # Windows consoles default to a legacy code page that cannot print ▶ / ✓.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
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
    parser.add_argument(
        "--models",
        default="",
        help="comma-separated LLM model ids; adds one 'rules + LLM' run per model after the rules run",
    )
    args = parser.parse_args()

    eval_set = load_eval_set(args.set)
    if args.cases:
        wanted = {c.strip() for c in args.cases.split(",") if c.strip()}
        eval_set.cases = [c for c in eval_set.cases if c.id in wanted]
        if not eval_set.cases:
            print(f"No cases match --cases={args.cases}", file=sys.stderr)
            return 2

    settings = load_settings()
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    classifiers = [None]
    for model in models:
        try:
            clf = build_metadata_classifier(replace(settings, classifier_llm=True, classifier_llm_model_id=model))
        except LLMConfigError as exc:
            print(f"✗ {model}: {exc}", file=sys.stderr)
            return 2
        classifiers.append(clf)

    runs: list[RunResult] = []
    for clf in classifiers:
        name = clf.model_label if clf is not None else "rules only"
        print(f"▶ classify_study ({name}) — {len(eval_set.cases)} case(s)")
        label = args.label if clf is None else f"{args.label}+llm"
        run = run_eval(eval_set, label=label, llm=clf)
        runs.append(run)
        for c in run.cases:
            marks = ["M✓" if c.modality.correct else "M✗", "R✓" if c.region.correct else "R✗"]
            if c.species is not None:
                marks.append("S✓" if c.species.correct else "S✗")
            print(f"  {' '.join(marks)}  {c.case_id:<28} {c.title}")
        s = run.summary
        print(f"  Region  accuracy={s.region.accuracy:.3f}  macro-F1={s.region.macro_f1:.3f}")
        if s.species is not None:
            print(f"  Species accuracy={s.species.accuracy:.3f}  macro-F1={s.species.macro_f1:.3f}")
        print()

    args.out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    md_path = args.out / f"cls-{stamp}.md"
    json_path = args.out / f"cls-{stamp}.json"
    parts = [_comparison_table(runs)] if len(runs) > 1 else []
    parts += [render_markdown(run, eval_set) for run in runs]
    md_path.write_text("\n".join(parts), encoding="utf-8")
    payload = {
        "set": eval_set.name,
        "set_version": eval_set.version,
        "set_note": eval_set.note,
        "synthetic": True,
        "clinical_validation": False,
        "runs": [run.to_json() for run in runs],
    }
    json_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if len(runs) > 1:
        print(_comparison_table(runs))
    print(f"Rapor: {md_path}\nHam veri: {json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
