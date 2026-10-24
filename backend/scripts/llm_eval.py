#!/usr/bin/env python3
"""Run the LLM evaluation set against one or more models and write a comparison report.

Run:
  cd backend && source .venv/bin/activate

  # Free, local: compare two Ollama models
  python scripts/llm_eval.py --provider ollama --models llama3.2:3b,phi3:mini

  # Claude (key from env)
  VETMIND_LLM_API_KEY=sk-ant-... python scripts/llm_eval.py --provider anthropic

  # Only some cases
  python scripts/llm_eval.py --provider ollama --models llama3.2:3b --cases brain-mass-01,no-findings-01

Writes eval/results/<timestamp>.md (readable table) and .json (raw, per case).
Other settings (API key, endpoint, language, timeout) come from VETMIND_LLM_* env vars.
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

from app.evaluation.llm_eval import CaseResult, load_eval_set, render_markdown, run_eval  # noqa: E402
from app.llm.factory import build_llm_provider  # noqa: E402
from app.llm.interfaces import LLMConfigError  # noqa: E402
from app.rag.retriever import LexicalRagRetriever  # noqa: E402
from app.settings import load_settings  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--set", type=Path, default=ROOT / "eval" / "llm_eval_set.json")
    parser.add_argument("--provider", help="openai | ollama | anthropic … (default: VETMIND_LLM_PROVIDER)")
    parser.add_argument("--models", default="", help="comma-separated model ids (default: VETMIND_LLM_MODEL_ID)")
    parser.add_argument("--cases", default="", help="comma-separated case ids to run (default: all)")
    parser.add_argument("--rag", choices=["lexical", "none"], default="lexical")
    parser.add_argument("--out", type=Path, default=ROOT / "eval" / "results")
    args = parser.parse_args()

    eval_set = load_eval_set(args.set)
    if args.cases:
        wanted = {c.strip() for c in args.cases.split(",") if c.strip()}
        eval_set.cases = [c for c in eval_set.cases if c.id in wanted]
        if not eval_set.cases:
            print(f"No cases match --cases={args.cases}", file=sys.stderr)
            return 2

    base = load_settings()
    if args.provider:
        base = replace(base, llm_provider=args.provider)
    if base.llm_provider in {"mock", "stub", "http"}:
        print("Choose a real provider: --provider ollama|openai|anthropic", file=sys.stderr)
        return 2
    models = [m.strip() for m in args.models.split(",") if m.strip()] or [base.llm_model_id]
    rag = LexicalRagRetriever() if args.rag == "lexical" else None

    runs = []
    for model in models:
        try:
            provider = build_llm_provider(replace(base, llm_model_id=model))
        except LLMConfigError as exc:
            print(f"Config error for {model}: {exc}", file=sys.stderr)
            return 2
        print(f"\n▶ {provider.provider_id} / {provider.model_id} — {len(eval_set.cases)} case(s)")

        def progress(res: CaseResult) -> None:
            if res.ok:
                print(f"  ✓ {res.case_id:<22} score={res.score:5.1f}  {res.latency_s:5.1f}s")
            else:
                print(f"  ✗ {res.case_id:<22} {res.error}")

        runs.append(run_eval(eval_set, provider, rag=rag, label=provider.model_id, on_case=progress))

    args.out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    md_path = args.out / f"{stamp}.md"
    json_path = args.out / f"{stamp}.json"
    md = render_markdown(runs, eval_set)
    md_path.write_text(md, encoding="utf-8")
    json_path.write_text(
        json.dumps(
            {"set": eval_set.name, "set_version": eval_set.version, "runs": [r.to_json() for r in runs]},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("\n" + md.split("## Vaka bazında skor")[0].strip())
    print(f"\nRapor: {md_path}\nHam veri: {json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
