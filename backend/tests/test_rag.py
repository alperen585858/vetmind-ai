from fastapi.testclient import TestClient

from app.llm.gateway import build_rag_query
from app.rag.retriever import LexicalRagRetriever
from app.schemas.case import CaseRecord
from app.schemas.enums import AnatomicalRegion, Modality, ModelExecutionStatus, Species
from app.schemas.findings import StructuredFindings, StudyInfo
from tests.conftest import make_payload


def test_lexical_retriever_finds_cervical() -> None:
    hits = LexicalRagRetriever().retrieve("servikal boyun ağrısı cervical MRI", top_k=3)
    assert hits
    assert any("servikal" in h.title.lower() or "cervical" in " ".join(h.keywords) for h in hits)


def test_rag_search_api(client: TestClient) -> None:
    res = client.get("/api/v1/rag/search", params={"q": "brain seizure epilepsy MRI", "top_k": 3})
    assert res.status_code == 200
    body = res.json()
    assert body["method"] in {"lexical_token_overlap", "hash_embedding_cosine"}
    assert len(body["hits"]) >= 1


def test_analyze_attaches_rag_citations(client: TestClient) -> None:
    payload = make_payload().model_dump(mode="json")
    payload["clinical_history"] = "Suspected intracranial mass effect; brain MRI; seizure history."
    case_id = client.post("/api/v1/cases", json=payload).json()["case_id"]
    analyzed = client.post(f"/api/v1/cases/{case_id}/analyze")
    assert analyzed.status_code == 200
    report = client.get(f"/api/v1/cases/{case_id}/report").json()
    assert "rag_citations" in report
    assert isinstance(report["rag_citations"], list)
    # Brain MRI findings should usually retrieve at least one seeded passage.
    assert len(report["rag_citations"]) >= 1


def test_build_rag_query_includes_modality() -> None:
    case = CaseRecord(
        case_id="c1",
        patient_name="Pax",
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        clinical_history="seizure",
    )
    findings = StructuredFindings(
        case_id="c1",
        study=StudyInfo(),
        species=Species.CANINE,
        modality=Modality.MR,
        anatomical_region=AnatomicalRegion.BRAIN,
        source_model_id="mock",
        source_model_version="0",
        execution_status=ModelExecutionStatus.SUCCESS,
        findings=[],
    )
    q = build_rag_query(case, findings)
    assert "MR" in q
    assert "BRAIN" in q
