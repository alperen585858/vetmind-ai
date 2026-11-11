#!/usr/bin/env python3
"""Does a saved revision lesson change the next draft of a *similar* case?

Takes a lesson written on one case (--source) and drafts another case (--target)
N times without and N times with it, using the configured real LLM. Checks the
draft text / differentials for terms the lesson should push down (--avoid) and
up (--expect).

Run (from backend/, Ollama running):
  VETMIND_LLM_PROVIDER=ollama VETMIND_LLM_MODEL_ID=qwen2.5:7b python scripts/lesson_eval.py

Uses the cases in the local database (demo seed). Writes eval/results/lessons-<ts>.md.
A handful of runs on one case pair — a smoke check, not a statistical result.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("VETMIND_LLM_PROVIDER", "ollama")
os.environ.setdefault("VETMIND_LLM_MODEL_ID", "qwen2.5:7b")
os.environ.setdefault("VETMIND_LLM_TIMEOUT_S", "300")

from app.container import AppContainer  # noqa: E402
from app.llm.gateway import LLMGateway, build_lesson_context  # noqa: E402
from app.llm.lessons import LessonStore  # noqa: E402

DEFAULT_LESSON = (
    "Ağrılı servikal vakalarda fibrokartilaginöz emboliyi (FKE) ayırıcı tanıda öne çıkarma; FKE tipik olarak "
    "ağrısızdır. Kondrodistrofik ırklarda ağrılı servikal basıda disk ekstrüzyonunu (IVDD, Hansen tip I) ilk sırada "
    "değerlendir."
)
SECTIONS = ("technique", "findings", "impression", "recommendations")


def _find_case(container: AppContainer, name: str):  # noqa: ANN202
    for case in container.repo.list_cases():
        if case.patient_name == name and case.structured_findings is not None:
            return case
    raise SystemExit(f"No analysed case named {name!r} in the local database (run scripts/seed_demo.py).")


def _draft_signals(report, avoid: re.Pattern, expect: re.Pattern) -> dict:  # noqa: ANN001
    text = "\n".join(getattr(report, k).text for k in SECTIONS)
    diffs = [(d.name, d.likelihood) for d in report.differentials]
    avoid_ranked = [f"{n} ({lk})" for n, lk in diffs if avoid.search(n) and lk in {"high", "moderate"}]
    return {
        "avoid_in_text": bool(avoid.search(text)),
        "avoid_ranked_high_or_moderate": avoid_ranked,
        "expect_anywhere": bool(expect.search(text) or any(expect.search(n) for n, _ in diffs)),
        "differentials": diffs,
        "impression": report.impression.text,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", default="Tarçın", help="case the lesson was written on")
    parser.add_argument("--target", default="Paşa", help="similar case drafted with / without the lesson")
    parser.add_argument("--lesson", default=DEFAULT_LESSON)
    parser.add_argument("--avoid", default=r"fibrokartilaj|fibrokartilag|\bFKE\b|emboli")
    parser.add_argument("--expect", default=r"disk|IVDD|Hansen|ekstrüzyon")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--out", type=Path, default=ROOT / "eval" / "results")
    args = parser.parse_args()

    container = AppContainer()
    source = _find_case(container, args.source)
    target = _find_case(container, args.target)
    avoid, expect = re.compile(args.avoid, re.I), re.compile(args.expect, re.I)

    lessons = LessonStore()  # in-memory: never touches the real lesson file
    lessons.add(
        instruction=args.lesson,
        context=build_lesson_context(source, source.structured_findings),
        created_by="lesson-eval",
        source_case_id=source.case_id,
    )
    plain = LLMGateway(container.llm_provider, rag=container.rag)
    taught = LLMGateway(container.llm_provider, rag=container.rag, lessons=lessons)

    rows: dict[str, list[dict]] = {"without lesson": [], "with lesson": []}
    for i in range(args.runs):
        for label, gateway in (("without lesson", plain), ("with lesson", taught)):
            report = gateway.generate_draft(target, target.structured_findings)
            signals = _draft_signals(report, avoid, expect)
            signals["applied_lessons"] = len(report.generation.applied_lesson_ids)
            rows[label].append(signals)
            print(f"[{i + 1}/{args.runs}] {label}: avoid-ranked={signals['avoid_ranked_high_or_moderate']} "
                  f"expect={signals['expect_anywhere']} diffs={signals['differentials']}")

    lines = [
        "# Revision lesson eval",
        "",
        f"Lesson written on **{args.source}**, applied to **{args.target}** "
        f"({target.anatomical_region.value}, {target.species.value}, {target.modality.value}). "
        f"Model: `{container.llm_provider.model_id}`. Runs per condition: {args.runs}. Smoke check, not statistics.",
        "",
        f"> {args.lesson}",
        "",
        "| condition | avoided term ranked high/moderate | avoided term anywhere | expected term present |",
        "|---|---:|---:|---:|",
    ]
    for label, runs in rows.items():
        n = len(runs)
        lines.append(
            f"| {label} | {sum(bool(r['avoid_ranked_high_or_moderate']) for r in runs)}/{n} | "
            f"{sum(r['avoid_in_text'] for r in runs)}/{n} | {sum(r['expect_anywhere'] for r in runs)}/{n} |"
        )
    for label, runs in rows.items():
        lines += ["", f"## {label}", ""]
        for i, r in enumerate(runs, 1):
            diffs = ", ".join(f"{n} ({lk})" for n, lk in r["differentials"]) or "—"
            lines.append(f"{i}. Ayırıcı tanılar: {diffs}  ")
            lines.append(f"   Yorum: {r['impression']}")
    md = "\n".join(lines) + "\n"
    print("\n" + md)
    args.out.mkdir(parents=True, exist_ok=True)
    out = args.out / f"lessons-{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
    out.write_text(md, encoding="utf-8")
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
