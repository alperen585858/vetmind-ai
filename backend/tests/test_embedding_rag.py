from app.rag.embedding_retriever import EmbeddingRagRetriever
from app.rag.embeddings import HashEmbeddingBackend, cosine


def test_hash_embedding_normalized() -> None:
    backend = HashEmbeddingBackend(dim=32)
    v = backend.embed("canine brain mri seizure")
    assert len(v) == 32
    n = sum(x * x for x in v) ** 0.5
    assert abs(n - 1.0) < 1e-6


def test_embedding_retriever_ranks_brain_query() -> None:
    hits = EmbeddingRagRetriever().retrieve("canine brain mri mass seizure epilepsy", top_k=3)
    assert hits
    assert hits[0].score >= hits[-1].score


def test_cosine_identical() -> None:
    v = HashEmbeddingBackend(dim=16).embed("hello world")
    assert cosine(v, v) > 0.99
