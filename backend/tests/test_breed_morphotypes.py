import json
from collections.abc import Callable
from pathlib import Path

import pytest

from app.rag.breed_morphotypes import (
    load_breed_morphotype_data,
    load_breed_morphotype_documents,
)
from app.rag.embedding_retriever import EmbeddingRagRetriever
from app.rag.retriever import LexicalRagRetriever
from app.rag.vector_store import JsonVectorStore


def test_breed_morphotype_json_becomes_rag_documents() -> None:
    documents = load_breed_morphotype_documents()
    assert len(documents) == 25
    morphotypes = [doc for doc in documents if doc.section == "Irk morfolojisi"]
    assert len(morphotypes) == 6
    assert any("Siamese" in doc.keywords for doc in morphotypes)
    assert any("Golden Retriever" in doc.keywords for doc in morphotypes)
    assert all("eksiksiz bir ırk kaydı değildir" in doc.passage for doc in morphotypes)


def test_lexical_and_embedding_retrievers_can_find_breed_reference() -> None:
    lexical_hits = LexicalRagRetriever().retrieve("Siamese dolichocephalic cranial", top_k=5)
    assert lexical_hits
    assert any("Siamese" in hit.keywords for hit in lexical_hits)

    embedding_hits = EmbeddingRagRetriever().retrieve(
        "Siamese dolichocephalic cranial morphology",
        top_k=10,
    )
    assert embedding_hits
    assert any("Siamese" in hit.keywords for hit in embedding_hits)


def test_vector_store_load_adds_new_seed_docs_without_dropping_custom_docs(
    tmp_path: Path,
) -> None:
    path = tmp_path / "vector-store.json"
    store = JsonVectorStore(path)
    store.add_document(
        source_id="custom-doc",
        title="Custom",
        section="Test",
        passage="Keep this saved document.",
    )

    reloaded = JsonVectorStore(path)
    reloaded.load()
    source_ids = {doc.source_id for doc in reloaded.documents}
    assert "custom-doc" in source_ids
    assert "breed-dogs-brachycephalic" in source_ids
    assert "breed-pitfall-001" in source_ids


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"metadata": {}},
        {
            "metadata": {},
            "cranial_morphotypes": [],
            "suture_closure_rules_months": {},
            "anatomical_pitfalls": [],
        },
    ],
)
def test_breed_data_rejects_invalid_root_shape(
    payload: object,
    tmp_path: Path,
) -> None:
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ValueError):
        load_breed_morphotype_data(path)


def test_breed_data_surfaces_invalid_json(tmp_path: Path) -> None:
    path = tmp_path / "invalid.json"
    path.write_text("{", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        load_breed_morphotype_data(path)


def _valid_data() -> dict[str, object]:
    return {
        "metadata": {},
        "cranial_morphotypes": {},
        "suture_closure_rules_months": {"structures": {}},
        "anatomical_pitfalls": [],
    }


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda data: data.update(suture_closure_rules_months=[]), "suture_closure"),
        (lambda data: data.update(anatomical_pitfalls={}), "anatomical_pitfalls"),
        (
            lambda data: data.update(cranial_morphotypes={"dogs": []}),
            "cranial_morphotypes.dogs",
        ),
        (
            lambda data: data.update(cranial_morphotypes={"dogs": {"brachy": []}}),
            "Morphotype dogs.brachy",
        ),
        (
            lambda data: data.update(
                cranial_morphotypes={
                    "dogs": {"brachy": {"representative_breeds": ["Pug", 1]}}
                }
            ),
            "representative_breeds",
        ),
        (
            lambda data: data.update(
                suture_closure_rules_months={"structures": []}
            ),
            "structures",
        ),
        (
            lambda data: data.update(anatomical_pitfalls=[{"id": 1}]),
            "pitfall",
        ),
    ],
)
def test_breed_loader_rejects_malformed_data(
    mutate: Callable[[dict[str, object]], None],
    message: str,
    tmp_path: Path,
) -> None:
    data = _valid_data()
    mutate(data)
    path = tmp_path / "malformed.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        load_breed_morphotype_documents(path)
