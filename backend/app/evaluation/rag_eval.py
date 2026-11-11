"""RAG relevance eval: does retrieval return the knowledge-base docs a case needs?

Gold labels live in ``eval/rag_relevance_set.json`` (synthetic cases, team-labelled).
A gold entry is a source_id or a prefix pattern ending in ``*`` (``suture-*``).
Cases with an empty gold list should retrieve nothing (abstain).

Metrics (micro-averaged over cases):
- precision: retrieved docs that match some gold entry / all retrieved docs
- hit rate: non-empty cases with at least one relevant doc retrieved
- gold recall: gold entries matched at least once / all gold entries
- abstain rate: empty-gold cases that retrieved nothing
- irrelevant per case: mean number of non-gold docs shown to the LLM

Synthetic set, not clinical validation.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from app.rag.embedding_retriever import EmbeddingRagRetriever
from app.rag.embeddings import HashEmbeddingBackend
from app.rag.relevance import RagFilter, build_retrieval_query
from app.rag.vector_store import JsonVectorStore


@dataclass(frozen=True)
class RagEvalFinding:
    code: str
    description: str
    location: str


@dataclass(frozen=True)
class RagEvalCase:
    id: str
    title: str
    species: str
    modality: str
    region: str
    complaint: str
    history: str
    findings: tuple[RagEvalFinding, ...]
    relevant: tuple[str, ...]

    @property
    def history_text(self) -> str:
        # Same shape as demo_seed's clinical_history ("Şikâyet: ... . <öykü>").
        return f"Şikâyet: {self.complaint}. {self.history}".strip()


@dataclass(frozen=True)
class RetrievalConfig:
    name: str
    dim: int = 64
    stem_prefix: int = 0
    stopwords: bool = False
    clean_query: bool = False
    case_filter: bool = False
    min_cosine: float = EmbeddingRagRetriever.LEGACY_MIN_COSINE
    relative_floor: float = 0.0
    broad_min_cosine: float | None = None
    # "hash" or "ollama:<model>" (e.g. "ollama:bge-m3").
    embedding: str = "hash"
    top_k: int = 4


@dataclass
class CaseOutcome:
    case_id: str
    retrieved: list[tuple[str, float]]
    relevant_hits: int
    gold_matched: int
    gold_total: int

    @property
    def irrelevant(self) -> int:
        return len(self.retrieved) - self.relevant_hits


@dataclass
class ConfigResult:
    config: RetrievalConfig
    outcomes: list[CaseOutcome] = field(default_factory=list)

    def _non_empty(self) -> list[CaseOutcome]:
        return [o for o in self.outcomes if o.gold_total > 0]

    def _empty(self) -> list[CaseOutcome]:
        return [o for o in self.outcomes if o.gold_total == 0]

    @property
    def precision(self) -> float:
        retrieved = sum(len(o.retrieved) for o in self.outcomes)
        return sum(o.relevant_hits for o in self.outcomes) / retrieved if retrieved else 0.0

    @property
    def hit_rate(self) -> float:
        cases = self._non_empty()
        return sum(1 for o in cases if o.relevant_hits > 0) / len(cases) if cases else 0.0

    @property
    def gold_recall(self) -> float:
        total = sum(o.gold_total for o in self.outcomes)
        return sum(o.gold_matched for o in self.outcomes) / total if total else 0.0

    @property
    def abstain_rate(self) -> float:
        cases = self._empty()
        return sum(1 for o in cases if not o.retrieved) / len(cases) if cases else 1.0

    @property
    def irrelevant_per_case(self) -> float:
        return sum(o.irrelevant for o in self.outcomes) / len(self.outcomes) if self.outcomes else 0.0

    @property
    def retrieved_per_case(self) -> float:
        return sum(len(o.retrieved) for o in self.outcomes) / len(self.outcomes) if self.outcomes else 0.0


def load_rag_eval_set(path: Path) -> list[RagEvalCase]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    cases = []
    for c in raw["cases"]:
        cases.append(
            RagEvalCase(
                id=c["id"],
                title=c.get("title", c["id"]),
                species=c["species"],
                modality=c["modality"],
                region=c["region"],
                complaint=c.get("complaint", ""),
                history=c.get("history", ""),
                findings=tuple(
                    RagEvalFinding(f.get("code", ""), f.get("description", ""), f.get("location", ""))
                    for f in c.get("findings", [])
                ),
                relevant=tuple(c.get("relevant", [])),
            )
        )
    return cases


def gold_matches(gold: str, source_id: str) -> bool:
    if gold.endswith("*"):
        return source_id.startswith(gold[:-1])
    return source_id == gold


def legacy_query(case: RagEvalCase) -> str:
    """Mirror of the pre-filter gateway query (enum codes + finding codes included)."""
    parts = [case.species, case.modality, case.region, case.history_text]
    for f in case.findings:
        parts.extend([f.code, f.description, f.location])
    return " ".join(p for p in parts if p)


def case_query(case: RagEvalCase, *, clean: bool) -> str:
    if not clean:
        return legacy_query(case)
    return build_retrieval_query(
        species=case.species,
        modality=case.modality,
        region=case.region,
        history=case.history_text,
        findings=[(f.description, f.location) for f in case.findings],
    )


_OLLAMA_BACKENDS: dict[str, object] = {}


def _backend_for(config: RetrievalConfig):  # noqa: ANN202
    if config.embedding.startswith("ollama:"):
        from app.rag.ollama_embeddings import OllamaEmbeddingBackend

        model = config.embedding.split(":", 1)[1]
        # One instance per model so its cache is shared across configs.
        return _OLLAMA_BACKENDS.setdefault(model, OllamaEmbeddingBackend(model))
    return HashEmbeddingBackend(dim=config.dim, stem_prefix=config.stem_prefix, stopwords=config.stopwords)


def build_retriever(config: RetrievalConfig) -> EmbeddingRagRetriever:
    store = JsonVectorStore(path=None, backend=_backend_for(config))
    store.reindex_seed(persist=False)
    return EmbeddingRagRetriever(
        store=store,
        min_cosine=config.min_cosine,
        relative_floor=config.relative_floor,
        broad_min_cosine=config.broad_min_cosine,
    )


def run_config(cases: list[RagEvalCase], config: RetrievalConfig) -> ConfigResult:
    retriever = build_retriever(config)
    result = ConfigResult(config=config)
    for case in cases:
        filters = (
            RagFilter(region=case.region, species=case.species, modality=case.modality)
            if config.case_filter
            else None
        )
        # The score floor only applies on filtered calls; a no-region RagFilter()
        # gives "threshold without region filter" (still drops META docs).
        if filters is None and (
            config.min_cosine != EmbeddingRagRetriever.LEGACY_MIN_COSINE or config.relative_floor > 0
        ):
            filters = RagFilter()
        hits = retriever.retrieve(case_query(case, clean=config.clean_query), top_k=config.top_k, filters=filters)
        ids = [(h.source_id, h.score) for h in hits]
        relevant_hits = sum(1 for sid, _ in ids if any(gold_matches(g, sid) for g in case.relevant))
        gold_matched = sum(1 for g in case.relevant if any(gold_matches(g, sid) for sid, _ in ids))
        result.outcomes.append(
            CaseOutcome(
                case_id=case.id,
                retrieved=ids,
                relevant_hits=relevant_hits,
                gold_matched=gold_matched,
                gold_total=len(case.relevant),
            )
        )
    return result


def render_markdown(results: list[ConfigResult], cases: list[RagEvalCase]) -> str:
    lines = [
        "# RAG relevance eval",
        "",
        f"Cases: {len(cases)} ({sum(1 for c in cases if not c.relevant)} expect no docs). "
        "Synthetic set — not clinical validation.",
        "",
        "| config | precision | hit rate | gold recall | abstain (empty cases) | irrelevant / case | docs / case |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for r in results:
        lines.append(
            f"| {r.config.name} | {r.precision:.2f} | {r.hit_rate:.2f} | {r.gold_recall:.2f} | "
            f"{r.abstain_rate:.2f} | {r.irrelevant_per_case:.2f} | {r.retrieved_per_case:.2f} |"
        )
    lines.append("")
    by_id = {c.id: c for c in cases}
    for r in results:
        lines += [f"## {r.config.name}", "", "| case | gold | retrieved (✓ = relevant) |", "|---|---|---|"]
        for o in r.outcomes:
            case = by_id[o.case_id]
            shown = ", ".join(
                f"{'✓' if any(gold_matches(g, sid) for g in case.relevant) else '✗'} {sid} ({score:.2f})"
                for sid, score in o.retrieved
            ) or "— (none)"
            lines.append(f"| {o.case_id} | {', '.join(case.relevant) or '— (none)'} | {shown} |")
        lines.append("")
    return "\n".join(lines)
