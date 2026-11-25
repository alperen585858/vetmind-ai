# Değerlendirme sonuçları

Burada yalnızca README'deki sayıların dayandığı ve uygulamanın okuduğu son sonuçlar tutulur. Eski çalışmalar git geçmişinde duruyor (#86 ile kaldırıldı).

| Dosya | Ne | Nerede kullanılıyor |
|-------|----|---------------------|
| `20261030-165937.{md,json}` | LLM prompt karşılaştırması (llama3.2:3b, v2/v3/v4, 9 vaka × 3) | README §8.3 "Prompt" satırı |
| `20261030-181601.{md,json}` | LLM model karşılaştırması (llama3.2:3b, qwen2.5:7b) | README §8.3 "Model" satırı; Model Performansı sayfası (en yeni `cls-` olmayan JSON) |
| `cls-20261102-202753.{md,json}` | DICOM sınıflandırma, Türkçe/zor 24 vaka (kurallar, qwen2.5:7b/3b) | README sınıflandırma ölçümü; Model Performansı sayfası (en yeni `cls-*.json`) |
| `rag-20261125-141935.{md,json}` | RAG alaka değerlendirmesi, hash ve bge-m3 yan yana (#101) | README §8.4 RAG tabloları |
| `rerank-20261125-143506.md` | bge-m3 + qwen2.5:7b yeniden sıralama denemesi (eklenmedi) | README §8.4 "Yeniden sıralama" |
| `lessons-20261111-183500.md` | Uzman dersleri etkisi | README §8.5 |

Uygulama dosya adına göre en yenisini okur (`backend/app/api/llm_feedback.py`, `backend/app/api/dicom.py`). Yeni bir ölçüm README'ye girdiğinde eskisini silin ve bu tabloyu güncelleyin.
