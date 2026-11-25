#!/usr/bin/env python3
"""Experiment (#101, optional item): does LLM reranking improve bge-m3 retrieval?

bge-m3 + region/species filter returns up to N candidates (no score floor). A local LLM
(Ollama, default qwen2.5:7b) sees only those candidates and returns the numbers of the ones
that fit the case, best first (at most 4, may be none). It cannot add sources. The result is
compared with the production setting (bge-m3 + floors) on eval/rag_relevance_set.json, with
the added time per case.

Run (from backend/, needs `ollama pull bge-m3` and the chat model):
  python scripts/rag_rerank_experiment.py --candidates 12 --model qwen2.5:7b

Writes eval/results/rerank-<timestamp>.md. Not part of the app: reranking is only added if
it clearly helps.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.evaluation.rag_eval import (  # noqa: E402
    CaseOutcome,
    ConfigResult,
    RetrievalConfig,
    build_retriever,
    case_query,
    gold_matches,
    load_rag_eval_set,
)
from app.rag.relevance import RagFilter  # noqa: E402

SPECIES_TR = {"canine": "köpek", "feline": "kedi"}

PROMPT = """Bir veteriner radyoloji raporu yazılacak. Aşağıdaki vaka için aday kaynak pasajlardan
hangileri bu vakanın raporunda kanıt olarak gerçekten işe yarar?

Vaka: {species}, {modality}, bölge {region}.
{history}
Bulgular: {findings}

Adaylar:
{candidates}

Kurallar: Yalnızca listedeki numaraları kullan. Vakayla doğrudan ilgili olanları en ilgiliden
başlayarak sırala, en fazla 4 tane. Hiçbiri ilgili değilse boş liste ver.
Yalnızca JSON döndür: {{"ilgili": [numaralar]}}"""


def _candidates_text(hits) -> str:  # noqa: ANN001
    lines = []
    for i, h in enumerate(hits, 1):
        passage = re.sub(r"\s+", " ", h.passage)[:400]
        lines.append(f"[{i}] {h.title} — {h.section}: {passage}")
    return "\n".join(lines)


def _rerank(client: httpx.Client, url: str, model: str, case, hits) -> list[int]:  # noqa: ANN001
    prompt = PROMPT.format(
        species=SPECIES_TR.get(case.species, case.species),
        modality=case.modality,
        region=case.region,
        history=case.history_text,
        findings="; ".join(f"{f.description} ({f.location})" for f in case.findings) or "—",
        candidates=_candidates_text(hits),
    )
    r = client.post(
        f"{url}/api/chat",
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "format": "json",
            "stream": False,
            "options": {"temperature": 0},
        },
    )
    r.raise_for_status()
    try:
        picked = json.loads(r.json()["message"]["content"]).get("ilgili", [])
    except (ValueError, AttributeError):
        return []
    out: list[int] = []
    for n in picked if isinstance(picked, list) else []:
        if isinstance(n, int) and 1 <= n <= len(hits) and n - 1 not in out:
            out.append(n - 1)  # only numbers from the list: no invented sources
    return out[:4]


def _outcome(case, ids: list[tuple[str, float]]) -> CaseOutcome:  # noqa: ANN001
    return CaseOutcome(
        case_id=case.id,
        retrieved=ids,
        relevant_hits=sum(1 for sid, _ in ids if any(gold_matches(g, sid) for g in case.relevant)),
        gold_matched=sum(1 for g in case.relevant if any(gold_matches(g, sid) for sid, _ in ids)),
        gold_total=len(case.relevant),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--set", type=Path, default=ROOT / "eval" / "rag_relevance_set.json")
    parser.add_argument("--out", type=Path, default=ROOT / "eval" / "results")
    parser.add_argument("--model", default="qwen2.5:7b")
    parser.add_argument("--url", default="http://localhost:11434")
    parser.add_argument("--candidates", type=int, default=12)
    args = parser.parse_args()

    cases = load_rag_eval_set(args.set)
    prod_cfg = RetrievalConfig("bge-m3 + floors (production)", embedding="ollama:bge-m3", case_filter=True,
                               clean_query=True, min_cosine=0.50, relative_floor=0.90, broad_min_cosine=0.60)
    cand_cfg = RetrievalConfig(f"bge-m3 top-{args.candidates} → {args.model} rerank", embedding="ollama:bge-m3",
                               case_filter=True, clean_query=True, min_cosine=0.0, relative_floor=0.0,
                               broad_min_cosine=0.0, top_k=args.candidates)
    prod, cand = build_retriever(prod_cfg), build_retriever(cand_cfg)
    prod_res, rerank_res = ConfigResult(prod_cfg), ConfigResult(cand_cfg)
    prod_ms, rerank_ms = [], []

    with httpx.Client(timeout=300) as client:
        # Warm the chat model so load time is not charged to the first case.
        client.post(f"{args.url}/api/chat", json={"model": args.model, "messages": [{"role": "user", "content": "ok"}],
                                                  "stream": False})
        for case in cases:
            f = RagFilter(region=case.region, species=case.species, modality=case.modality)
            q = case_query(case, clean=True)
            t0 = time.perf_counter()
            hits = prod.retrieve(q, top_k=4, filters=f)
            prod_ms.append((time.perf_counter() - t0) * 1000)
            prod_res.outcomes.append(_outcome(case, [(h.source_id, h.score) for h in hits]))

            t0 = time.perf_counter()
            pool = cand.retrieve(q, top_k=args.candidates, filters=f)
            order = _rerank(client, args.url, args.model, case, pool) if pool else []
            rerank_ms.append((time.perf_counter() - t0) * 1000)
            rerank_res.outcomes.append(_outcome(case, [(pool[i].source_id, pool[i].score) for i in order]))
            print(f"{case.id}: prod={[h.source_id for h in hits]} rerank={[pool[i].source_id for i in order]}")

    rows = [(prod_res, prod_ms), (rerank_res, rerank_ms)]
    lines = [
        "# LLM reranking experiment (#101)",
        "",
        f"Cases: {len(cases)}. Candidates: bge-m3 + region/species filter, top {args.candidates}, no floor. "
        f"Reranker: `{args.model}` (Ollama, temperature 0), may only pick from the list. Synthetic set.",
        "",
        "| config | precision | hit rate | gold recall | abstain (empty cases) | irrelevant / case | docs / case "
        "| median ms / case |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for r, ms in rows:
        lines.append(
            f"| {r.config.name} | {r.precision:.2f} | {r.hit_rate:.2f} | {r.gold_recall:.2f} | {r.abstain_rate:.2f} | "
            f"{r.irrelevant_per_case:.2f} | {r.retrieved_per_case:.2f} | {statistics.median(ms):.0f} |"
        )
    lines += ["", "| case | gold | production | rerank |", "|---|---|---|---|"]
    for case, a, b in zip(cases, prod_res.outcomes, rerank_res.outcomes):
        lines.append(f"| {case.id} | {', '.join(case.relevant) or '—'} | "
                     f"{', '.join(s for s, _ in a.retrieved) or '—'} | {', '.join(s for s, _ in b.retrieved) or '—'} |")
    md = "\n".join(lines) + "\n"
    print("\n".join(lines[:9]))
    args.out.mkdir(parents=True, exist_ok=True)
    out = args.out / f"rerank-{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
    out.write_text(md, encoding="utf-8")
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
