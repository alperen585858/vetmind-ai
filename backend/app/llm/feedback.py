"""Expert feedback dataset: what the model wrote vs. what the radiologist signed off.

Built from ``DraftReport.ai_sections`` (frozen model text) and the reviewed report.
Uses: find which sections experts rewrite most, compare models/prompt versions on
real review outcomes, and export approved pairs for prompt work or fine-tuning.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from difflib import SequenceMatcher
from statistics import mean
from typing import Optional

from app.llm.gateway import build_generation_input
from app.llm.privacy import redact_personal_data
from app.llm.prompts import build_aliases, build_system_prompt, build_user_prompt
from app.schemas.case import CaseRecord
from app.schemas.enums import ExpertReviewStatus

SECTIONS = ("technique", "findings", "impression", "recommendations")


def similarity(a: str, b: str) -> float:
    """Word-level similarity 0..1 (1 = unchanged)."""
    if a.strip() == b.strip():
        return 1.0
    return round(SequenceMatcher(None, a.split(), b.split(), autojunk=False).ratio(), 3)


@dataclass
class SectionFeedback:
    section: str
    ai_text: str
    final_text: str
    similarity: float

    @property
    def edited(self) -> bool:
        return self.similarity < 1.0


@dataclass
class FeedbackRecord:
    case_id: str
    report_version: int
    decision: str
    reviewer: Optional[str]
    provider_id: str
    model_id: str
    prompt_version: Optional[str]
    species: str
    modality: str
    region: str
    reviewer_notes: Optional[str]
    grounding_warnings: int
    sections: list[SectionFeedback] = field(default_factory=list)

    @property
    def edited_sections(self) -> list[str]:
        return [s.section for s in self.sections if s.edited]

    @property
    def mean_similarity(self) -> float:
        return round(mean(s.similarity for s in self.sections), 3) if self.sections else 1.0

    def to_json(self) -> dict:
        data = asdict(self)
        data["edited_sections"] = self.edited_sections
        data["mean_similarity"] = self.mean_similarity
        return data


def _redact(text: str, case: CaseRecord) -> str:
    known = [(case.patient_name, "[HASTA]"), (case.referring_clinic, "[KLİNİK]")]
    return redact_personal_data(text, known=known).text


def feedback_record(case: CaseRecord) -> FeedbackRecord | None:
    """None unless the case has a model draft that an expert has acted on."""
    draft = case.draft_report
    # Seeded demo approvals are scripted, not real expert sign-off.
    if case.demo_seed or draft is None or not draft.ai_sections:
        return None
    if draft.expert_review_status == ExpertReviewStatus.PENDING:
        return None
    sections = []
    for key in SECTIONS:
        ai = _redact(draft.ai_sections.get(key, ""), case)
        final = _redact(getattr(draft, key).text, case)
        sections.append(SectionFeedback(key, ai, final, similarity(ai, final)))
    return FeedbackRecord(
        case_id=case.case_id,
        report_version=int(draft.version),
        decision=draft.expert_review_status.value,
        reviewer=draft.reviewed_by,
        provider_id=draft.generation.provider_id,
        model_id=draft.generation.model_id,
        prompt_version=draft.generation.prompt_version,
        species=case.species.value,
        modality=case.modality.value,
        region=case.anatomical_region.value,
        reviewer_notes=_redact(draft.revision_notes or "", case) or None,
        grounding_warnings=sum(w.startswith("Grounding:") for w in draft.validation_warnings),
        sections=sections,
    )


def collect_feedback(cases: list[CaseRecord]) -> list[FeedbackRecord]:
    return [r for r in (feedback_record(c) for c in cases) if r is not None]


def summarize(records: list[FeedbackRecord]) -> dict:
    by_decision: dict[str, int] = defaultdict(int)
    for r in records:
        by_decision[r.decision] += 1

    section_stats = {}
    for key in SECTIONS:
        sims = [s.similarity for r in records for s in r.sections if s.section == key]
        section_stats[key] = {
            "edited_rate": round(sum(x < 1.0 for x in sims) / len(sims), 3) if sims else None,
            "mean_similarity": round(mean(sims), 3) if sims else None,
        }

    by_model: dict[str, list[FeedbackRecord]] = defaultdict(list)
    for r in records:
        by_model[f"{r.provider_id}:{r.model_id}@{r.prompt_version or '-'}"].append(r)
    models = {
        name: {
            "reviews": len(rs),
            "approved_rate": round(sum(r.decision == "approved" for r in rs) / len(rs), 3),
            "approved_unedited_rate": round(
                sum(r.decision == "approved" and not r.edited_sections for r in rs) / len(rs), 3
            ),
            "mean_similarity": round(mean(r.mean_similarity for r in rs), 3),
        }
        for name, rs in sorted(by_model.items())
    }
    return {
        "reviews": len(records),
        "by_decision": dict(by_decision),
        "sections": section_stats,
        "models": models,
        "note": "Similarity compares model text with the expert-signed text (1.0 = unchanged). "
        "Expert approval is not clinical certification.",
    }


def export_jsonl(records: list[FeedbackRecord]) -> str:
    return "".join(json.dumps(r.to_json(), ensure_ascii=False) + "\n" for r in records)


def export_chat_jsonl(cases: list[CaseRecord], *, language: str = "tr") -> str:
    """Approved reports as chat examples (system, user prompt, expert-final JSON).

    The user prompt is rebuilt from the stored findings and RAG passages with the
    current prompt, so pairs stay consistent with what the model would see today.
    """
    lines = []
    for case in cases:
        record = feedback_record(case)
        draft = case.draft_report
        if record is None or record.decision != "approved" or draft is None or case.structured_findings is None:
            continue
        gen = build_generation_input(case, case.structured_findings, rag_passages=draft.rag_citations)
        target = {s.section: s.final_text for s in record.sections}
        lines.append(
            json.dumps(
                {
                    "messages": [
                        {"role": "system", "content": build_system_prompt(language)},
                        {"role": "user", "content": build_user_prompt(gen, build_aliases(gen))},
                        {"role": "assistant", "content": json.dumps(target, ensure_ascii=False)},
                    ],
                    "metadata": {
                        "case_id": case.case_id,
                        "model_id": record.model_id,
                        "prompt_version": record.prompt_version,
                        "edited_sections": record.edited_sections,
                    },
                },
                ensure_ascii=False,
            )
            + "\n"
        )
    return "".join(lines)
