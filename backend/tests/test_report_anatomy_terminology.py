import json
import os
from hashlib import sha256
from pathlib import Path

import httpx
import pytest

from app.container import AppContainer
from app.llm.chat_providers import OpenAICompatibleProvider
from app.models.http_vision import HttpRemoteVisionModel
from app.schemas.case import CaseRecord
from app.schemas.dicom import DicomInstanceMeta, DicomSeriesMeta, DicomStudyMeta
from app.schemas.enums import AnatomicalRegion, Modality, PipelineOutcome, Species
from app.schemas.report import DraftReport
from app.services.repository import InMemoryCaseRepository
from app.settings import load_settings

BRAIN_ID = "VM-BBBF7A6412D6"
BRAINSTEM_ID = "VM-64B7884B4742"
TYMPANIC_BULLA_ID = "VM-9733C24ED15A"
VERSION = "3.1.1-search-foundation"


@pytest.fixture
def dictionary_path(tmp_path):
    # Where available, exercise this same pipeline with the original 1,179 records.
    supplied = os.getenv("VETMIND_TEST_REPORT_ANATOMY_DICTIONARY_PATH")
    if supplied:
        return Path(supplied)
    entries = [
        (BRAIN_ID, "beyin", ["brain", "beyin", "encephalon"]),
        (BRAINSTEM_ID, "beyin sapı", ["brain stem", "beyin sapı", "brainstem"]),
        ("VM-F3A1BB196EFD", "frontal lob", ["frontal lobe", "frontal lob"]),
        ("VM-666DE8E115A6", "servikal omurilik", ["cervical spinal cord", "servikal omurilik"]),
        (TYMPANIC_BULLA_ID, "timpanik bulla", ["tympanic bulla", "timpanik bulla"]),
        ("VM-1537248322CE", "bül", ["bül"]),
        ("edema-test", "ödem", ["edema", "ödem"]),
    ]
    terms = [
        {
            "Term_ID": term_id,
            "Turkish_Term": label,
            "Search_Labels": forms,
            "Category": ["C"] if label in {"bül", "ödem"} else ["A"],
            "Species": "Her ikisi",
            "Uncertain": False,
            "Clinical_Review_Required": True,
            "Source_Locations": [{"pdf_page": 34}],
            "External_Sources": [],
        }
        for term_id, label, forms in entries
    ]
    path = tmp_path / "dictionary.json"
    path.write_text(json.dumps({
        "metadata": {
            "Schema_Version": VERSION,
            "Count": len(terms),
            "Ambiguous_Query_Candidates": {"bulla": [TYMPANIC_BULLA_ID, "VM-1537248322CE"]},
        },
        "terms": terms,
    }), encoding="utf-8")
    return path


class SampleVision(HttpRemoteVisionModel):
    model_id = "mock-brain-mri-v1"
    version = "test"

    def __init__(self, location, *, source_kind="mock", description="ödem şüphesi"):
        super().__init__(model_id=self.model_id, endpoint="http://unused.test", version=self.version)
        self._body = {
            "execution_status": "success",
            "source_kind": source_kind,
            "findings": [{
                "finding_id": "sample-finding",
                "finding_code": "EDEMA",
                "description": description,
                "anatomical_location": location,
                "finding_status": "suspected",
                "laterality": "left",
                "uncertainty_note": "örnek modelin şüphe notu",
                "evidence_references": [{
                    "evidence_id": "sample-frame",
                    "description": "Seri T2, kare 7",
                    "series_instance_uid": "1.2.3",
                    "sop_instance_uid": "1.2.3.4",
                    "frame_index": 7,
                }],
            }],
        }

    def analyze(self, case):
        # Decode the sample with the existing Vision adapter. No service or images are required.
        return self._map_response(case, self._body)


@pytest.fixture
def application(tmp_path, monkeypatch, dictionary_path):
    monkeypatch.setenv("VETMIND_REPORT_ANATOMY_DICTIONARY_PATH", str(dictionary_path))
    monkeypatch.delenv("VETMIND_REPORT_ANATOMY_APPROVALS_PATH", raising=False)
    monkeypatch.setenv("VETMIND_STORAGE", "memory")
    monkeypatch.setenv("VETMIND_QUARANTINE_ROOT", str(tmp_path / "quarantine"))
    monkeypatch.setenv("VETMIND_LLM_PROVIDER", "mock")

    def build():
        return AppContainer(repo=InMemoryCaseRepository(), settings=load_settings())

    return build


def _run(container, location, *, language="tr", source_kind="mock", region=AnatomicalRegion.BRAIN):
    model = SampleVision(
        location, source_kind=source_kind,
        description="suspected edema" if language == "en" else "ödem şüphesi",
    )
    model_id = "mock-cervical-mri-v1" if region == AnatomicalRegion.CERVICAL else model.model_id
    model.model_id = model_id
    container.models[model_id] = model
    case = CaseRecord(
        case_id="sample-terminology",
        patient_name="Synthetic example",
        species=Species.FELINE if region == AnatomicalRegion.CERVICAL else Species.CANINE,
        modality=Modality.MR,
        anatomical_region=region,
        dicom_study=DicomStudyMeta(
            study_instance_uid="1.2",
            series=[DicomSeriesMeta(
                series_instance_uid="1.2.3",
                modality=Modality.MR,
                series_description="T2",
                instances=[DicomInstanceMeta(sop_instance_uid="1.2.3.4", instance_number=7)],
            )],
        ),
    )
    job = container.orchestrator.new_job(case.case_id)
    result = container.orchestrator.run(case, job, report_language=language)
    assert result.outcome == PipelineOutcome.SUCCESS, "\n".join(result.messages)
    assert result.report is not None and case.structured_findings is not None
    return case, result.report


@pytest.mark.parametrize(
    "location,wording,term_id",
    [
        ("brain", "beyinde", BRAIN_ID),
        ("BRAIN", "beyinde", BRAIN_ID),
        ("brainstem", "beyin sapında", BRAINSTEM_ID),
        ("bulla", "bulla", None),
        ("unknown-region-99", "unknown-region-99", None),
        ("Sol frontal lob", "Sol frontal lob", None),
        ("brain / frontal lobe", "brain / frontal lobe", None),
        ("edema", "edema", None),
        (None, "BRAIN", None),  # case-region fallback is not a model location
    ],
)
def test_vision_to_turkish_draft(application, dictionary_path, location, wording, term_id):
    case, report = _run(application(), location)
    assert wording in report.findings.text
    assert "ödem şüphesi" in report.findings.text
    assert "taraf: sol" in report.findings.text
    assert "Seri T2, kare 7" in report.findings.text
    assert report.findings.cited_finding_ids == ["sample-finding"]
    original = case.structured_findings.findings[0]
    assert original.anatomical_location == (location if location is not None else "BRAIN")
    assert original.finding_status == "suspected"
    assert original.laterality == "LEFT"
    assert original.evidence_references[0].evidence_id == "sample-frame"
    assert original.evidence_references[0].series_instance_uid == "1.2.3"
    assert original.evidence_references[0].sop_instance_uid == "1.2.3.4"
    assert original.evidence_references[0].frame_index == 7
    assert not any("dangling" in warning for warning in case.structured_findings.warnings)

    saved = DraftReport.model_validate_json(report.model_dump_json())
    trace = saved.generation.anatomy_terminology
    assert trace.dictionary.version == VERSION
    assert trace.dictionary.sha256 == sha256(dictionary_path.read_bytes()).hexdigest()
    assert trace.dictionary.mode == "demo"
    if term_id is not None:
        match = trace.matches["sample-finding"]
        assert match.term_id == term_id
        assert match.original_location == location
        assert match.turkish_label == ("beyin sapı" if term_id == BRAINSTEM_ID else "beyin")
        assert match.turkish_locative == wording
    else:
        assert trace.matches == {}
        assert "beyinde" not in report.findings.text
        assert "timpanik" not in report.findings.text


def test_feline_cervical_draft(application):
    _, report = _run(application(), "cervical spinal cord", region=AnatomicalRegion.CERVICAL)
    assert "servikal omurilikte ödem şüphesi" in report.findings.text


def test_english_draft_keeps_english_location(application):
    _, report = _run(application(), "brainstem", language="en")
    assert "location: brainstem" in report.findings.text
    assert "suspected edema" in report.findings.text
    assert "beyin sapı" not in report.findings.text
    assert report.generation.anatomy_terminology is None


@pytest.mark.parametrize("empty_findings", [False, True])
def test_chat_prompt_and_draft(application, empty_findings):
    def respond(request):
        system, user = json.loads(request.content)["messages"]
        assert system["role"] == "system"
        assert "status=suspected" in user["content"]
        assert "location=brain | Turkish location=beyin | Turkish locative=beyinde" in user["content"]
        assert "laterality=LEFT" in user["content"]
        assert "evidence=Seri T2, kare 7" in user["content"]
        assert "uncertainty=örnek modelin şüphe notu" in user["content"]
        assert "quote the original location verbatim" in user["content"]
        body = {
            "technique": "Beyin MR incelemesi.",
            "findings": "" if empty_findings else "beyinde ödem şüphesi [F1].",
            "impression": "Radyolog incelemesi gerektiren şüpheli bulgu [F1].",
            "recommendations": "Uzman radyolog incelemesi gerekli.",
        }
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps(body)}, "finish_reason": "stop"}],
        })

    container = application()
    container.llm.set_provider(OpenAICompatibleProvider(
        model_id="sample-report-writer",
        api_key="test",
        prompt_version="vetmind-report-v2",
        transport=httpx.MockTransport(respond),
    ))
    case, report = _run(container, "brain")
    assert "beyinde ödem şüphesi" in report.findings.text
    assert report.citation_map["F1"] == "sample-finding"
    assert report.findings.cited_finding_ids == ["sample-finding"]
    assert ("kare 7" in report.findings.text) == empty_findings
    revised = container.orchestrator.regenerate_report(case, "Konumu ve şüpheyi koruyun.")
    assert "beyinde ödem şüphesi" in revised.findings.text
    assert revised.generation.anatomy_terminology == report.generation.anatomy_terminology


def test_only_approved_terms_can_be_used_for_live_findings(
    application, dictionary_path, monkeypatch, tmp_path,
):
    _, demo = _run(application(), "brain", source_kind="real")
    assert "konum: brain" in demo.findings.text
    assert demo.generation.anatomy_terminology is None

    approvals_path = tmp_path / "approvals.json"
    approvals = {
        "dictionary_sha256": sha256(dictionary_path.read_bytes()).hexdigest(),
        "reviewed_by": "synthetic test reviewer",
        "terms": {BRAIN_ID: "beyinde", TYMPANIC_BULLA_ID: "timpanik bullada"},
    }
    approvals_path.write_text(json.dumps(approvals), encoding="utf-8")
    monkeypatch.setenv("VETMIND_REPORT_ANATOMY_APPROVALS_PATH", str(approvals_path))

    _, approved = _run(application(), "brain", source_kind="real")
    assert "beyinde ödem şüphesi" in approved.findings.text
    dictionary = approved.generation.anatomy_terminology.dictionary
    assert dictionary.mode == "reviewed"
    assert dictionary.approvals_sha256 == sha256(approvals_path.read_bytes()).hexdigest()
    for raw in ("brainstem", "bulla"):
        _, unresolved = _run(application(), raw, source_kind="real")
        assert f"konum: {raw}" in unresolved.findings.text
        assert unresolved.generation.anatomy_terminology.matches == {}

    approvals["dictionary_sha256"] = "0" * 64
    approvals_path.write_text(json.dumps(approvals), encoding="utf-8")
    with pytest.raises(ValueError, match="do not match"):
        application()


@pytest.mark.parametrize("location,reason", [
    ("bulla", "ambiguous"),
    ("unknown-region-99", "unknown"),
    ("Sol frontal lob", "unknown"),
    ("edema", "not_anatomy"),
])
def test_unresolved_reason_survives_report_storage(application, location, reason):
    _, report = _run(application(), location)
    restored = DraftReport.model_validate_json(report.model_dump_json())
    assert restored.generation.anatomy_terminology.unresolved == {"sample-finding": reason}


def test_left_and_right_survive_deduplication_and_report(application):
    from app.models.vlm_vision import _dedupe_findings
    from app.models.normalizer import normalize_outputs

    container = application()
    case, _ = _run(container, "brain")
    source = case.structured_findings
    left = source.findings[0]
    right = left.model_copy(deep=True)
    right.finding_id = "right-finding"
    right.laterality = "RIGHT"
    right.evidence_references[0].evidence_id = "right-frame"
    right.evidence_references[0].description = "Seri T2, kare 8"
    right.evidence_references[0].frame_index = 8
    separate = _dedupe_findings([left, right])
    assert len(separate) == 2
    merged = normalize_outputs([source.model_copy(update={"findings": separate})])
    report = container.llm.generate_draft(case, merged)
    assert "taraf: sol" in report.findings.text
    assert "taraf: sağ" in report.findings.text
    assert report.findings.text.count("beyinde ödem şüphesi") == 2
    assert "kare 7" in report.findings.text and "kare 8" in report.findings.text
    assert set(report.findings.cited_finding_ids) == {"sample-finding", "right-finding"}
    assert set(report.generation.anatomy_terminology.matches) == {"sample-finding", "right-finding"}
    assert {f.laterality for f in merged.findings} == {"LEFT", "RIGHT"}
    assert all(f.finding_status == "suspected" for f in merged.findings)


def test_collision_never_selected_even_when_one_candidate_is_anatomy(tmp_path):
    from app.llm.anatomy_dictionary import AnatomyDictionary

    path = tmp_path / "collision.json"
    terms = []
    for term_id, category in [("anatomy", "A"), ("finding", "C")]:
        terms.append({
            "Term_ID": term_id, "Turkish_Term": "örnek",
            "Search_Labels": ["same location"], "Category": [category],
            "Species": "Her ikisi", "Uncertain": False,
            "Source_Locations": [{"pdf_page": 1}], "External_Sources": [],
        })
    path.write_text(json.dumps({
        "metadata": {"Schema_Version": VERSION, "Count": 2, "Ambiguous_Query_Candidates": {}},
        "terms": terms,
    }), encoding="utf-8")
    dictionary = AnatomyDictionary(path)
    assert dictionary.resolve("same location", species=Species.CANINE) is None
    assert dictionary.unresolved_reason("same location", species=Species.CANINE) == "ambiguous"
