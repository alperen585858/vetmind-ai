## Özet

Frontend `src/lib/pipeline.ts` içinde **Qdrant / 768-dim embed / token-s** gibi katmanlar yerel demo fiction’ıdır. Backend gerçekliği (hash RAG, mock LLM, thread jobs) ile karışınca bitirme / demo sunumunda yanlış güven oluşuyor.

**Kaynak:** `docs/HEDEF_MIMARI_GAP_ISSUE_LISTESI.md` → **ISS-FE-01** (P2), kısmen **ISS-FE-02**

## Mevcut durum

- `pipeline.ts` → `LAYERS`: “Qdrant, top-k = 20”, “vetmind-embed-tr-v1, 768 boyut”, token/s log’ları
- `NewCase` / `Processing`: `local` modda bu fiction; `backend` modda gerçek job poll
- System Status: kısmen mock GPU/queue kartları
- Backend gerçek: `EmbeddingRagRetriever` + hash n-gram, `MockLLMProvider`, thread/RQ

## Sorun

1. Kullanıcı / jüri fiction log’ları üretim AI sanabilir.
2. Docs’taki dürüst NO-GO mesajı UI’da zayıflıyor.
3. Backend health bayrakları ile FE kartları çelişebilir.

## Kabul kriterleri

- [ ] `pipeline.ts` fiction log’ları açıkça `DEMO FICTION` / `not backend` etiketi taşısın.
- [ ] `local` mode Processing ekranında kalıcı banner: “Yerel demo animasyonu — gerçek AI pipeline değil”.
- [ ] Backend mode’da fiction layer log’ları **gösterilmesin**; sadece gerçek job step / outcome.
- [ ] System Status GPU/queue kartları `health` API’den gelsin; yoksa “not configured” + demo badge.
- [ ] Vitest: local vs backend rendering ayrımı.
- [ ] `docs/ARCHITECTURE_AND_LLM.md` §6 risk maddesi “kapatıldı” olarak güncellensin.

## Out of scope

Gerçek Qdrant / 768-dim embedding bağlamak (ayrı BOUNDARY issue).
