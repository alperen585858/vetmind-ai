#!/usr/bin/env python3
"""Measure RAG relevance on eval/rag_relevance_set.json, one change at a time.

Run (from backend/):
  python scripts/rag_eval.py            # ablation ladder: baseline -> production config
  python scripts/rag_eval.py --details  # also print per-case retrieved docs

Writes eval/results/rag-<timestamp>.md and .json. Synthetic set — not clinical validation.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.evaluation.rag_eval import (  # noqa: E402
    RetrievalConfig,
    load_rag_eval_set,
    render_markdown,
    run_config,
)
from app.rag.embedding_retriever import EmbeddingRagRetriever  # noqa: E402

PRODUCTION = dict(
    case_filter=True,
    dim=2048,
    stem_prefix=5,
    stopwords=True,
    clean_query=True,
    min_cosine=EmbeddingRagRetriever.CASE_MIN_COSINE,
    relative_floor=EmbeddingRagRetriever.CASE_RELATIVE_FLOOR,
)

CONFIGS = [
    RetrievalConfig("0 baseline (64-dim, raw query, no filter, top-4)"),
    # Each change alone vs baseline.
    RetrievalConfig("1a only region/species filter", case_filter=True),
    RetrievalConfig("1b only 2048-dim hash", dim=2048),
    RetrievalConfig("1c only cleaned query", clean_query=True),
    # Cumulative ladder.
    RetrievalConfig("2 filter + 2048-dim", case_filter=True, dim=2048),
    RetrievalConfig("3 + cleaned query", case_filter=True, dim=2048, clean_query=True),
    RetrievalConfig("4 + Turkish stem feature", case_filter=True, dim=2048, clean_query=True, stem_prefix=5),
    RetrievalConfig(
        "4b + stopwords", case_filter=True, dim=2048, clean_query=True, stem_prefix=5, stopwords=True
    ),
    RetrievalConfig("5 + score floor (production)", **PRODUCTION),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--set", type=Path, default=ROOT / "eval" / "rag_relevance_set.json")
    parser.add_argument("--out", type=Path, default=ROOT / "eval" / "results")
    parser.add_argument("--details", action="store_true", help="print per-case tables too")
    parser.add_argument("--no-write", action="store_true")
    args = parser.parse_args()

    cases = load_rag_eval_set(args.set)
    results = [run_config(cases, c) for c in CONFIGS]
    md = render_markdown(results, cases)
    print(md if args.details else md.split("\n## ")[0])

    if not args.no_write:
        args.out.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        (args.out / f"rag-{stamp}.md").write_text(md, encoding="utf-8")
        payload = [
            {
                "config": asdict(r.config),
                "precision": round(r.precision, 4),
                "hit_rate": round(r.hit_rate, 4),
                "gold_recall": round(r.gold_recall, 4),
                "abstain_rate": round(r.abstain_rate, 4),
                "irrelevant_per_case": round(r.irrelevant_per_case, 4),
                "cases": [asdict(o) for o in r.outcomes],
            }
            for r in results
        ]
        (args.out / f"rag-{stamp}.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nWrote {args.out / f'rag-{stamp}.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
