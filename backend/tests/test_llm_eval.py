import json
from pathlib import Path

import httpx

from app.evaluation.llm_eval import (
    EvalSet,
    english_ratio,
    load_eval_set,
    render_markdown,
    run_eval,
    term_found,
    to_pipeline_inputs,
)
from app.llm.chat_providers import OpenAICompatibleProvider
from app.llm.interfaces import LLMUnavailableError
from app.rag.retriever import LexicalRagRetriever
from app.schemas.enums import ModelExecutionStatus

SET_PATH = Path(__file__).resolve().parents[1] / "eval" / "llm_eval_set.json"

GOOD = {
    "technique": "Köpek, beyin MR incelemesi.",
    "findings": "Sağ frontal konvekside geniş tabanlı, kontrast tutan ekstra-aksiyel kitle şüphesi [F1].\n"
    "Çevre beyaz cevherde vazojenik ödem olasıdır [F2].\nFalkste hafif sola deviasyon belirsizdir [F3].",
    "impression": "Bulgular öncelikle meningiom ile uyumlu olabilir [F1, S1]. Histiyositik sarkom ayırıcı tanıda yer alır [S1].",
    "recommendations": "Kontrastlı sekansların uzman radyolog tarafından incelenmesi önerilir.",
}
BAD = {
    "technique": "Brain MR study of the dog.",
    "findings": "There is a mass in the brain and the findings suggest a lesion.",
    "impression": "Kesin tanı meningiomdur [F1]. Çalışma normal sınırlarda [S9].",
    "recommendations": "None.",
}


def _set(*case_ids: str) -> EvalSet:
    s = load_eval_set(SET_PATH)
    s.cases = [c for c in s.cases if c.id in case_ids]
    return s


def _provider(*payloads) -> OpenAICompatibleProvider:
    queue = list(payloads)

    def handler(req: httpx.Request) -> httpx.Response:
        item = queue.pop(0)
        if isinstance(item, int):
            return httpx.Response(item)
        content = json.dumps(item, ensure_ascii=False)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})

    return OpenAICompatibleProvider(model_id="fake", api_key="k", transport=httpx.MockTransport(handler))


def test_seed_set_is_valid_and_covers_edge_cases() -> None:
    s = load_eval_set(SET_PATH)
    ids = {c.id for c in s.cases}
    assert len(ids) == len(s.cases) >= 9
    assert {"no-findings-01", "failed-analysis-01", "injection-pii-01"} <= ids
    failed = next(c for c in s.cases if c.id == "failed-analysis-01")
    _, findings = to_pipeline_inputs(failed)
    assert findings.execution_status == ModelExecutionStatus.FAILED


def test_good_draft_scores_high_bad_draft_scores_low() -> None:
    s = _set("brain-mass-01")
    good = run_eval(s, _provider(GOOD), rag=LexicalRagRetriever()).cases[0]
    assert good.ok
    assert good.citation_coverage == 1.0 and good.finding_coverage == 1.0
    assert good.differential_recall == 1.0 and good.must_mention_recall == 1.0
    assert not good.forbidden_hits and not good.overclaims and good.unknown_refs == 0
    assert good.score >= 90

    bad = run_eval(s, _provider(BAD), rag=LexicalRagRetriever()).cases[0]
    assert bad.citation_coverage == 0.667  # findings sentence uncited; impression cites (one invalid)
    assert bad.finding_coverage < 0.5
    assert bad.unknown_refs == 1
    assert any("definitive diagnosis" in o for o in bad.overclaims)
    assert bad.forbidden_hits == ["kesin tanı|definitive diagnosis"]
    assert bad.english_ratio > 0.2
    assert bad.score < 50


def test_provider_errors_are_recorded_not_raised() -> None:
    s = _set("brain-mass-01", "no-findings-01")
    run = run_eval(s, _provider(503, GOOD))
    assert [c.ok for c in run.cases] == [False, True]
    assert run.cases[0].score == 0.0 and "unavailable" in run.cases[0].error
    summary = run.summary()
    assert summary["success_rate"] == 0.5


def test_markdown_compares_models() -> None:
    s = _set("brain-mass-01")
    rag = LexicalRagRetriever()
    runs = [
        run_eval(s, _provider(GOOD), rag=rag, label="iyi-model"),
        run_eval(s, _provider(BAD), rag=rag, label="kotu-model"),
    ]
    md = render_markdown(runs, s)
    assert "| Metrik | `iyi-model` | `kotu-model` |" in md
    assert "Beklenen tanı yakalama | 100% | 50% |" in md  # BAD names meningiom only
    assert "## Dikkat gerektirenler" in md and "kotu-model" in md.split("## Dikkat gerektirenler")[1]


def test_term_matching_folds_turkish_characters() -> None:
    assert term_found("Disk ekstrüzyonu ile uyumlu", "disk ekstruzyon|IVDE")
    assert term_found("C3–C4 seviyesinde", "C3-C4")
    assert not term_found("meningiom olası", "gliom|glioma")
    assert english_ratio("Sağ frontal kitle izlenmektedir.") == 0.0
