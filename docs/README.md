# docs/ dizini

Ürünün güncel hâli için önce kök [README.md](../README.md) ve [ARCHITECTURE.md](../ARCHITECTURE.md) okunur. Bir belge kodla çelişirse kod esastır.

## Güncel belgeler

| Belge | Ne anlatır |
|-------|------------|
| [modularization.md](modularization.md) | Frontend (`src/features`, `src/shared`) ve backend modül sınırları, import kuralları |
| [ARCHITECTURE_MAP.md](ARCHITECTURE_MAP.md) | Paket → API → arayüz haritası |
| [ARCHITECTURE_AND_LLM.md](ARCHITECTURE_AND_LLM.md) | AI/LLM hattı, mock ↔ gerçek geçişi, eksikler |
| [LLM_KATMANI.md](LLM_KATMANI.md) | LLM sağlayıcıları, prompt sürümleri, doğrulama/hakem, KVKK maskeleme, değerlendirme |
| [ACIK_KAYNAK_ARASTIRMA.md](ACIK_KAYNAK_ARASTIRMA.md) | Açık modeller, doğrulayıcılar, değerlendirme araçları ve veri setleri araştırması |
| [VLM_FULL_STUDY_ANALYSIS.md](VLM_FULL_STUDY_ANALYSIS.md) | Bütün çalışmayı (tüm seriler) VLM'e gönderme ve kapsam raporu |
| [VLM_PDF_QUALITY_SMOKE.md](VLM_PDF_QUALITY_SMOKE.md) | MR/XR için VLM ve PDF kalite notları |
| [IMAGING_MODEL_PLUGIN_CHECKLIST.md](IMAGING_MODEL_PLUGIN_CHECKLIST.md) | Yeni görüntü modeli adaptörü eklerken kontrol listesi |
| [MODEL_PROMOTION.md](MODEL_PROMOTION.md) | Deneysel checkpoint'lerin üretim yoluna alınma kuralları |
| [INTEGRATION_PLAYBOOK.md](INTEGRATION_PLAYBOOK.md) | Model/veri gelince sisteme nasıl bağlanır (basit Türkçe) |
| [TRAINING_EXPORT_RUNBOOK.md](TRAINING_EXPORT_RUNBOOK.md) | Uzman onaylı vakaları eğitim verisi olarak dışa aktarma |
| [PROTECTED_DEMO_RUNBOOK.md](PROTECTED_DEMO_RUNBOOK.md) | Auth açık / protected modda demo |
| [READINESS_GOALS.md](READINESS_GOALS.md) | Goal A (eğitim öncesi yazılım) ve Goal B (klinik) ayrımı |
| [RELEASE_READINESS.md](RELEASE_READINESS.md) | Demo / protected / Goal A / Goal B için GO–NO-GO |
| [ENGINEERING_STATUS.md](ENGINEERING_STATUS.md) | Olgunluk skorları ve kalite kapıları |
| [MASTER_ROADMAP.md](MASTER_ROADMAP.md) | Workstream'ler ve kabul kriterleri |
| [TECHNICAL_DEBT.md](TECHNICAL_DEBT.md) | Öncelikli teknik borç kaydı |
| [HEDEF_MIMARI_GAP_ISSUE_LISTESI.md](HEDEF_MIMARI_GAP_ISSUE_LISTESI.md) | Hedef mimariye göre eksikler ve issue listesi |
| [FRONTEND_DESIGN_TOKENS.md](FRONTEND_DESIGN_TOKENS.md) | Arayüz renk/token değişkenleri |

Değerlendirme setleri ve sonuçları `backend/eval/` altında; hangi sonucun README'de kullanıldığı [backend/eval/results/README.md](../backend/eval/results/README.md) içinde yazar.

## Arşiv (`arsiv/`)

Geliştirme sırasında yazılmış, artık güncel olmayan belgeler. Tez yazımında kaynak olarak kullanılabilsin diye silinmedi; içlerindeki dosya yolları, roller (ör. sahip portalı) ve sayfalar (ör. ayrı "DICOM Yükle" sayfası) eski olabilir.

| Belge | Neden arşivde |
|-------|---------------|
| `PHASE_1_1_AND_2.md` … `PHASE_20_FINAL_AI_READINESS.md` | Faz bitiş raporları (Ekim 2026); sonraki fazlar ve yeniden düzenleme bunları aştı |
| `audits/` | Ekim 2026 denetim raporları (AI mimarisi, DICOM, PDF, Faz 7–8); bulgular kapatıldı veya `TECHNICAL_DEBT.md`'ye taşındı |
| `ARCHITECTURE_HARDENING_PHASE1.md` | DICOM → sınıflandırma → yönlendirme sertleştirmesinin ilk turu |
| `DEMO_PAYMENT_SUBMISSION_FLOW.md` | Sahip portalının demo ödeme akışı; sahip portalı kaldırıldı (#67) |
| `FOUNDER_LICENSE_ADMIN_PLAN.md` | Uygulanmamış kurucu admin / lisans planı |
| `P2_HARDENING_BACKLOG.md` | Kısa P2 listesi; güncel hâli `TECHNICAL_DEBT.md` |
