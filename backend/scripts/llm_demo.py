#!/usr/bin/env python3
"""Run one sample case through the configured LLM provider and print the draft.

Run (no API key needed — shows the exact prompt sent to the model):
  cd backend && source .venv/bin/activate
  python scripts/llm_demo.py --dry-run

Real model (examples):
  VETMIND_LLM_PROVIDER=anthropic VETMIND_LLM_API_KEY=sk-ant-... python scripts/llm_demo.py
  VETMIND_LLM_PROVIDER=ollama VETMIND_LLM_MODEL_ID=qwen2.5:14b python scripts/llm_demo.py
  VETMIND_LLM_PROVIDER=openai VETMIND_LLM_MODEL_ID=<model> VETMIND_LLM_API_KEY=sk-... python scripts/llm_demo.py

Uses mock imaging findings and the seeded demo RAG corpus. Output is a DRAFT for
radiologist review, never a clinical result.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.llm.factory import build_llm_provider  # noqa: E402
from app.llm.gateway import LLMGateway, build_generation_input, build_rag_query  # noqa: E402
from app.llm.interfaces import LLMProviderError  # noqa: E402
from app.llm.prompts import build_aliases, build_system_prompt, build_user_prompt  # noqa: E402
from app.models.mock_vision import MockBrainMriModel, MockCervicalMriModel  # noqa: E402
from app.rag.retriever import LexicalRagRetriever  # noqa: E402
from app.schemas.case import CaseRecord  # noqa: E402
from app.schemas.enums import AnatomicalRegion, MockScenario, Modality, Species  # noqa: E402
from app.settings import load_settings  # noqa: E402
from app.validation.report_validator import ReportValidator  # noqa: E402

SAMPLES = {
    "brain": (
        CaseRecord(
            case_id="demo-brain-1",
            patient_name="Demo",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.BRAIN,
            scenario=MockScenario.BRAIN_MRI_SUSPECTED,
            clinical_history="9 yaşında erkek Boxer. 3 haftadır tekrarlayan jeneralize nöbetler, "
            "son günlerde sola dönme ve davranış değişikliği.",
        ),
        MockBrainMriModel(),
    ),
    "cervical": (
        CaseRecord(
            case_id="demo-cervical-1",
            patient_name="Demo",
            species=Species.CANINE,
            modality=Modality.MR,
            anatomical_region=AnatomicalRegion.CERVICAL,
            scenario=MockScenario.CERVICAL_MRI_SUSPECTED,
            clinical_history="6 yaşında dişi Dachshund. Ani başlayan boyun ağrısı, "
            "tetraparezi; derin ağrı algısı korunuyor.",
        ),
        MockCervicalMriModel(),
    ),
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--case", choices=sorted(SAMPLES), default="brain")
    parser.add_argument("--dry-run", action="store_true", help="print the prompt, do not call the model")
    args = parser.parse_args()

    settings = load_settings()
    case, model = SAMPLES[args.case]
    findings = model.analyze(case)
    rag = LexicalRagRetriever()

    if args.dry_run:
        passages = rag.retrieve(build_rag_query(case, findings), top_k=4)
        gen = build_generation_input(case, findings, rag_passages=passages)
        print("=== SYSTEM ===\n" + build_system_prompt(settings.llm_report_language))
        print("\n=== USER ===\n" + build_user_prompt(gen, build_aliases(gen)))
        return 0

    try:
        provider = build_llm_provider(settings)
        report = LLMGateway(provider, rag=rag).generate_draft(case, findings)
    except LLMProviderError as exc:
        print(f"LLM error ({exc.kind.value}): {exc}", file=sys.stderr)
        return 1

    result = ReportValidator().validate(report, findings)
    g = report.generation
    print(f"Provider: {g.provider_id} · model: {g.model_id} · prompt: {g.prompt_version}")
    for name in ("technique", "findings", "impression", "recommendations"):
        print(f"\n## {name.upper()}\n{getattr(report, name).text}")
    if report.differentials:
        print("\n## DIFFERENTIALS")
        for i, d in enumerate(report.differentials, 1):
            cites = f" [{', '.join(d.citations)}]" if d.citations else ""
            print(f"  {i}. {d.name} — {d.likelihood}{cites}")
            for x in d.supporting:
                print(f"       + {x}")
            for x in d.against:
                print(f"       − {x}")
    if report.citation_map:
        print("\n## CITATIONS")
        for alias, ref in report.citation_map.items():
            print(f"  [{alias}] {ref}")
    print(f"\n## VALIDATION ({'ok' if result.ok else 'FAILED'} · status={report.status.value})")
    for w in report.validation_warnings:
        print(f"  - {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
