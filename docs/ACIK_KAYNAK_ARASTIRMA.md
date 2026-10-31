# LLM Katmanı — Açık Kaynak Araştırması

> Hazırlayan: Alperen (LLM) · Tarih: 30 Ekim 2026
> Kapsam: VetMind'in rapor üreten LLM katmanında kullanılabilecek açık modeller, doğrulayıcılar,
> değerlendirme araçları, yapılandırılmış çıktı araçları ve veri setleri.
> Not: Kaynakların çoğu ön baskı (preprint) ya da geliştiricinin kendi bildirdiği sonuçlardır;
> bağımsız doğrulama yapılmamıştır. Model kartları ve lisanslar kullanmadan önce tekrar kontrol edilmelidir.

## Özet

1. **Projeye doğrudan uyan hazır açık kaynak çözüm yok.** Açık radyoloji modellerinin hepsi insan
   göğüs röntgeni ve İngilizce üzerine kurulu; açık bir veteriner görüntü + rapor veri seti bulunamadı.
   Kendi değerlendirme setimiz ve VRM verisi bu yüzden alanda nadir bir katkı.
2. **Açık doğrulayıcıların (halüsinasyon tespiti) hepsi İngilizce.** Türkçe raporlar için atıf
   doğrulayıcı, kendi modelimizle bir "hakem" prompt'u olarak yazılmalı.
3. **Küçük modellerdeki boş bölüm sorunu literatürde biliniyor.** JSON şeması zorlamak 0,6–4B
   modellerde biçim hatasını %100 çözüyor ama içerik eksik kalabiliyor ("semantic gap").
   llama3.2:3b'de ölçtüğümüz boş bölüm davranışı tam olarak bu.
4. **Türkçe için en iyi aday aileler Qwen ve Llama.** Gemma Türkçe testlerde geride;
   MedGemma'nın Türkçe performansı hiç test edilmemiş.
5. **Değerlendirmede GREEN yaklaşımı (hata türlerini sayan hakem model) en uygunu.**
   Açık ama İngilizce; yöntem Türkçe hakem prompt'uyla uyarlanmalı.

## 1. Rapor yazacak model adayları

Geliştirme makinesi: Apple M3 Pro, 18 GB RAM, ~12 GB boş disk.

| Model | Boyut | Türkçe | Tıp | Lisans | Bu makinede |
|---|---|---|---|---|---|
| Qwen2.5-7B / Qwen3-8B | 4,7–5 GB | İyi (TUMLU'da Qwen2.5-72B açık modellerin en iyisi) | Genel | Apache 2.0 | ✅ |
| Trendyol-LLM-8B-T1 (Qwen3-8B tabanlı) | ~5 GB | Türkçeye özel | Genel | Model kartı | ✅ |
| MedGemma 1.5 4B (çok modlu) | 3,3 GB | Test edilmemiş; Arapça testte zayıf | ✅ | Google HAI-DEF | ✅ |
| MedGemma 27B (metin) | 17 GB | Test edilmemiş | ✅ (MMedBench'te en iyi tıbbi model, 65,88) | HAI-DEF | ❌ RAM |
| Turkish-LLM-14B (Qwen2.5-14B tabanlı) | ~9 GB | TurkishMMLU 61,3 (kendi bildirimi) | Genel | Model kartı | ⚠️ |
| TUSGPT-TR-Medical-9B, qwen2.5-7b-turkish-medical | 5–6 GB | Türkçe tıbbi | Doğrulanmamış topluluk çalışması | Değişken | ✅ (riskli) |
| Llama 3 70B | ~40 GB | TurkishMMLU'da açık modellerin en iyisi (67,3) | Genel | Llama | ❌ |

**Önerilen deneme sırası** (`scripts/llm_eval.py --repeat 3` ile):
1. `qwen2.5:7b` — Türkçe ve JSON'da en güvenilir aday
2. `medgemma1.5:4b` — tıbbi bilgi ile Türkçe zayıflığı karşılaştırması
3. Trendyol-LLM-8B (GGUF bulunursa) — yerli Türkçe seçenek

## 2. Açık radyoloji rapor modelleri

| Model | Boyut | Ne yapar | Bizim için |
|---|---|---|---|
| CheXagent-2 (Stanford) | 3B | Göğüs röntgeninden rapor | ❌ İnsan, İngilizce |
| LLaVA-Rad (Microsoft) | 7B | Göğüs röntgeni bulguları | ❌ Aynı sınırlama |
| MAIRA-2 (Microsoft) | 13B | Görüntüde işaretli (grounded) rapor | ❌ Araştırma lisansı, insan göğüs röntgeni |
| MedGemma 4B | 4B | Göğüs röntgeni raporunda en iyi (RadGraph F1 30,3) | ⚠️ Vision tarafı için ilginç; MR/CT için kanıt yok |

Bunlar "bulgulardan rapor yazma" katmanımızın yerine geçmez; görüntüden bulgu çıkarma (Vision) tarafında ileride düşünülebilir.

## 3. Açık doğrulayıcılar (halüsinasyon tespiti)

| Model | Boyut | Lisans | Not |
|---|---|---|---|
| HHEM-2.1-Open (Vectara) | 110M | Açık | En hafif |
| MiniCheck-Flan-T5-L / Bespoke-MiniCheck-7B | 0,8B / 7B | Açık | Bir 2026 karşılaştırmasında en yüksek F1 (0,67) |
| Lynx (Patronus AI) | 8B / 70B | CC-BY-NC (ticari değil) | RAG'e en uygun; HaluBench %82,9 / %87,4 |
| Granite-Guardian 4.1 (IBM) | 8B | Açık | F1 0,66 |

Hepsi İngilizce eğitilmiş; aralarındaki fark küçük (F1 0,61–0,67). Türkçe için seçenekler:
- **(a) Önerilen:** Kendi modelimizle hakem prompt'u — her cümle + atfettiği bulgu/pasaj → destekleniyor / desteklenmiyor / çelişiyor.
- (b) Cümleleri İngilizceye çevirip MiniCheck'e vermek — çeviri yeni hata kaynağı ekler.

Araştırma eğilimi: rapor uzmana gitmeden önce cümle düzeyinde doğrulama (CogRad'ın doğrulayıcı ajanı,
süreç ödül modelleri, kaynaklı hakem modellerle %8–17 kalite artışı).

## 4. Açık değerlendirme araçları

- **RadEval:** BLEU, ROUGE, BERTScore, RadGraph F1, RaTEScore ve GREEN'i birleştiren açık çerçeve.
- **GREEN:** Açık hakem modeli (<7B; Gemma-2B sürümü de var). Klinik hataları türlerine göre sayar;
  uzman değerlendirmeleriyle uyumu eski metriklerden yüksek. Skor = eşleşen bulgu / (eşleşen + önemli hatalar).
- **RaTEScore:** Varlık (entity) tabanlı metrik; RaTE-NER ve RaTE-Eval açık.

Hepsi İngilizce ve insan göğüs röntgeni odaklı. Bizim için yol: GREEN'in hata kategorilerini Türkçe hakem
prompt'uyla uygulamak. **Gereksinim:** test setinde uzmanın yazdığı referans raporlar.

## 5. Yapılandırılmış çıktı ve model sunma

- Ollama ≥ 0.5 JSON şemasını doğrudan uygular (mevcut kullanımımız).
- vLLM (sunucuya geçince): XGrammar ve guidance hızlı; guidance şema uyumunda en iyi
  (JSONSchemaBench); Outlines zaman aşımı yaşıyor; XGrammar bazı durumlarda gevşek kısıtlıyor.
- **Kritik:** Şema zorlamak içerik kalitesini garanti etmez. Küçük modelde çözüm: işi bölmek
  (iki adımlı üretim), hedefli onarım, daha büyük model.

## 6. Türkçe başarı testleri

TurkishMMLU, TUMLU, Cetvel (Türkçe üretim ve kültürel yetkinlik), TurkMedNLI (Türkçe tıbbi çıkarım).
TurkMedNLI alt kümesi, hakem (doğrulayıcı) model seçiminde kullanılabilir.

## 7. Veri setleri

- Açık veteriner görüntü + rapor veri seti bulunamadı. Bulunan veteriner çalışmaları tek kurumun
  PACS arşivinden (50 çalışma; 899 göğüs röntgeni) ve kamuya açık değil.
- İnsan veri setleri (MIMIC-CXR, IU-Xray/OpenI, ReXGradient-160K) yalnızca göğüs röntgeni ve İngilizce.
- Çıkarım: VRM verisi ve kendi değerlendirme setimiz projenin özgün katkısı; veri paylaşım
  anlaşmaları için veteriner eğitim hastaneleriyle görüşülebilir.

## Yol haritası

1. **İndirme gerektirmeyen:** iki adımlı üretim + hedefli onarım; Türkçe atıf doğrulayıcı (hakem prompt'u).
2. **Model denemesi:** `qwen2.5:7b` → `medgemma1.5:4b`, `--repeat 3` ile llama3.2:3b'ye karşı.
3. **Ekiple:**
   - Buğra: test setine referans raporlar (GREEN tarzı değerlendirme).
   - Beyza: Vision tarafı için MedGemma 4B.
   - Nehir: RAG'in alakasız ırk pasajlarını getirmesi.

## Kaynaklar

**Modeller:**
- [MedGemma Technical Report](https://arxiv.org/html/2507.05201v4)
- [MedGemma 1.5 Technical Report](https://arxiv.org/html/2604.05081v1)
- [MedGemma model card](https://developers.google.com/health-ai-developer-foundations/medgemma/model-card)
- [MedGemma GitHub](https://github.com/google-health/medgemma)
- [Google Research blog](https://research.google/blog/medgemma-our-most-capable-open-models-for-health-ai-development/)
- [medgemma1.5 (Ollama)](https://ollama.com/library/medgemma1.5)
- [medgemma-27b-text-it](https://huggingface.co/google/medgemma-27b-text-it)
- [TUSGPT-TR-Medical-9B](https://featherless.ai/models/turkerberkdonmez/TUSGPT-TR-Medical-9B)
- [qwen2.5-7b-turkish-medical-v1](https://featherless.ai/models/enes1773/qwen2.5-7b-turkish-medical-v1)
- [Turkish-LLM](https://github.com/ogulcanaydogan/Turkish-LLM)

**Çok dilli ve Türkçe değerlendirme:**
- [HealMed](https://arxiv.org/html/2608.19981v1)
- [Med-CoReasoner](https://arxiv.org/pdf/2601.08267)
- [MedAraBench](https://arxiv.org/html/2602.01714v1)
- [TurkishMMLU](https://arxiv.org/pdf/2407.12402)
- [TUMLU](https://arxiv.org/html/2502.11020v2)
- [Cetvel](https://arxiv.org/pdf/2508.16431)
- [Open-weight LLMs for Turkish documents](https://arxiv.org/abs/2609.28007)
- [LLMs on Turkish specialty exam](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12023555/)
- [TurkMedNLI](https://peerj.com/articles/cs-2662/)

**Radyoloji modelleri:**
- [LLaVA-Rad](https://huggingface.co/microsoft/llava-rad)
- [LLaVA-Rad (Nature Comm.)](https://www.nature.com/articles/s41467-025-58344-x)
- [MAIRA-2](https://www.researchgate.net/publication/381294716_MAIRA-2_Grounded_Radiology_Report_Generation)
- [RadVLM](https://arxiv.org/html/2502.03333v1)
- [FactCheXcker](https://arxiv.org/pdf/2411.18672)

**Doğrulama:**
- [CogRad](https://arxiv.org/pdf/2607.03853)
- [Sentence-level PRM verification](https://arxiv.org/html/2510.23217v1)
- [RAG LLM judge (NeurIPS 2026)](https://neurips.cc/virtual/2026/177230)
- [Grounding on PadChest-GR](https://proceedings.mlr.press/v315/aas-alas26a.html)
- [Lynx](https://www.alphaxiv.org/abs/2407.08488v1)
- [Span-level hallucination detection](https://arxiv.org/html/2607.00895v1)
- [HalluGuard](https://arxiv.org/pdf/2510.00880)

**Değerlendirme:**
- [GREEN](https://arxiv.org/html/2405.03595v1)
- [RaTEScore](https://arxiv.org/html/2406.16845v2)
- [RadEval](https://arxiv.org/html/2509.18030v1)
- [ReXrank](https://arxiv.org/pdf/2411.15122)

**Yapılandırılmış çıktı:**
- [Constrained decoding semantic gap](https://arxiv.org/html/2609.23742v1)
- [JSONSchemaBench](https://arxiv.org/html/2501.10868v1)
- [vLLM structured outputs](https://developers.redhat.com/articles/2025/06/03/structured-outputs-vllm-guiding-ai-responses)

**Veri:**
- [Frontiers vet radiograph study](https://www.frontiersin.org/journals/veterinary-science/articles/10.3389/fvets.2025.1502790/full)
- [VRU 2024 thoracic radiographs](https://onlinelibrary.wiley.com/doi/10.1111/vru.13373)
- [ReXGradient-160K](https://arxiv.org/pdf/2505.00228)
