## Özet

RAG citations şu an retrieve edilen **tüm** pasajları gösteriyor; LLM’in gerçekten kullandığı pasaj filtresi yok. Citation ↔ finding bağlama zayıf. Grounding yanıltıcı görünebilir (“klinik kanıt” sanılabilir).

**Kaynak:** `docs/HEDEF_MIMARI_GAP_ISSUE_LISTESI.md` → **ISS-RAG-04**, **ISS-RAG-05** · audit **F13**, **P7-R4**, **P8-R2** (P2)

## Mevcut durum

- Retriever: `backend/app/rag/retriever.py`, `embedding_retriever.py`
- Embedding: hash n-gram (`HashEmbeddingBackend`) + `JsonVectorStore` (Qdrant / sentence-transformers değil)
- Corpus: `rag/corpus.py` → sentetik `SEED_CORPUS`
- Gateway: `llm/gateway.py` → draft + `rag_citations`
- UI: `RagCitations` bileşeni; `rag_note` uyarısı var ama citations “used” değil

## Sorun

1. Draft’taki her citation, modelin bağlamda kullandığı anlamına gelmiyor.
2. Finding ID ↔ passage link alanı yok / zayıf.
3. Retrieval score klinik güven gibi okunabilir (kısmen iyileştirildi; hâlâ risk).

## Kabul kriterleri

- [ ] LLM response / gateway, `used_passage_ids` (veya eşdeğeri) döndürsün; UI yalnızca bunları “cited” göstersin.
- [ ] Retrieve edilip kullanılmayan pasajlar ayrı “retrieved but unused” (opsiyonel, kapalı default) veya hiç gösterilmesin.
- [ ] `RagCitation` şemasına opsiyonel `related_finding_ids: list[str]` eklensin.
- [ ] Mock + HTTP LLM provider’ları wire contract’ı güncellesin; mock deterministik used-set üretsin.
- [ ] Validator RAG’i klinik kanıt saymaya devam **etmesin**.
- [ ] Pytest: unused passage draft citations’ta yok; finding-link fixture yeşil.
- [ ] FE: skor etiketi `retrieval_score=` olarak kalsın; “confidence” dilinden kaçınılsın.

## Teknik notlar

- HTTP LLM wire değişikliği backward-compatible olmalı (alan yoksa “all retrieved = cited” legacy + uyarı).
- Gerçek embedding / vector DB bu issue kapsamında değil (BOUNDARY: ISS-RAG-02/03).

## Referans

- `docs/audits/01_AI_ARCHITECTURE.md` F13
- `docs/audits/PHASE_7_DEEP_AUDIT.md` P7-R4
- `docs/audits/PHASE_8_SECURITY_ASYNC.md` P8-R2
