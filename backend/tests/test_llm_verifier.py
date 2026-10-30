import json

import httpx

from app.llm.chat_providers import OpenAICompatibleProvider
from app.llm.grounding import check_grounding
from app.llm.verifier import build_verifier_user_prompt, collect_claims, parse_verdicts
from app.schemas.report import ReportSection
from tests.test_llm_chat_providers import _report_json, _request, _sequence_transport


def _verdicts(*items) -> dict:
    return {"verdicts": [dict(zip(("id", "label", "error_type", "note"), it)) for it in items]}


def _provider(*responses, calls: list, **kw) -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(
        model_id="writer", api_key="k", verify=True, prompt_version="vetmind-report-v3",
        transport=_sequence_transport(*responses, calls=calls), **kw
    )


def test_verifier_judges_each_cited_sentence_with_its_evidence() -> None:
    request, _, _ = _request()
    calls: list = []
    body = _report_json(request.generation)
    verdicts = _verdicts(
        ("V1", "supported", "none", ""),
        ("V2", "contradicted", "overstated_certainty", "Bulgu şüpheli, cümle kesin diyor."),
        ("V3", "unsupported", "irrelevant_source", "S2 granülomatöz hastalıktan söz ediyor."),
    )
    report = _provider(body, verdicts, calls=calls, verifier_model_id="judge").generate(request).report

    judge_call = calls[1]
    assert judge_call["model"] == "judge"  # separate judge model on the same endpoint
    user = judge_call["messages"][1]["content"]
    assert "[V1] section=findings" in user and "imaging finding — status=suspected" in user
    assert "reference passage — Inflammatory CNS disease" in user  # S2 evidence for the impression

    v = report.verification
    assert v.verifier_model == "judge"
    assert [x.label for x in v.verdicts] == ["supported", "contradicted", "unsupported"]
    assert v.verdicts[0].note == "" and v.verdicts[1].error_type == "overstated_certainty"
    assert round(v.supported_rate, 2) == 0.33
    assert report.generation.pipeline_steps == ["draft", "verify"]

    warnings = [w for w in check_grounding(report) if w.startswith("Verification")]
    assert len(warnings) == 2
    assert "is contradicted (overstated_certainty)" in warnings[0] and "kesin diyor" in warnings[0]


def test_verdict_disappears_after_expert_rewrites_the_sentence() -> None:
    request, _, _ = _request()
    body = _report_json(request.generation)
    verdicts = _verdicts(("V2", "unsupported", "invented_finding", "Kanıtta yok."))
    report = _provider(body, verdicts, calls=[]).generate(request).report
    assert any(w.startswith("Verification") for w in check_grounding(report))

    report.impression = ReportSection(text="Uzman tarafından yeniden yazıldı; meningiom olası [F1].")
    assert not any(w.startswith("Verification") for w in check_grounding(report))


def test_verifier_failure_leaves_draft_unverified() -> None:
    request, _, _ = _request()
    report = _provider(_report_json(request.generation), 503, calls=[]).generate(request).report
    assert report.verification is None
    assert report.generation.pipeline_steps == ["draft", "verify_failed"]


def test_parse_verdicts_is_lenient_but_never_guesses() -> None:
    request, _, _ = _request()
    gen = request.generation
    provider = OpenAICompatibleProvider(
        model_id="m", api_key="k", prompt_version="vetmind-report-v3",
        transport=_sequence_transport(_report_json(gen), calls=[]),
    )
    report = provider.generate(request).report
    claims = collect_claims(report)
    assert len(claims) == 3

    payload = json.dumps({"verdicts": [
        {"id": "v1", "label": "SUPPORTED", "error_type": "none", "note": "x"},
        {"id": "3", "label": "unsupported", "error_type": "made_up_type", "note": "y"},
        {"id": "V9", "label": "supported", "error_type": "none", "note": ""},
        {"id": "V2", "label": "maybe", "error_type": "none", "note": ""},
    ]})
    v = parse_verdicts(payload, claims, verifier_model="m")
    assert [(x.sentence == claims[i][1], x.label, x.error_type) for i, x in zip((0, 2), v.verdicts)] == [
        (True, "supported", "none"),
        (True, "unsupported", "unsupported_claim"),
    ]
    assert v.verdicts[0].note == ""  # notes only kept for problems


def test_unknown_marker_evidence_is_labelled() -> None:
    request, _, _ = _request()
    from app.llm.prompts import build_aliases

    aliases = build_aliases(request.generation)
    prompt = build_verifier_user_prompt([("impression", "Kitle [S9].", ["S9"])], request.generation, aliases)
    assert "(no such evidence was given to the writer)" in prompt
