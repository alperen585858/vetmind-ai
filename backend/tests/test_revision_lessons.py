from pathlib import Path

from app.llm.chat_providers import OpenAICompatibleProvider
from app.llm.lessons import LessonContext, LessonStore
from tests.test_llm_chat_providers import _sequence_transport
from tests.test_phase6_e2e_journey import _client, _demo_upload_confirm_analyze

LESSON = "Ağrılı servikal vakada fibrokartilaginöz emboliyi öne çıkarma; FKE tipik olarak ağrısızdır."
BODY = {
    "technique": "Köpek, beyin MR incelemesi.",
    "findings": "Şüpheli ekstra-aksiyel kitle etkisi [F1].",
    "impression": "Meningiom olası görünmektedir [F1].",
    "recommendations": "Kontrastlı seriler önerilir. Uzman radyolog incelemesi gereklidir.",
}


def _ctx(**kw) -> LessonContext:
    data = dict(region="CERVICAL", species="canine", modality="MR", finding_codes=["CORD-COMPRESSION"])
    data.update(kw)
    return LessonContext(**data)


def test_match_requires_same_region_and_species() -> None:
    store = LessonStore()
    store.add(instruction=LESSON, context=_ctx(), created_by="expert")
    assert len(store.match(_ctx())) == 1
    assert store.match(_ctx(region="BRAIN")) == []
    assert store.match(_ctx(species="feline")) == []
    assert len(store.match(_ctx(modality="CT", finding_codes=[]))) == 1  # region is specific enough


def test_broad_region_also_needs_same_modality() -> None:
    store = LessonStore()
    store.add(instruction=LESSON, context=_ctx(region="OTHER", modality="XR"), created_by="expert")
    assert len(store.match(_ctx(region="OTHER", modality="XR"))) == 1
    assert store.match(_ctx(region="OTHER", modality="MR")) == []


def test_match_ranks_finding_overlap_and_skips_inactive() -> None:
    store = LessonStore()
    generic = store.add(instruction="Genel servikal not, ayrıntı.", context=_ctx(finding_codes=[]), created_by="e")
    specific = store.add(instruction=LESSON, context=_ctx(), created_by="e")
    assert [m.lesson_id for m in store.match(_ctx())] == [specific.lesson_id, generic.lesson_id]
    store.update(specific.lesson_id, active=False)
    assert [m.lesson_id for m in store.match(_ctx())] == [generic.lesson_id]
    assert len(store.match(_ctx(), limit=0)) == 0


def test_store_persists_and_counts_use(tmp_path: Path) -> None:
    path = tmp_path / "lessons.json"
    store = LessonStore(path)
    lesson = store.add(instruction=LESSON, context=_ctx(), created_by="expert", reason_codes=["wrong_finding"])
    store.mark_applied([lesson.lesson_id])
    reloaded = LessonStore(path).get(lesson.lesson_id)
    assert reloaded is not None and reloaded.times_applied == 1 and reloaded.reason_codes == ["wrong_finding"]
    assert LessonStore(path).delete(lesson.lesson_id)


def test_api_lesson_is_redacted_and_applied_to_next_draft(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = _demo_upload_confirm_analyze(client)
    case = client.get(f"/api/v1/cases/{case_id}").json()

    res = client.post(
        "/api/v1/lessons",
        json={"case_id": case_id, "instruction": f"{LESSON} Hasta {case['patient_name']}.", "reason_codes": ["wrong_finding"]},
    )
    assert res.status_code == 201, res.text
    lesson = res.json()
    assert case["patient_name"] not in lesson["instruction"] and "[HASTA]" in lesson["instruction"]
    assert lesson["region"] == case["anatomical_region"] and lesson["source_case_id"] == case_id

    # A prompt-based provider sees the lesson on the next draft for a similar case.
    calls: list = []
    provider = OpenAICompatibleProvider(
        model_id="m", api_key="k", prompt_version="vetmind-report-v3",
        transport=_sequence_transport(BODY, BODY, calls=calls),
    )
    client.app.state.container.llm.set_provider(provider)
    res = client.post(
        f"/api/v1/cases/{case_id}/report/regenerate",
        json={"reviewer_id": "expert-demo", "note": "Ayırıcı tanıyı yeniden değerlendir lütfen."},
    )
    assert res.status_code == 200, res.text
    user = calls[0]["messages"][1]["content"]
    assert "<expert_lessons>" in user and "FKE tipik olarak ağrısızdır" in user
    assert res.json()["draft_report"]["generation"]["applied_lesson_ids"] == [lesson["lesson_id"]]

    listed = client.get("/api/v1/lessons").json()
    assert listed[0]["times_applied"] == 1

    # Switched off: no longer sent.
    assert client.patch(f"/api/v1/lessons/{lesson['lesson_id']}", json={"active": False}).status_code == 200
    calls.clear()
    client.post(
        f"/api/v1/cases/{case_id}/report/regenerate",
        json={"reviewer_id": "expert-demo", "note": "Bir kez daha yeniden yaz lütfen."},
    )
    assert "<expert_lessons>" not in calls[0]["messages"][1]["content"]

    assert client.delete(f"/api/v1/lessons/{lesson['lesson_id']}").status_code == 204
    assert client.get("/api/v1/lessons").json() == []


def test_mock_provider_does_not_claim_lessons(tmp_path: Path) -> None:
    client = _client(tmp_path)
    case_id = _demo_upload_confirm_analyze(client)
    client.post("/api/v1/lessons", json={"case_id": case_id, "instruction": LESSON})
    res = client.post(
        f"/api/v1/cases/{case_id}/report/regenerate",
        json={"reviewer_id": "expert-demo", "note": "Ayırıcı tanıyı yeniden değerlendir lütfen."},
    )
    assert res.json()["draft_report"]["generation"]["applied_lesson_ids"] == []
