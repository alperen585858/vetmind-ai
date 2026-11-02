"""Empty imaging findings must instruct the LLM not to invent abnormalities."""

from __future__ import annotations

from app.llm.interfaces import LLMGenerationInput
from app.llm.prompts import build_aliases, build_user_prompt
from app.schemas.enums import AnatomicalRegion, Modality, ModelExecutionStatus, Species


def test_empty_findings_user_prompt_forbids_invention() -> None:
    gen = LLMGenerationInput(
        case_id="c1",
        species=Species.CANINE,
        modality=Modality.XR,
        anatomical_region=AnatomicalRegion.THORAX,
        findings=[],
        no_findings_returned=True,
        execution_status=ModelExecutionStatus.SUCCESS,
    )
    aliases = build_aliases(gen)
    text = build_user_prompt(gen, aliases)
    assert "Do NOT invent abnormalities" in text
    assert "none were returned" in text.lower() or "IMAGING FINDINGS: none" in text
