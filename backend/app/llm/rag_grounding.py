"""Filter RAG passages to those the draft actually used (ISS-RAG-04)."""

from __future__ import annotations

from app.schemas.rag import RagPassage
from app.schemas.report import DraftReport

LEGACY_UNUSED_NOTE = (
    "LLM did not return used_passage_ids; showing all retrieved passages "
    "(legacy). These are retrieval hits, not proven citations."
)


def select_used_passages(
    retrieved: list[RagPassage],
    used_passage_ids: list[str] | None,
) -> tuple[list[RagPassage], list[str], bool]:
    """Return (citations_for_report, used_ids, is_legacy).

    - If ``used_passage_ids`` is non-empty: only those passages (order preserved).
    - If empty/None: legacy — keep all retrieved, used_ids stays empty, is_legacy=True.
    """
    if not used_passage_ids:
        return list(retrieved), [], True
    wanted = {uid for uid in used_passage_ids if uid}
    by_id = {p.source_id: p for p in retrieved}
    cited: list[RagPassage] = []
    ordered_ids: list[str] = []
    for uid in used_passage_ids:
        if uid in wanted and uid in by_id and uid not in ordered_ids:
            cited.append(by_id[uid])
            ordered_ids.append(uid)
    return cited, ordered_ids, False


def apply_used_passages_to_report(
    report: DraftReport,
    retrieved: list[RagPassage],
    used_passage_ids: list[str] | None,
    *,
    related_finding_ids: list[str] | None = None,
) -> DraftReport:
    """Set rag_citations + used_passage_ids honestly on a draft report."""
    cited, used_ids, legacy = select_used_passages(retrieved, used_passage_ids)
    if related_finding_ids and cited:
        cited = [
            p.model_copy(
                update={
                    "related_finding_ids": list(p.related_finding_ids) or list(related_finding_ids)
                }
            )
            for p in cited
        ]
    note = report.rag_note
    if legacy and retrieved:
        note = (note + " " if note else "") + LEGACY_UNUSED_NOTE
    return report.model_copy(
        update={
            "rag_citations": cited if used_ids else list(retrieved),
            "used_passage_ids": used_ids,
            "rag_note": note,
        }
    )


def deterministic_used_subset(
    retrieved: list[RagPassage],
    *,
    max_n: int = 2,
    related_finding_ids: list[str] | None = None,
) -> tuple[list[RagPassage], list[str]]:
    """Demo/stub helper: cite at most max_n retrieved passages."""
    if not retrieved:
        return [], []
    take = max(1, min(max_n, len(retrieved)))
    used: list[RagPassage] = []
    ids: list[str] = []
    related = list(related_finding_ids or [])
    for idx, p in enumerate(retrieved[:take]):
        link = [related[idx % len(related)]] if related else list(p.related_finding_ids)
        used.append(p.model_copy(update={"related_finding_ids": link}) if link else p)
        ids.append(p.source_id)
    return used, ids
