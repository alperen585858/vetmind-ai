# VetMind AI — Veteriner Teleradyoloji Platformu

Acıbadem Üniversitesi CSE 401/402 bitirme projesi · VRM Teknoloji iş birliğiyle.

**Multimodal / multi-model AI destekli veteriner teleradyoloji** prototipi. Platform radyoloğa yardımcı olur; otonom tanı koymaz.

| | |
|---|---|
| Backend sürüm | `0.2.0` |
| Frontend | React 18 · TypeScript · Vite 5 · Tailwind · React Router 6 |
| Backend | Python 3.11+ · FastAPI · Pydantic · pydicom |
| Kalıcılık | PostgreSQL (varsayılan, Alembic migration'ları) · SQLite (yerel geliştirme) · memory (testler) |
| Jobs | Thread worker (varsayılan) · opsiyonel RQ + Redis |
| Demo hazırlık | **GO** (sentetik veri) |
| Klinik üretim / gerçek AI | **NO-GO** |

> **Klinik sistem değildir.** Gerçek eğitilmiş Vision AI / VLM, ücretli LLM, PACS veya klinik validasyon yoktur. Varsayılan çıktılar `MOCK` / `SYNTHETIC` etiketlidir; uzman veteriner radyolog onayı zorunludur. Bu README hızlı başlangıç + ürün durumunun tek giriş noktasıdır; derinlik için [ARCHITECTURE.md](ARCHITECTURE.md) ve [docs/](docs/) belgelerine bakın.

---

## İçindekiler

1. [Proje özeti](#1-proje-özeti)
2. [Ne çalışıyor / ne yok](#2-ne-çalışıyor--ne-yok)
3. [Geliştirme fazları](#3-geliştirme-fazları)
4. [Hızlı başlangıç](#4-hızlı-başlangıç)
5. [Demo akışı](#5-demo-akışı)
6. [Sistem mimarisi](#6-sistem-mimarisi)
7. [Uçtan uca veri akışı](#7-uçtan-uca-veri-akışı)
8. [AI / Vision / LLM / RAG](#8-ai--vision--llm--rag)
9. [Rapor yaşam döngüsü](#9-rapor-yaşam-döngüsü)
10. [Auth, RBAC ve güvenlik](#10-auth-rbac-ve-güvenlik)
11. [Frontend](#11-frontend)
12. [API referansı](#12-api-referansı)
13. [Ortam değişkenleri](#13-ortam-değişkenleri)
14. [Opsiyonel altyapı](#14-opsiyonel-altyapı)
15. [Testler](#15-testler)
16. [Depo düzeni](#16-depo-düzeni)
17. [Swap-in noktaları](#17-swap-in-noktaları)
18. [Dokümantasyon indeksi](#18-dokümantasyon-indeksi)
19. [Uyarılar ve sonraki adımlar](#19-uyarılar-ve-sonraki-adımlar)

---

## 1. Proje özeti

VetMind AI, veteriner klinikleri ile uzman teleradyolog arasında köprü kurmayı hedefleyen bir **karar destek** prototipidir:

1. DICOM / doküman yükleme ve karantina  
2. Tür / modalite / bölge sınıflandırması + kullanıcı onayı  
3. Capability tabanlı model routing  
4. Vision adapter(lar) → yapılandırılmış bulgular  
5. Fusion / normalizasyon  
6. RAG destekli LLM taslak rapor  
7. Yapısal rapor doğrulama  
8. Uzman inceleme (approve / reject / revision) → immutable sürüm → print/PDF  

**Mimari desen:** Modular monolith. Tüm bağımlılıklar `backend/app/container.py` (`AppContainer`) içinde birleşir; HTTP katmanı ince router’lardır. Gerçek modeller adapter olarak eklenir; orchestrator yeniden yazılmaz.

---

## 2. Ne çalışıyor / ne yok

### Çalışan özellikler

| Alan | Durum |
|------|--------|
| **Frontend** | Landing, giriş/kayıt, şifremi unuttum / şifre sıfırlama, DICOM sürükle-bırak + tarayıcı viewer (W/L, dilim, zoom/pan, mesafe/açı/ROI, röntgende **VHS kalp ölçümü**), işleme ekranı, vaka listesi/detay, uzman inceleme, onaylı rapor (print → PDF), RAG bilgi tabanı, sistem durumu, rol gate |
| **Hasta kaydı ve önceki tetkikler (#108)** | Kliniğe ait hasta kaydı (mikroçip / klinik no opsiyonel), yeni vakada kayıtlı hasta seçimi ve DICOM `PatientID` / isim ile eşleşme önerisi, vaka sayfasında "Önceki tetkikler", yan yana karşılaştırma (senkron dilim/zoom/W-L, ölçüm farkı), raporda "önceki tetkike göre değişim" bölümü — bkz. [§8.7](#87-önceki-tetkiklerle-karşılaştırma) |
| **Sahip için sade dilde özet (#113)** | Onaylı rapordan hayvan sahibinin anlayacağı dilde özet: vaka sayfasında oluştur → düzenle → onayla → PDF. Mock modda tıbbi terim sözlüğüyle deterministik, gerçek modelde LLM. Doz / kesinlik / prognoz ifadeleri engellenir, isimler modele gitmez, "tanı değildir" notu her zaman eklenir; rapor revize olunca özet "güncel değil" olur |
| **Backend API** | Case / Job / Findings / Report / Review / DICOM / Documents / Auth / RAG / Health |
| **Quarantine** | Yerel disk `backend/data/quarantine/{ingest_id}/` + SHA256 + `manifest.json`; path sanitization |
| **DICOM** | Metadata parse (pydicom), Study→Series→Instance, sınıflandırma önerisi + onay; demo fixture: Brain MRI, Cervical MRI, Brain CT, Thorax XR |
| **Doküman** | PDF / JPG / PNG / text sniff → quarantine → metin çıkarma → multimodal VLM stub |
| **AI pipeline** | Router → mock Vision (MRI/CT/XR/VLM) → fusion → LLM (mock veya **gerçek model**: Ollama / OpenAI-uyumlu / Claude) + RAG → validator |
| **LLM katmanı** | Gerçek model bağlantısı, atıflı Türkçe rapor (`[F1]`/`[S1]`), iki adımlı üretim + onarım, yapılandırılmış ayırıcı tanılar, KVKK maskeleme, prompt-injection temizleme, atıf doğrulama + hakem (GREEN tarzı), uzman revizyonuyla yeniden yazma, uzman geri bildirim veri seti, değerlendirme aracı, Model Performansı sayfası — bkz. [§4.4](#44-gerçek-yapay-zekâ-modeliyle-çalıştırma-llm), [§8.3](#83-llm-katmanı) |
| **Async analyze** | Thread (varsayılan) veya RQ+Redis; job poll, timeout alanları, cooperative cancel |
| **Rapor yaşam döngüsü** | Append-only versiyonlama, onayda immutable snapshot, reject / revision-after-approve, `?version=N` |
| **RAG** | bge-m3 anlamsal embedding (varsayılan, Ollama; yoksa hash'e düşer) veya lexical; vektörler PostgreSQL'de (pgvector); kaynak kartları + bölge/tür filtresi; `rag_citations` UI — bkz. [§8.4](#84-rag) |
| **Auth** | Sunucu tarafı hesaplar (scrypt hash'li şifre), kayıt (veteriner, admin onayıyla), 15 dk JWT + dönen refresh token, çıkış, şifre değiştirme / sıfırlama, deneme sınırı (429), RBAC + klinik izolasyonu; auth varsayılan kapalı, protected deployment mode — bkz. [§10](#10-auth-rbac-ve-güvenlik) |
| **Kalıcılık** | Tek PostgreSQL veritabanı (#102): vakalar, kullanıcılar, bildirimler, mesajlar, token'lar, audit, geri bildirim, dersler; SQLite yalnızca yerel geliştirme, memory testler |
| **Gerçek görüntü modeli (röntgen)** | Göğüs/toraks röntgeni için hazır eğitilmiş DenseNet121 (TorchXRayVision, insan verisi) + MONAI ön işleme; 9 bulgu kodu — **demo amaçlı, veterinerde doğrulanmadı** — bkz. [§4.5](#45-gerçek-görüntü-modeliyle-çalıştırma-röntgen) |
| **Remote Vision** | `HttpRemoteVisionModel` + `scripts/mock_vision_server.py` iskeleti |
| **Provenance** | `source_kind` ∈ {mock, real, mixed}; UI’da DEMO/MOCK / REAL/MIXED banner’ları |
| **E2E** | Playwright tam klinik akış + negatif senaryolar; pytest Phase 6 journey suite |
| **Audit** | Append-only security audit (veritabanında `audit_events`; JSONL yedek mod). Admin → **Güvenlik / Audit** ekranı: filtre, şüpheli durumlar, CSV (#106) |

### Bilinçli olarak yok / ertelenmiş

| Yok | Açıklama |
|-----|----------|
| Eğitilmiş klinik Vision / VLM | Varsayılan: fixture mock; piksel analizi yok (`metadata_only`). `VETMIND_VLM_ENABLED` ile genel amaçlı bir VLM (ör. Gemini) görüntüleri yorumlayabilir ama veterinerde eğitilmiş/valide değildir. Röntgen için insan verisiyle eğitilmiş demo modeli takılabilir (§4.5); MR / BT için eğitilmiş model yok. Eğitim/değerlendirme altyapısı `ml/` ve `evaluation/` altında hazır, etiketli veteriner verisi bekleniyor |
| Ücretli / üretim LLM | Varsayılan `MockLLMProvider` |
| PACS / DICOMweb | Yok |
| OCR | Doküman metin stub |
| Klinik onaylı bilgi bankası | Anlamsal arama (bge-m3 + pgvector) var; kaynaklar derlenmiş seed metinler, klinik onaylı değil |
| OAuth / SSO | Yok — e-posta + şifre ile sunucu hesapları (tarayıcıda hesap saklanmaz). Kayıtta e-posta doğrulaması var (#41) |
| Celery / K8s workers | Thread veya RQ |
| Encryption-at-rest / malware AV | Env bayrakları var; gerçek entegrasyon yok |
| Klinik validasyon | Validator `clinically_validated=True` engeller |
| Ödeme / faturalama | Gerçek tahsilat yok. Eski sahip portalının demo ödeme akışı kaldırıldı (#132); `demo_payments` tablosu eski veriler için duruyor — [arşiv belgesi](docs/arsiv/DEMO_PAYMENT_SUBMISSION_FLOW.md) |

Frontend rol kapıları **yalnızca UX**’tir. Gerçek veya korumalı veri için backend auth zorunludur.

---

## 3. Geliştirme fazları

Bu raporlar tarihseldir (`docs/arsiv/`); güncel durum için kod ve bu README esastır.

| Faz | Belge | Konu | Sonuç |
|-----|-------|------|--------|
| 1–2 | [PHASE_1_1_AND_2.md](docs/arsiv/PHASE_1_1_AND_2.md) | DICOM ingest, quarantine, sınıflandırma, vaka yönetimi | Stabil |
| 3 | [PHASE_3_AI_READINESS.md](docs/arsiv/PHASE_3_AI_READINESS.md) | ImagingModelInput, execution policy, job cancel/timeout, LLM DTO | Adapter sözleşmeleri hazır; mock default |
| 4 | [PHASE_4_REPORT_LIFECYCLE.md](docs/arsiv/PHASE_4_REPORT_LIFECYCLE.md) | Rapor versiyonlama, uzman inceleme sertleştirme, print-to-PDF | Immutable onaylı sürümler |
| 5 | [PHASE_5_SECURITY_PERFORMANCE.md](docs/arsiv/PHASE_5_SECURITY_PERFORMANCE.md) | Auth/tenant, quarantine integrity, audit, retention hooks, concurrency | Protected mode kapıları |
| 6 | [PHASE_6_END_TO_END_READINESS.md](docs/arsiv/PHASE_6_END_TO_END_READINESS.md) | Sentetik E2E + release readiness | Demo **GO** · klinik **NO-GO** |
| 6.1 | [PHASE_6_1_FULL_WORKFLOW_E2E.md](docs/arsiv/PHASE_6_1_FULL_WORKFLOW_E2E.md) | Browser tam klinik workflow | Playwright yeşil |

---

## 4. Hızlı başlangıç

### 4.0 Docker ile tek komut (önerilen deneme yolu)

**Gereksinim:** Docker Desktop (veya Docker Engine + Compose v2). Node/Python kurmak gerekmez.

```bash
docker compose up --build
```

- Arayüz: **http://localhost:8080** · demo giriş `vet@demo.local` / `demo1234` (diğer hesaplar §5)
- İki servis: `backend` (FastAPI, Python 3.12) ve `web` (nginx: derlenmiş arayüz + `/api` → backend proxy)
- Üç servis: `db` (PostgreSQL 16 + pgvector: bütün kayıtlar ve RAG vektörleri), `backend`, `web`. İsteğe bağlı ChromaDB yalnızca `--profile chroma` ile açılır. SQLite dosyası oluşmaz; DICOM dosyaları `vetmind_data` volume'unda kalır. `docker compose down` veriyi korur, `docker compose down -v` hepsini siler
- Ayarlar: compose dosyasının yanına `.env` koyup `VETMIND_*` değişkenlerini yazın (bkz. `backend/.env.example`). Port: `VETMIND_WEB_PORT` (varsayılan 8080)
- Bilgi bankası araması varsayılan olarak **bge-m3** (anlamsal) kullanır: bilgisayarda Ollama çalışıyor ve `ollama pull bge-m3` yapılmışsa backend ona `host.docker.internal` üzerinden bağlanır. Ollama yoksa sistem hata vermeden kelime benzerliğiyle (hash) açılır; Admin → **Sistem Durumu** hangisinin çalıştığını ve uyarıyı gösterir
- Varsayılanlar demo modudur: auth kapalı, mock LLM. Gerçek LLM için `VETMIND_LLM_PROVIDER` ve ilgili ayarlar (§4.4) `.env`'e eklenir. Ollama bilgisayarda çalışıyorsa `VETMIND_LLM_ENDPOINT=http://host.docker.internal:11434/v1`
- Eski SQLite verisi varsa: `docker compose exec backend python scripts/migrate_sqlite_to_postgres.py --data-dir <eski data klasörü>` (bkz. §6 Kalıcılık)
- Opsiyonel Redis (RQ işleri): `backend/docker-compose.yml`

Geliştirme yaparken (hot reload) aşağıdaki yerel kurulum kullanılır.

**Gereksinimler:** Node.js 18+ · Python 3.11+

### 4.1 Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Windows (PowerShell):** Python 3.12 önerilir (3.13+ sürümlerinde bazı paketlerin hazır sürümü olmayabilir).

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1      # "running scripts is disabled" hatası: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Anlamsal arama (önerilen, ~1.2 GB):** [Ollama](https://ollama.com) kurup bir kez `ollama pull bge-m3` çalıştırın. Backend açılışta bge-m3'e bağlanır; Ollama kapalıysa veya model yoksa uyarı verip hash embedding ile devam eder (`VETMIND_RAG_EMBEDDING=hash` ile kapatılır).

Kurulumdan sonra backend her işletim sisteminde repo kökünden `npm run backend:dev` ile de başlatılabilir
(`scripts/backend.mjs`, `.venv`'deki Python'u bulur). Kod değiştiği halde backend eski gibi davranıyorsa
otomatik yeniden yükleme takılmış olabilir: `Ctrl+C` ile durdurup yeniden başlatın.

### 4.2 Frontend (ayrı terminal, repo kökü)

```bash
npm install
npm run dev
```

| Servis | URL |
|--------|-----|
| UI | http://localhost:5173 |
| OpenAPI | http://127.0.0.1:8000/docs |
| Health | http://127.0.0.1:8000/api/v1/health |

Vite `/api` → `http://127.0.0.1:8000` (`vite.config.ts`).  
Kalıcılık varsayılanı PostgreSQL'dir (#102). Yerelde en kolay yol repo kökünden yalnızca veritabanını açmak:

```bash
docker compose up -d db        # localhost:5432, kullanıcı/şifre vetmind/vetmind
npm run backend:dev            # şema ilk açılışta migration'larla kurulur
```

Docker yoksa `VETMIND_STORAGE=sqlite` ile aynı tablolar tek dosyada (`backend/data/vetmind.sqlite3`) tutulur.

### 4.3 npm script’leri

| Script | Ne yapar |
|--------|----------|
| `npm run dev` | Vite UI (`--open`) |
| `npm run build` | `tsc` + üretim build |
| `npm run check:bundle` | `build` sonrası ilk yükleme JS bütçesi (gzip ≤ 160 KB, grafik parçası ilk açılışta yüklenemez). Henüz CI'da değil |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run backend:dev` | uvicorn (`.venv`), sahte (mock) LLM |
| `npm run backend:dev:ai` | uvicorn + **gerçek model**: Ollama `qwen2.5:7b`, prompt v5, hakem açık (§4.4) |
| `npm run backend:dev:vision` | `backend:dev:ai` + **gerçek röntgen modeli** (§4.5) |
| `npm run backend:test` | pytest |
| `npm run e2e` | Playwright (sistem Chrome; browser indirmez; Windows'ta da çalışır) |
| `npm run e2e:ui` | Playwright UI mode |
| `npm run build:share` | Paylaşım build (`dist-share`) |

### 4.4 Gerçek yapay zekâ modeliyle çalıştırma (LLM)

Varsayılan kurulum raporları **şablon (mock)** ile yazar. Gerçek bir dil modeliyle rapor yazdırmak için
bilgisayarda ücretsiz çalışan **Ollama** kullanılır; internet ya da API anahtarı gerekmez, hasta verisi
bilgisayardan çıkmaz.

**Gereksinimler:** §4'tekilere ek olarak [Ollama](https://ollama.com) · en az **16 GB RAM** önerilir
(8 GB'ta çalışır ama yavaştır) · ~5 GB boş disk.

**İlk kurulum (bir kez):**

```bash
# 1) Modeli indir (~4,7 GB)
ollama pull qwen2.5:7b

# 2) Backend bağımlılıkları (henüz kurulmadıysa)
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cd ..

# 3) Frontend bağımlılıkları
npm install
```

**Her çalıştırmada — iki terminal:**

| Terminal | Komut | Ne yapar |
|----------|-------|----------|
| 1 | `npm run backend:dev:ai` | API (8000) — gerçek modelle. **Kapatmayın.** |
| 2 | `npm run dev` | Arayüz (5173) — tarayıcı otomatik açılır |

Uygulamayı **http://localhost:5173** adresinden kullanın. `http://127.0.0.1:8000` bir web sayfası değildir;
tarayıcıda açınca `404 Not Found` görmeniz normaldir.

**Windows:** `npm run backend:dev:ai` Windows'ta da çalışır. Ayarları değiştirmek isterseniz (ör. hakemi
açmak) PowerShell'de elle:

```powershell
cd backend
$env:VETMIND_LLM_PROVIDER="ollama"; $env:VETMIND_LLM_MODEL_ID="qwen2.5:7b"; $env:VETMIND_LLM_TIMEOUT_S="180"; $env:VETMIND_LLM_VERIFY="true"
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

**Ne kadar sürer:** Bir rapor dizüstü bilgisayarda **~1 dakika** (taslak → gerekirse onarım → ayırıcı tanılar
→ hakem denetimi). İşleme ekranının beklemesi normaldir; arayüz 5 dakikaya kadar bekler.

**Sorun giderme:**

| Belirti | Neden / çözüm |
|---------|---------------|
| `Error: connect ECONNREFUSED 127.0.0.1:8000` | Arayüz, API'den önce açıldı ya da API kapalı. Önce Terminal 1'i başlatın. |
| Tarayıcıda `127.0.0.1:8000` → `404 Not Found` | Normal; arayüz 5173'te. |
| Analiz "LLM hatası" ile başarısız | Model indirilmemiş (`ollama list` ile bakın) ya da Ollama kapalı. Sahte rapora düşülmez; bilinçli. |
| "timed out" | Eski bir sürüm (15 sn bekliyordu). `git pull` yapın; şimdi 5 dk bekler. |
| Onayla / Reddet düğmeleri görünmüyor (beyaz) | Uzun süredir açık eski `npm run dev`; `Ctrl+C` ile kapatıp yeniden başlatın. |
| Çok yavaş | RAM yetersiz ya da başka model de yüklü. `ollama ps` ile bakın; hakemi kapatmak için `VETMIND_LLM_VERIFY=false`. |

Modelsiz çalışmak (arkadaşınızda Ollama yoksa) için eskisi gibi `npm run backend:dev`.

#### DICOM sınıflandırıcıda yapay zekâ (isteğe bağlı)

Yüklenen çalışmanın bölgesini ve hayvan türünü önce **kurallar** (Türkçe + İngilizce anahtar kelimeler)
belirler. `VETMIND_CLASSIFIER_LLM=1` ile dil modeli yalnızca boşlukları doldurur: kuralların hiç bölge izi
bulamadığı açıklamalar (ör. "HIPOFIZ MR") ve ırk adından tür ("Golden Retriever" → köpek). Kuralların
bulduğu bölgeyi değiştirmez; farklı düşünürse vaka "çelişkili" işaretlenir. Modalite her zaman DICOM
etiketinden gelir. Modele hasta adı, kimlik ve tarih gönderilmez. Model kapalıysa kurallarla devam edilir.

Rapor modeliyle aynı model (`qwen2.5:7b`) kullanılır; ek indirme gerekmez. Daha küçük `qwen2.5:3b`
denendi ama sözlük dışı terimlerde (hipofiz, serebellum, trakea…) hiç bölge bulamadı, bu yüzden önerilmez
(gerekirse `VETMIND_CLASSIFIER_LLM_MODEL_ID` ile ayrı model seçilebilir).

macOS / Linux — `backend:dev:ai` ortamına ek olarak:

```bash
cd backend && VETMIND_LLM_PROVIDER=ollama VETMIND_LLM_MODEL_ID=qwen2.5:7b VETMIND_CLASSIFIER_LLM=1 \
  .venv/bin/uvicorn app.main:app --reload --port 8000
```

Windows (PowerShell):

```powershell
cd backend
$env:VETMIND_LLM_PROVIDER="ollama"; $env:VETMIND_LLM_MODEL_ID="qwen2.5:7b"; $env:VETMIND_CLASSIFIER_LLM="1"
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

**Ölçüm** (24 Türkçe/zor sentetik vaka, `eval/classification_eval_set_tr.json`; ekip tarafından yazıldı,
klinik validasyon değildir):

| | Bölge | Tür | Süre / vaka |
|---|---|---|---|
| Kurallar + Türkçe sözlük | %87,5 | %66,7 | ~0 |
| + `qwen2.5:3b` | %87,5 | %100 | ~2,8 sn |
| + `qwen2.5:7b` | **%95,8** | **%100** | ~3,2 sn |

Sözlük öncesi kurallar ilk 19 vakada bölgede yalnızca %36,8 doğruydu; Türkçe anahtar kelimeler bunun
çoğunu kapattı. Modelin katkısı sözlük dışı terimlerde (bölge) ve ırk adlarında (tür). Modelin kuralların
bulduğu bölgeyi değiştirmesine izin verilen ara denemede bölge doğruluğu düştü (`kafa` → boyun
karışıklığı), bu yüzden model yalnızca boşluk doldurur. Kendi ölçümünüz için:

```bash
cd backend && VETMIND_LLM_PROVIDER=ollama .venv/bin/python scripts/classification_eval.py \
  --set eval/classification_eval_set_tr.json --models qwen2.5:7b,qwen2.5:3b
```

Windows'ta ilk istek ekran kartı hazırlanırken 15–70 sn sürebilir; zaman aşımı olursa sınıflandırma o
yükleme için kurallarla devam eder (`VETMIND_CLASSIFIER_LLM_TIMEOUT_S` ile süre artırılabilir).

### 4.5 Gerçek görüntü modeliyle çalıştırma (röntgen)

Varsayılan kurulumda görüntü analizi **sahte (mock)** çalışır. Göğüs/toraks röntgenini gerçek bir yapay
zekâ modeliyle analiz ettirmek için aşağıdakileri **bir kez** yapın. Yapmazsanız uygulama eskisi gibi mock
ile çalışmaya devam eder; hiçbir şey bozulmaz.

> ⚠️ Bu model **insan** göğüs röntgenleriyle eğitildi (TorchXRayVision, DenseNet121). Köpek/kedi
> görüntülerinde ne kadar doğru olduğu **bilinmiyor**. Sistem bunu her raporda uyarı olarak yazar ve
> modeli `clinically_validated=false` olarak işaretler. Demo ve başlangıç noktasıdır, teşhis aracı değildir.

**Gereksinimler:** §4.4'tekiler (Ollama + `qwen2.5:7b`) · ~2 GB ek disk (PyTorch + MONAI).

**İlk kurulum (bir kez, repo kökünden):**

```bash
# 1) Görüntü kütüphanelerini kur (PyTorch, MONAI, TorchXRayVision — ~1–2 GB, birkaç dakika)
cd backend && .venv/bin/pip install -r requirements-vision.txt

# 2) Model dosyasını oluştur (~30 MB indirir; artifacts/vet-xr-thorax-v1/model.pt yazar)
.venv/bin/python scripts/export_xray_model.py
cd ..
```

Model dosyası **Git'e girmez** (`artifacts/` yok sayılır); her bilgisayarda 2. adımla oluşturulur.

**Her çalıştırmada — iki terminal:**

| Terminal | Komut | Ne yapar |
|----------|-------|----------|
| 1 | `npm run backend:dev:vision` | API (8000) — gerçek LLM **ve** gerçek röntgen modeli. **Kapatmayın.** |
| 2 | `npm run dev` | Arayüz (5173) |

**Nasıl denenir:** Veteriner olarak Yeni Vaka → tetkik yükleme adımından bir **göğüs röntgeni** (DX/CR, bölge THORAX)
yükleyin, tür seçin, onay kutularını işaretleyip analizi başlatın. Röntgen analizi 1–2 saniye sürer; ardından
rapor qwen ile yazılır (birkaç dakika). Bulgular "gerçek model" (`source_kind=real`) olarak görünür.

**Model hangi bulguları verir:** kalp büyümesi (`CARDIOMEGALY_SUSPECTED`), plevral sıvı
(`PLEURAL_EFFUSION_SUSPECTED`), akciğer opasitesi (`PULMONARY_OPACITY`), pnömotoraks, konsolidasyon,
ödem, nodül, toraks kitlesi, kırık. Eşik 0,5; altında kalan bulgu rapora girmez (bu "normal" anlamına gelmez).

**Sınırlar:** Sadece **röntgen + toraks** gerçek modele gider. MR ve BT yüklemeleri hâlâ mock ile çalışır
(bu modaliteler için eğitilmiş model takılmadı). Model kutu çizmez, sadece bulgu sınıflandırır.

**İsteğe bağlı — dosya sabitleme:** `export_xray_model.py` çıktısında bir `sha256:` değeri yazar.
`VETMIND_LOCAL_TORCH_WEIGHTS_SHA256=<değer>` verirseniz, dosya değişirse sistem modeli yüklemeyi reddeder.

**Windows:** `npm run backend:dev:vision` Windows'ta da çalışır. PowerShell'de elle başlatmak için:

```powershell
cd backend
$env:VETMIND_LLM_PROVIDER="ollama"; $env:VETMIND_LLM_MODEL_ID="qwen2.5:7b"; $env:VETMIND_LLM_TIMEOUT_S="600"; $env:VETMIND_LLM_VERIFY="false"
$env:VETMIND_PIXEL_ANALYSIS_OPT_IN="true"; $env:VETMIND_LOCAL_TORCH_MODEL_ID="vet-xr-thorax-v1"
$env:VETMIND_LOCAL_TORCH_ENTRYPOINT="app.models.entrypoints.xray_monai:build_entrypoint"
$env:VETMIND_LOCAL_TORCH_WEIGHTS_PATH="../artifacts/vet-xr-thorax-v1/model.pt"
$env:VETMIND_LOCAL_TORCH_MODALITIES="XR"; $env:VETMIND_LOCAL_TORCH_REGIONS="THORAX"; $env:VETMIND_LOCAL_TORCH_MODEL_VERSION="0.1.0-txrv-human"
.venv\Scripts\uvicorn app.main:app --reload --reload-dir app --port 8000
```

**Sorun giderme:**

| Belirti | Neden / çözüm |
|---------|---------------|
| Röntgen bulguları hâlâ "mock / demo" | (a) Backend `backend:dev:vision` ile değil, `backend:dev` / `backend:dev:ai` ile açık — kapatıp doğru komutla başlatın. (b) Model dosyası yok (2. adım yapılmamış) — sistem bu durumda hata vermez, mock'a geçer; `ls artifacts/vet-xr-thorax-v1/model.pt` ile bakın. |
| Analiz "PyTorch unavailable" / "MONAI unavailable" ile başarısız | 1. adım yapılmamış: `requirements-vision.txt` kurun. |
| "does not match the pinned SHA-256" | Model dosyası yeniden oluşturulmuş; yeni `sha256:` değerini verin ya da sabitlemeyi kaldırın. |
| Rapor yazılırken tarayıcı takılıyor | qwen ekran kartını %100 kullanıyor. Birkaç dakika bekleyin; sayfayı kapatsanız da analiz arkada sürer. |
| İki backend aynı anda (ör. 8000 mock, 8001 vision) | Arayüzü `VETMIND_API_PROXY=http://127.0.0.1:8001 npx vite --port 5175` ile ikinci backend'e bağlayın. |

---

## 5. Demo akışı

### Hesaplar

Şifre hepsi: `demo1234`

| E-posta | Rol | Tipik kullanım |
|---------|-----|----------------|
| `vet@demo.local` | Veteriner hekim | DICOM yükle, vaka oluştur, analiz başlat |
| `expert@demo.local` | Uzman Veteriner Radyolog (VRM) | İnceleme / onay / red / revizyon |
| `clinic-owner@demo.local` | Klinik sahibi | Klinik vakaları ve raporlar |
| `admin@demo.local` | Admin | Kullanıcılar, bilgi tabanı, sistem durumu |

Admin → **Kullanıcılar** sayfasında oluşturulan hesaplar da giriş ekranından giriş yapabilir.

VetMind AI B2B bir platformdur: hayvan sahipleri sistem kullanıcısı değildir, hesap açamaz ve
e-posta almaz. Vakayı veteriner doğrudan açar; sahip adı isteğe bağlıdır. Rapor onaylanınca
vakayı gönderen veterinere bilgilendirme e-postası gider (`VETMIND_SMTP_HOST` ayarlıysa).

### Örnek vakalar

Demo için yedi hazır vaka backend'e **gerçek vaka olarak** yüklenebilir (sentetik DICOM; görüntüleyici,
atama, onay ve rapor uçtan uca çalışır):

| Hasta | Görüntü | Durum |
|-------|---------|-------|
| Duman (kedi), 4 ay önce | Beyin MR | Onaylandı (önceki tetkik, #108) |
| Duman (kedi) | Beyin MR | Onaylandı |
| Zeytin (köpek) | Toraks röntgeni | Onaylandı |
| Tarçın (köpek) | Servikal MR | Revizyon istendi |
| Paşa (köpek) | Servikal MR | Uzmana atandı, acil |
| Karamel (köpek) | Beyin BT | İnceleme bekliyor |
| Pamuk (kedi) | Beyin MR | Taslak |

```bash
cd backend
python scripts/seed_demo.py           # örnekleri yükle
python scripts/seed_demo.py --reset   # sil ve yeniden yükle (demo öncesi temiz başlangıç)
python scripts/seed_demo.py --remove  # yalnızca örnekleri sil
```

Windows'ta `python` yerine `.\.venv\Scripts\python.exe`. Otomatik yükleme için backend'i
`VETMIND_DEMO_SEED=1` ile başlatın; yalnızca **hiç vaka yokken** çalışır.

Örnek vakalar `demo_seed` ile işaretlidir: `--remove` gerçek vakalara dokunmaz; vakayla birlikte analiz
işlerini, DICOM kayıtlarını, karantina dosyalarını, bildirimleri ve vakaya bağlı mesajları siler. Örneklerin
onayları uzman geri bildirim veri setine ve Model Performansı sayfasına **girmez**. Gerçek veriye geçerken
yeni ve boş bir veritabanıyla başlamak en temizidir.

### Önerilen senaryo (5–10 dk)

1. `vet@demo.local` ile giriş → **Yeni Vaka** (`/vakalar/yeni`).  
2. Tetkik yükleme adımında `.dcm` dosyalarını sürükle (demo build'inde hazır Brain MRI / CT / Thorax XR örnekleri de var).  
3. Viewer’da dilim gez (`Im: n/m`); W/L / zoom / pan isteğe bağlı.  
4. Metadata sınıflandırma önizlemesini onayla → **Demo analize devam et**.  
5. İşleme ekranında `DEMO / MOCK ANALYSIS` ve job alanlarını gör.  
6. **Vakalar → Backend’den yenile** (PostgreSQL kalıcılık; restart sonrası da kalır).  
7. Vaka detay → **Bulgular** → mock / SYNTHETIC provenance.  
8. Üst barda rolü **Uzman Veteriner Radyolog** yap → **Çalışma alanı** (`/calisma`) → **Onayla**.  
9. Vaka geçmişinde sürüm / immutable; **Raporlar** → onaylı rapor; **PDF olarak indir**.  
10. İsteğe bağlı: Admin → **Bilgi Tabanı** (RAG search), **Sistem Durumu** (`/health`).

### Gerçek LLM ile önerilen senaryo (§4.4 kurulumundan sonra)

1. `vet@demo.local` → yeni vaka / DICOM demo → analizi başlat (~1 dk).
2. Vaka detay → **AI Ön Değerlendirme**: Türkçe rapor, `F1` / `S2` atıf rozetleri (tıklayınca kaynak pasajı vurgulanır),
   **Olası Ayırıcı Tanılar** (Yüksek / Orta / Düşük olasılık + atıflar), **Doğrulama katmanı** kartı.
3. Rol **Uzman** → **Çalışma alanı** → **Revizyon** → gerekçe kodu + gerekçe yaz
   (ör. "Ayırıcı tanıya histiyositik sarkomu ekle") → **Yapay zekâ ile yeniden yaz** → ~1 dk sonra yeni sürüm (v2);
   eski sürüm **Rapor geçmişi**'nde.
4. **Onayla** → onaylı rapor / PDF.
5. Rol **Admin** → **Model Performansı**: onay oranı, düzeltmesiz onay, en çok düzeltilen bölüm, son değerlendirme tablosu.

Alternatif: **Yeni Vaka** ile sentetik senaryolar (`ct_brain_suspected`, `xr_thorax_suspected`, `document_context`, …) veya eski yerel prototip pipeline.

---

## 6. Sistem mimarisi

```text
┌──────────────────────────────┐
│  React UI (Vite :5173)       │  Landing, Login, DICOM, Processing,
│  AppContext + backend.ts     │  CaseDetail, ExpertReview, RAG KB
└──────────────┬───────────────┘
               │  /api → proxy
               ▼
┌──────────────────────────────┐
│  FastAPI (:8000) /api/v1/*   │  İnce HTTP router’lar
│  Auth (opsiyonel JWT+API key)│
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  AppContainer (DI root)      │  settings → repo, quarantine,
│  backend/app/container.py    │  router, models, LLM, RAG, jobs
└──────────────┬───────────────┘
               │
     ┌─────────┼─────────┬────────────────┐
     ▼         ▼         ▼                ▼
 Quarantine  CaseRepo  JobBackend    AIOrchestrator
   disk     mem/sqlite  thread|RQ     ↓
            /postgres              Router → Vision → Fusion
                                   → LLM+RAG → Validator
```

### Backend paketleri

| Paket | Amaç |
|-------|------|
| `api/` | HTTP: auth, cases, analysis, reports, dicom, documents, rag; `deps.py` |
| `auth/` | JWT / API key, `require_auth` / `require_capability`, RBAC |
| `services/` | `CaseService`, `DicomService`, `DocumentService`; repository Protocol + `SqlCaseRepository` (`storage/sql.py` üzerinden Postgres/SQLite) |
| `storage/` | `QuarantineStore` |
| `dicom/` | ingest, parser, validator, classifier, fixtures |
| `ingest/` | dosya türü sniff, doküman metin çıkarma |
| `imaging/` | metadata-only preparation pipeline (Phase 3) |
| `routing/` | capabilities, `ModelRouter`, scenario + execution policy |
| `models/` | `ImagingModel` protokolü, mock registry, VLM, yerel torch, HTTP remote, normalizer, pixel authz |
| `orchestration/` | `AIOrchestrator.run()` |
| `llm/` | gateway + mock / stub / HTTP / OpenAI-uyumlu (Ollama, Gemini …) / Anthropic sağlayıcıları, hakem, KVKK maskeleme |
| `rag/` | corpus, lexical, bge-m3 / hash embedding, pgvector (JSON ve ChromaDB seçenek), kaynak kartları, chunking |
| `validation/` | yapısal report validator |
| `workers/` | Thread / RQ job backend |
| `security/` | audit logger, retention hooks |
| `schemas/` | Pydantic DTO’lar ve enum’lar |

### Kalıcılık

| Backend | Env | Not |
|---------|-----|-----|
| **postgres (varsayılan)** | `VETMIND_STORAGE=postgres` | Bütün kayıtlar tek veritabanında (JSONB belgeler); `VETMIND_DATABASE_URL` (varsayılan `postgresql://vetmind:vetmind@localhost:5432/vetmind`) |
| sqlite | `sqlite` | Docker'sız yerel geliştirme: aynı tablolar tek dosyada (`backend/data/vetmind.sqlite3`) |
| memory | `memory` | Testler |

Tek veritabanında (#102): vakalar, işler, DICOM/doküman kayıtları, kullanıcılar, hayvanlar ve talepler, kullanıcı ayarları, bildirimler, mesajlar, demo ödemeleri, radyolog ödemeleri, rapor bağlantıları, oturum ve şifre sıfırlama token'ları (yalnızca hash), denetim kaydı (audit), uzman geri bildirimi ve AI dersleri. Ayrı SQLite/JSONL dosyası yok. Şema `backend/migrations/` altındaki Alembic migration'larıyla kurulur; uygulama açılırken `alembic upgrade head` kendisi çalışır (elle: `cd backend && alembic upgrade head`, yeni değişiklik: `alembic revision -m "..."`). DICOM dosyaları `data/quarantine/` altında, RAG vektörleri ChromaDB'de kalır.

**Eski veriyi taşıma:** `python scripts/migrate_sqlite_to_postgres.py` (`backend/` içinden) `data/` altındaki eski `*.sqlite3` dosyalarını (ana dosya + `vetmind_workflow`, `vetmind_auth`, `vetmind_notifications`... yan dosyaları) ve `audit/security.jsonl`, `feedback/feedback.jsonl`, `revision_lessons.json` dosyalarını hedef veritabanına kopyalar; var olan satırlara dokunmaz, iki kez çalıştırmak güvenlidir, kaynak dosyalar değişmez (`--dry-run` ile önce sayar, `--to sqlite:///data/vetmind.sqlite3` ile SQLite'ta kalanlar için yan dosyaları tek dosyada birleştirir). Demo verisiyle denendi: 37 vaka, 51 iş, 85 DICOM kaydı, 17 talep, 7 kullanıcı, 198 oturum token'ı, 36 geri bildirim (509 satır).

**Karar (SQLite kalsın mı?):** testler bellek içi depo kullanır; çalışan sistem için varsayılan ve önerilen PostgreSQL. SQLite yalnızca Docker'sız yerel geliştirme için duruyor; kod aynı SQL'i iki veritabanında da çalıştırdığı için ayrı bakım gerektirmiyor.

Saklanan başlıca varlıklar: `CaseRecord`, `AnalysisJob`, `DicomIngestionRecord`, `DocumentIngestionRecord`, `report_versions[]`.

### Quarantine

- Yerel disk; AV / S3 yok.  
- Kök: `backend/data/quarantine/{ingest_id}/`  
- Manifest + dosya hash’leri ingestion ve case üzerinde tutulur.  
- `ingest_id` doğrulama + path resolve (traversal engeli).

### Jobs

| Backend | Env | Not |
|---------|-----|-----|
| thread | `VETMIND_JOB_BACKEND=thread` | Daemon thread + `VETMIND_ASYNC_DELAY_MS` |
| rq | `rq` | Redis (`VETMIND_REDIS_URL`); `python -m app.workers.rq_worker`; memory storage ile kullanılmaz |

Job alanları (özet): `status`, `outcome`, `cancel_requested`, `idempotency_key`, `timeout_s`, `routed_model_versions`, `analysis_mode`.

**Yeniden başlatma (#118):** thread arka ucunda analiz yalnızca onu başlatan süreçte yaşar. Backend açılırken önceki süreçten kalan `queued` / `running` / `cancel_requested` işler `failed` ("sunucu yeniden başladı") olarak kapatılır; vaka önceki taslağa (varsa "İncelemede") veya "Başarısız"a döner ve tekrar analiz edilebilir. Diskteki eşzamanlı analiz sayacı (`data/analyze_gate.count`) da sıfırlanır. RQ arka ucunda bu adım çalışmaz (işler Redis'te kalır). Thread arka ucuyla aynı veritabanına bağlı birden fazla API süreci çalıştırılmamalıdır.

---

## 7. Uçtan uca veri akışı

Akış diyagramı koddan otomatik üretilir ve elle güncellenmez: **[docs/AI_MIMARISI.md](docs/AI_MIMARISI.md)** (varsayılan kurulum; GitHub Action her `main` push'unda yeniler). Çalışan sistemin canlı hâli — hangi kutu gerçek, hangisi mock, hangi model çalışıyor — admin panelinde **AI Mimarisi** sayfasındadır (`GET /api/v1/admin/architecture`).

Özet: yükleme → karantina → DICOM/doküman okuma → tür/modalite/bölge sınıflandırma → kullanıcı onayı → model girdisi → router → görüntü modeli/VLM → yapılandırılmış bulgular → LLM gateway (+ RAG) → rapor doğrulama → radyolog incelemesi → onaylı rapor.

### Kod yolları

| # | Aşama | Nerede |
|---|--------|--------|
| 1 | Upload | `POST /api/v1/dicom/upload` veya `/demo/{kind}`; doküman: `POST /api/v1/documents/upload` |
| 2 | Quarantine | `storage/quarantine.py` |
| 3 | Parse / sniff | `dicom/parser.py`, `ingest/filetype.py`, `ingest/documents.py` |
| 4 | Classify | `dicom/classifier.py` → `ClassificationSuggestion` |
| 5 | Confirm → Case | `POST .../ingestions/{id}/confirm` → `classification_confirmed=True` |
| 6 | Analyze gate | `CaseService._assert_analyzable()` |
| 7 | Route | `routing/model_router.py` + `scenario_policy.py` + `execution_policy.py` |
| 8 | Vision | `models/mock_vision.py`; opsiyonel `models/http_vision.py` |
| 9 | Fuse | `models/normalizer.py` → `StructuredFindings` |
| 10 | LLM + RAG | `llm/gateway.py` + `rag/*` |
| 11 | Validate | `validation/report_validator.py` → `AWAITING_REVIEW` |
| 12 | Review | `POST /api/v1/cases/{id}/review` → `APPROVED` / reject / revision |

### Analyze modları

- **Sync:** `POST /api/v1/cases/{id}/analyze`  
- **Async:** `POST /api/v1/cases/{id}/analyze/async` → enqueue → `GET /api/v1/jobs/{job_id}` poll  
- **Cancel:** `POST /api/v1/jobs/{id}/cancel` (cooperative)

Unsupported modality/region → `MANUAL_REVIEW`, AI draft üretilmez.  
Adapter failure → onaylanabilir draft yok.  
Frontend poll abort **backend işini iptal etmez**; ayrı cancel gerekir.

### Vaka durumları (özet)

```text
CREATED / AWAITING_CLASSIFICATION_CONFIRMATION
  → classification confirm
  → ANALYZING (job RUNNING)
  → AWAITING_REVIEW  |  MANUAL_REVIEW  |  FAILED / PARTIAL
  → APPROVED  (uzman approve sonrası)
```

Frontend `caseStatusMap.ts` backend durumlarını UI etiketlerine map eder.

---

## 8. AI / Vision / LLM / RAG

### 8.1 Orchestrator

`AIOrchestrator.run(case, job)` sırası:

1. `ensure_model_input` / `build_imaging_model_input`  
2. `ModelRouter.route` → `ScenarioRoutingPolicy` → `ModelExecutionPolicy`  
3. Seçilen adapter’lar için `analyze(case)`  
4. `normalize_outputs` (fusion + conflict hints)  
5. `LLMGateway.generate_draft` (+ RAG) — LLM fail’de **mock fallback yok**  
6. `ReportValidator.validate`  
7. Case / job status güncelleme  

### 8.2 Vision model registry

| `model_id` | Tür | Rol |
|------------|-----|-----|
| `mock-brain-mri-v1` | mock (varsayılan) | Beyin MR |
| `mock-brain-mri-alt-v1` | mock (varsayılan) | Çatışma demosu |
| `mock-cervical-mri-v1` | mock (varsayılan) | Servikal MR |
| `mock-ct-3d-v1` | mock (varsayılan) | Beyin CT |
| `mock-xr-vision-v1` | mock (varsayılan) | Toraks XR |
| `mock-multimodal-vlm-v1` | mock (varsayılan) | Doküman / multimodal stub |
| `manual-review` | — | Desteklenmeyen rota |
| `vlm-vision-v1` | gerçek, opsiyonel | `VETMIND_VLM_ENABLED=1`: genel amaçlı VLM (ör. Gemini) görüntüleri yorumlar; veterinerde valide değil |
| `vet-xr-thorax-v1` (yapılandırılabilir) | gerçek, opsiyonel | `VETMIND_LOCAL_TORCH_*` + `xray_monai` (§4.5): insan verisiyle eğitilmiş DenseNet121; lateral, VD/DV, etiketsiz projeksiyon ve köpek/kedide bulgular `uncertain` + rapora "Sınırlama:" notu |
| CT/MR yerel model (`ct_monai`, `mri_monai`) | tiny sözleşme modeli (mock) | Eğitilmiş model ya da MONAI ağı yok; yapılandırılırsa mock/sentetik görünür ve analize alınmaz |
| `remote-vision-v1` (yapılandırılabilir) | gerçek, opsiyonel | `VETMIND_VISION_ENDPOINT` set ise HTTP |

Mock’lar: `source_kind=MOCK`, `Finding.synthetic=True`.  
Pixel: default-deny. Varsayılan kurulumda hiçbir capability `allows_pixel_analysis=True` değil; `VETMIND_LOCAL_TORCH_*`
ile yerel model tanımlanınca (§4.5, `vet-xr-thorax-v1`) o model piksel alır — yine de `VETMIND_PIXEL_ANALYSIS_OPT_IN=true`,
onaylı sınıflandırma ve vaka bazında görüntü izni + analiz onayı şarttır.

### 8.3 LLM katmanı

Sorumlu: Alperen. Ayrıntı: [docs/LLM_KATMANI.md](docs/LLM_KATMANI.md) · araştırma: [docs/ACIK_KAYNAK_ARASTIRMA.md](docs/ACIK_KAYNAK_ARASTIRMA.md).

**Sağlayıcılar** (`VETMIND_LLM_PROVIDER`):

| Değer | Sınıf | Davranış |
|-------|-------|----------|
| `mock` (varsayılan) | `MockLLMProvider` | Şablon taslak |
| `stub` / `deterministic` | `DeterministicStubLLMProvider` | Test çıktısı |
| `http` | `HttpLLMProvider` | VetMind wire contract (`VETMIND_LLM_ENDPOINT`) |
| `ollama` | `OpenAICompatibleProvider` | **Önerilen:** yerel, ücretsiz (`qwen2.5:7b`) |
| `openai` / `vllm` / `openrouter` / `groq` / `lmstudio` | `OpenAICompatibleProvider` | OpenAI-uyumlu API / sunucu |
| `anthropic` | `AnthropicProvider` | Claude API |

**Bir rapor nasıl üretilir (prompt v5, varsayılan):**

```text
Vaka + bulgular (+ RAG pasajları)
 → KVKK: öyküde hasta/sahip adı, telefon, e-posta, TC, IBAN, klinik → [HASTA] [TELEFON] …
 → talimat-benzeri cümleler ("ignore all previous instructions…") öyküden çıkarılır
 → 1) TASLAK: 4 bölüm (Teknik · Bulgular · Yorum · Öneriler), her iddia [F#] bulgu / [S#] kaynak atıflı
 → 2) ONARIM (gerekirse, 1 kez): boş bölüm, atıfsız cümle, geçersiz atıf → model kendi taslağını düzeltir;
       yalnızca daha az sorunlu ise kullanılır
 → 3) AYIRICI TANILAR: ayrı çağrı; 2–5 tanı, Yüksek/Orta/Düşük (yüzde değil), lehine/aleyhine, atıflı
 → 4) HAKEM (VETMIND_LLM_VERIFY): her atıflı cümle yalnızca gösterdiği kanıtla karşılaştırılır →
       destekleniyor / kısmen / desteklenmiyor / çelişiyor (uydurma bulgu, abartılmış kesinlik, yanlış konum, alakasız kaynak)
 → Doğrulama katmanı (ReportValidator + grounding): uyarılar uzman ekranında Türkçe
```

**Kodla zorlanan kurallar (prompt'a bırakılmaz):** bulgu yoksa ayırıcı tanı listesi atılır · model "Bulgular"ı boş
bırakırsa bölüm bulgulardan `[F#]` atıflı yazılır · "kesin tanı", "ekarte edildi", "hastalık yok", "no disease" vb.
işaretlenir (ama "kesin tanı **için** biyopsi gerekir" gibi temkinli kullanım işaretlenmez) · model hata verirse sahte
rapora düşülmez · `(F1)` → `[F1]`.

**Uzman tarafı:**
- **Yapay zekâ ile yeniden yaz** — `POST /api/v1/cases/{id}/report/regenerate`: uzman gerekçesi (maskelenmiş) + incelenen
  taslak modele gider; görüntü analizi tekrarlanmaz; yeni sürüm oluşur, eskisi geçmişte kalır.
- **Geri bildirim veri seti** — modelin ilk metni (`ai_sections`) onaydan sonra da saklanır;
  `GET /api/v1/llm/feedback` (bölüm bazında düzeltme oranı, model/prompt bazında onay),
  `GET /api/v1/llm/feedback/export?format=chat` (ince ayar için sohbet formatı). Yalnızca admin.
- **Model Performansı** sayfası (`/model-performansi`, admin).

**Gizlilik:** Modele hasta adı, sahip bilgisi, dosya yolu, kimlik bilgisi gitmez; öykü maskelenir. Kural tabanlıdır;
gerçek hasta verisinde yerel model (Ollama / vLLM) tercih edilmeli ve KVKK değerlendirmesi yapılmalıdır.

#### LLM değerlendirmesi

`backend/eval/llm_eval_set.json` — 9 başlangıç vakası (beyin kitlesi, MUO, servikal disk, wobbler, akciğer nodülleri,
kafa travması, **bulgu yok**, **analiz başarısız**, **prompt injection + kişisel veri**).

```bash
cd backend && source .venv/bin/activate
python scripts/llm_demo.py --dry-run                     # modele giden prompt'u gör (model gerekmez)
python scripts/llm_eval.py --provider ollama --models qwen2.5:7b --repeat 3
python scripts/llm_eval.py --provider ollama --models qwen2.5:7b --prompts v4,v5 --repeat 3   # prompt A/B
python scripts/llm_eval.py --provider ollama --models qwen2.5:7b --verify                    # hakemli
```

Sonuçlar `backend/eval/results/` (Markdown + JSON) ve Model Performansı sayfasında. Metrikler: kaynaklı cümle oranı,
bulgu kapsama, beklenen tanı yakalama, zorunlu içerik, aşırı iddia / yasak ifade, geçersiz atıf, boş bölüm, İngilizce
oranı, hakemce desteklenen cümle, süre, çağrı sayısı; `--repeat` ile ortalama ± sapma.
**Bunlar atıf ve güvenlik davranışını ölçer; klinik doğruluk değildir.**

**Şimdiye kadarki sonuçlar (9 vaka × 3 tekrar):**

| Ölçüm | Sonuç |
|-------|-------|
| Prompt (llama3.2:3b) | v2 78,0 · v3 74,2 · **v4 78,9** — v4 boş bölümü 4'ten **0**'a indirdi, ayırıcı tanıları korudu |
| Model (v4, hakem qwen) | llama3.2:3b 77,4 · **qwen2.5:7b 79,6** — qwen tanı yakalamada %21 → **%38**, hakem desteği %55 → **%66** |
| Bulunan ve düzeltilen | gerçek bir prompt-injection başarısı ("no disease is present"), ölçüm aracında temkinli cümleleri aşırı iddia sayan yanlış alarmlar, 15 sn arayüz zaman aşımı |

### 8.4 RAG

| Mod | Env | Mekanizma |
|-----|-----|-----------|
| embedding (varsayılan) | `VETMIND_RAG=embedding` | bge-m3 (Ollama, varsayılan; Ollama yoksa hash n-gram'a düşer) + cosine; vektörler PostgreSQL'de (pgvector), PostgreSQL yoksa `data/rag_index.json` |
| lexical | `lexical` | Token overlap |

Seed: `rag/corpus.py`. Admin: `POST /rag/reindex`, `POST /rag/documents`.  

**Alaka filtresi** (`rag/relevance.py`). Rapor taslağı için yapılan aramada:

- Her kaynağın bölge/tür etiketi var (`regions`/`species`). Vaka yalnızca kendi bölgesine uyan kaynakları görür. Kafatası/sütür/ırk kaynakları yalnızca beyin BT/röntgende gelir. Etiketsiz kaynaklar genel sayılır ve her zaman aday olur.
- **Kaynak kartları** (`rag/source_cards.py`). Klinik bir kaynak yüklediğinde (`POST /rag/documents`, toplu yükleme) bölge ve tür etiketi metinden otomatik çıkarılır; kart kısa bir özet ve etiketin nereden geldiğini (`tag_source`: `rules` / `llm` / `manual` / `none`) de tutar. Arama iki aşamalıdır: önce kartlara göre vakanın kullanabileceği kaynaklar seçilir, sonra bu kaynakların pasajları benzerliğe göre sıralanır.
  - Kurallar başlık, bölüm, anahtar kelime ve metindeki Türkçe/İngilizce terimlere ve omur seviyelerine ("T13-L1", "C6") bakar. Hazır 41 kaynağın elle verilmiş etiketleriyle karşılaştırıldığında bölge 38/41, tür 41/41 doğru; yanlışların hiçbiri kaynağı ilgili vakadan gizlemiyor (fazla etiket veya etiketsiz kalıyor).
  - Etiketlerin bedeli asimetrik: eksik etiket sadece daha az filtre demek, yanlış etiket kaynağı gizler. Bu yüzden tür etiketi yalnızca başlıkta geçiyorsa veya metinde en az iki kez geçip diğer tür hiç geçmiyorsa konur; kafatası etiketi yalnızca kafatası terimleri baskınsa konur.
  - `VETMIND_RAG_CARD_LLM=1` ile kuralların bulamadığı boşluğu dil modeli doldurur (kurallarla çelişirse kural kazanır; hata olursa kurallarla devam eder).
  - Admin, Bilgi Tabanı sayfasındaki Kapsam sütunundan etiketi düzeltebilir (`PUT /rag/documents/{id}/card`); elle verilen etiket korunur. Kartlardan önce yüklenmiş kaynaklar `POST /rag/documents/retag` ile etiketlenir.
- **Parçalama (chunking, #100)** (`rag/chunking.py`). Yüklenen uzun kaynaklar (en fazla 50.000 karakter) paragraf ve cümle sınırlarında ~600-900 karakterlik parçalara bölünür; her parça bir önceki parçanın son cümlesiyle birlikte vektörleşir ama saklanan metne eklenmez. Kart kaynağın tamamından bir kez çıkarılır ve bütün parçalara uygulanır. Aramada aynı kaynaktan en fazla 2 parça gelir; rapordaki bölüm adında "parça 2/5" gibi yazar. Kısa kaynaklar ve hazır kaynaklar tek parça kalır.
- Sorgu Türkçe içerikten oluşur (bölge, şikâyet, bulgu metni). Enum ve bulgu kodları sorguya girmez.
- Hash embedding 2048 boyutlu; Türkçe kök özelliği kullanıyor ve "ve/ile/bir" gibi dolgu kelimeleri atıyor.
- Skor eşiğinin altında kalan kaynaklar atılır. İlgili kaynak yoksa model kaynaksız yazar.

Ölçüm: `python scripts/rag_eval.py` (`eval/rag_relevance_set.json`, 18 sentetik vaka). Toraks için 6 yeni kaynak eklendi (kb-11–kb-16).

| | İsabetlilik | İsabet | Kapsam | Boş vakada kaynaksız | Vaka başı alakasız |
|---|---:|---:|---:|---:|---:|
| Önce | 0.14 | 0.62 | 0.30 | 0.00 | 3.44 |
| Sonra | 0.68 | 1.00 | 0.55 | 1.00 | 0.50 |

**Vektör deposu: PostgreSQL + pgvector (#117).** Vektörler uygulamanın kendi PostgreSQL veritabanında, `rag_chunks` tablosunda durur (migration `0006`); ayrı bir vektör servisi yoktur. Vektörleri veritabanı değil bizim kodumuz üretir (hash veya bge-m3); veritabanı yalnızca saklar ve arar (`app/rag/pgvector_store.py`). Kaynak kartı (bölge, tür, özet, `tag_source`) ve parça bilgisi aynı satırdadır; bölge/tür filtresi düz SQL `WHERE` ile uygulanır, sıralama pgvector'ün kosinüs mesafesiyle (`<=>`), skor bizim vektörümüzden yeniden hesaplanır. Bir kaynağın parçaları ve kartı tek işlemde (transaction) yazılır; yedek, saklama süresi ve silme kuralları diğer kayıtlarla aynı veritabanında. Embedding boyutu sabit değil (hash 2048, bge-m3 1024; HNSW dizini 2000 boyutla sınırlı), bu yüzden arama tam taramadır; bizim ölçekte (yüzlerce / birkaç bin parça) milisaniyeler sürer. Kaynak başına en fazla 2 parça kuralı ve skor eşikleri değişmedi.

- **Seçim:** `VETMIND_RAG_STORE=auto` (varsayılan) PostgreSQL varsa pgvector, yoksa (SQLite ile yerel geliştirme) tek JSON dosyası (`data/rag_index.json`). Testler bellek içi depoyu kullanır.
- **ChromaDB (#103) isteğe bağlı:** `pip install -r requirements-chroma.txt` ve `VETMIND_RAG_STORE=chroma` (Docker: `--profile chroma`, `.env`'de `VETMIND_WITH_CHROMA=1`). chromadb ana bağımlılıklarda değil; bilinen açıkları için bkz. #112.
- **Taşıma:** Tablo boşsa ilk açılışta `data/rag_index.json` (klinik kaynakları dahil) otomatik kopyalanır; dosyaya dokunulmaz. Chroma'daki içerik için: `python scripts/rag_migrate_to_pgvector.py --from-chroma data/chroma` veya `--from-chroma-url ...` (`--replace` ile yeniden).
- **Ölçüm:** `VETMIND_RAG_EVAL_DATABASE_URL=... python scripts/rag_eval.py --store pgvector` sonuçları bellek içi depoyla birebir aynı (bge-m3 dahil; yalnızca depolama değişti). Değerlendirme tabloyu her ayarda sildiği için ayrı, geçici bir veritabanı ister.
- Boyut/embedding ayarı değişirse vektörler ilk açılışta özel kaynaklar dahil yeniden hesaplanır.

**Anlamsal embedding (bge-m3, varsayılan, #101).** Kaynaklar ve sorgular Ollama'daki çok dilli `bge-m3` modeliyle vektörleşir (`app/rag/ollama_embeddings.py`); "nöbet" ile "konvülsiyon", "akciğer" ile "pulmoner" yakın düşer. Kurulum: `ollama pull bge-m3` (~1.2 GB). Ollama kapalıysa veya model yoksa uygulama hata vermeden hash embedding'e döner; Admin → **Sistem Durumu** hangi embedding'in çalıştığını ve geri dönüldüyse nedenini gösterir (`/api/v1/health` → `rag_embedding`). `VETMIND_RAG_EMBEDDING=hash` bge-m3'ü kapatır.

Güncel ölçüm (25 Kasım 2026, kaynak kartları ve parçalama sonrası, 19 sentetik vaka; `eval/results/rag-20261125-141935.md`):

| Embedding | İsabetlilik | İsabet | Kapsam | Boş vakada kaynaksız | Vaka başı alakasız | Vaka başı kaynak |
|---|---:|---:|---:|---:|---:|---:|
| Hash (yedek) | 0.72 | 1.00 | 0.57 | 1.00 | 0.42 | 1.53 |
| **bge-m3 (varsayılan)** | **0.82** | 1.00 | **0.71** | 1.00 | **0.32** | 1.74 |

Hazır kaynaklar tek parça olduğu ve kartları elle verildiği için sayılar 11 Kasım ölçümüyle aynı; kartlar ve parçalama klinik yüklemeleri etkiliyor.

**Yeniden sıralama (reranking) denendi, eklenmedi.** bge-m3 + bölge/tür filtresiyle bulunan ilk 12 aday `qwen2.5:7b`'ye verildi; model yalnızca listeden seçip sıraladı (`scripts/rag_rerank_experiment.py`, `eval/results/rerank-20261125-143506.md`). Kapsam 0.71 → 0.89'a çıktı ama isabetlilik 0.82 → 0.65'e düştü, vaka başı alakasız kaynak 0.32 → 0.95'e çıktı ve kaynak olmaması gereken iki vakada da model kaynak seçti (boş vakada kaynaksız 1.00 → 0.00). Rapor başına ~25 sn (medyan 29 sn) ek süre de geldi. İyileşme olmadığı için üretim hattına girmedi.

bge-m3 sıralamada çok daha iyi (ilgili kaynağı olan her vakada 1. sıradaki kaynak doğru), ama yoğun vektörlerde alakasız metin de yüksek puan aldığı için eşikler daha yüksek: bölgeli vakada 0.50, bölgesi "diğer/bilinmiyor" vakada 0.60. Torakolomber vakalar (#49) kendi bölgeleriyle yalnızca omurga kaynaklarını görür (SPINE_TL + SPINE); önceden "diğer" sayıldıkları için göğüs kaynakları geliyor ve bge-m3'te eşiğe takılıyorlardı. Ölçüm seti 19 vaka (2 torakolomber).
**Klinik kural:** RAG klinik kanıt sayılmaz; draft’ta `rag_note` uyarısı vardır; validator klinik validasyon bayrağını engeller.

### 8.5 Revizyondan öğrenen AI (uzman dersleri)

Radyolog revizyon isterken **"Bu düzeltmeyi benzer vakalar için hatırla"** kutusu işaretliyse gerekçe bir **ders** olarak kaydedilir (`app/llm/lessons.py`, `data/revision_lessons.json`). Ders vakanın bölge / tür / modalite / bulgu kodlarıyla etiketlenir; hasta ve klinik adı kayıttan önce maskelenir.

- **O anda düzeltme:** "Yapay zekâ ile yeniden yaz" gerekçeyi modele verip yeni taslak yazdırır.
- **Kalıcı öğrenme:** sonraki taslaklarda aynı bölge ve türdeki dersler (en çok 3; ortak bulgu kodu olan önce) prompta `EXPERT LESSONS` bloğu olarak eklenir. Ayırıcı tanı adımı da bunları görür. Dersler bulgu eklemez, kaynak sayılmaz, sistem kurallarını aşamaz.
- **Kontrol:** radyolog ve admin **AI Dersleri** sayfasında (`/ai-dersleri`) dersleri görür, kapatır veya siler; taslakta kaç ders uygulandığı çalışma alanında gösterilir (`generation.applied_lesson_ids`).
- **API:** `GET/POST /api/v1/lessons`, `PATCH/DELETE /api/v1/lessons/{id}`.

Ölçüm (`python scripts/lesson_eval.py`): Tarçın'da yazılan ders ("ağrılı servikal vakada FKE'yi öne çıkarma, kondrodistrofik ırkta IVDD'yi değerlendir") benzer vaka Paşa'ya, qwen2.5:7b ile 5'er çalıştırma:

| | FKE yüksek/orta sırada | IVDD geçiyor |
|---|---:|---:|
| Derssiz | 4/5 | 2/5 |
| Dersli | 2/5 | 5/5 |

Küçük bir duman testi; model dersi her seferinde uygulamıyor. Son karar yine radyologda.

### 8.6 VHS ölçüm aracı (vertebral kalp skoru)

Röntgen (XR) vakalarında radyolog çalışma alanındaki görüntüleyicide **VHS** aracını (kısayol `H`) seçer ve 6 noktaya tıklar: uzun eksen (karina altı → apeks), ona dik kısa eksen, omur cetveli (T4 ve T8'in kranial kenarı = 4 omur). VHS = (uzun + kısa) / ortalama omur boyu. Sonuç köpek (8.5–10.5) ve kedi (6.9–8.1) referans aralıklarıyla karşılaştırılır; kısa eksen dik değilse uyarı verir. **Rapora ekle** sonucu Bulgular bölümünün sonuna yazar (onaylı raporda kapalı). Hesap `src/shared/lib/vhs.ts`; referanslar ırka göre değişir, sonuç tanı değil ölçüm yardımıdır. Aynı araç ileride veri etiketlemek için de kullanılabilir. İlk kullanımda bir **rehber penceresi** VHS'nin ne olduğunu ve 6 noktanın yerini şemayla anlatır (veteriner olmayanlar ve jüri için de); "Anladım, bir daha gösterme" işaretlenirse 30 gün çıkmaz, şeritteki **?** ile her zaman açılır.

### 8.7 Önceki tetkiklerle karşılaştırma

Her vaka kliniğe ait bir **hasta kaydına** (`patient_id`) bağlanabilir (#108). Veteriner yeni vaka sihirbazında kayıtlı hastayı arayıp seçer; seçmezse kayıt otomatik açılır. Aynı isim ve türde hasta varsa öneri çıkar, DICOM yüklenen vakada `PatientID` eşleşmesi de önerilir; **hiçbir şey otomatik bağlanmaz**. Mikroçip ve klinik no klinik içinde eşsizdir; yanlışlıkla iki kez açılan kayıtlar klinik sahibi / admin tarafından birleştirilir.

- **Önceki tetkikler paneli** (vaka sayfası ve radyolog çalışma alanı): aynı hayvanın diğer vakaları; aynı modalite ve bölgedekiler "karşılaştırmaya uygun" etiketiyle üstte.
- **Yan yana karşılaştırma**: solda bu tetkik, sağda önceki. Dilimler göreli konuma göre eşlenir (iki çalışmanın dilim sayısı farklı olabilir); zoom/pan birlikte, pencere/seviye isteğe bağlı. İki panelde mesafe ölçülürse fark gösterilir. Hesaplar `src/shared/dicom/viewerSync.ts`.
- **Rapordaki değişim bölümü** (`DraftReport.comparison`): aynı hastanın aynı modalite/bölgedeki en yakın **onaylı** önceki raporuyla bulgu kodları karşılaştırılır: yeni, devam eden, önceki tetkikte olup artık görülmeyen. Cümleler bu tetkikin bulgularına `[F1]`, önceki rapora `[P1]` diye atıf verir; atıflar doğrulanır. Önceki izlenim alıntısı KVKK maskelemesinden geçer. Radyolog metni düzenleyebilir; onaylanınca rapor çıktısına ve PDF'e girer. Hasta kaydı olmayan vakalarda bölüm yoktur (eski davranış). Kod: `backend/app/llm/comparison.py`.
- **Eski vakalar**: `python scripts/backfill_patients.py --dry-run` vakaları klinik + isim + türe göre gruplayıp hasta kaydı önerir; aynı isim ve türde farklı ırklar varsa (iki ayrı hayvan olabilir) dokunmaz, listeler.

Derin AI dokümantasyonu: [docs/ARCHITECTURE_AND_LLM.md](docs/ARCHITECTURE_AND_LLM.md).

---

## 9. Rapor yaşam döngüsü

```text
Pipeline draft
  → attach_pipeline_draft() → DraftReport.version + report_versions[]
  → Expert review (CaseService lock + CAP_REVIEW)
       approve           → freeze_approved()     (immutable)
       reject            → apply_reject_or_revision()
       request_revision  → fork after approve if needed
  → GET /report?version=N  /  GET /report/versions[/{n}]
  → CaseDetail history + ApprovedReport → window.print() / PDF
```

| Kural | Davranış |
|-------|----------|
| İlk pipeline draft | version 1 (mutable) |
| Approve | `immutable: true`; `clinically_validated` false kalır |
| Reject / revision (mutable) | status + notes; gerekirse aynı sürüm |
| Revision after approve | Yeni mutable sürüm; önceki onaylı snapshot kalır |
| Concurrent review | Lock → biri 200, diğeri **409** |
| Re-analyze while approved | **409** (sessiz overwrite yok) |

PDF: sunucu tarafı PDF kütüphanesi yok; `ApprovedReport` + `@media print` + `window.print()` (E2E’de Chromium `page.pdf()` ile doğrulanır).

---

## 10. Auth, RBAC ve güvenlik

### Auth modları

| Mod | Env | Davranış |
|-----|-----|----------|
| Demo (varsayılan) | `VETMIND_AUTH_ENABLED=0` | Principal `demo`, capability `*` |
| Auth açık | `VETMIND_AUTH_ENABLED=1` | Bearer JWT ve/veya `X-API-Key` |
| Protected | `VETMIND_DEPLOYMENT_MODE=protected` | Auth zorunlu + non-default JWT secret; fail-closed startup |

### RBAC (özet)

| Rol | Yetenekler (özet) |
|-----|-------------------|
| `demo` / `service` / `admin` | `*` |
| `vet` | cases write/read, analyze, dicom, documents, rag:search |
| `expert` | cases read, analyze, review, rag:search, dicom (demo) |
| `clinic_owner` | cases read, rag:search, clinic manage, dicom (okuma) |

Capability sabitleri: `backend/app/auth/rbac.py` (`cases:write`, `review`, `rag:admin`, …).

### Kullanıcı hesapları ve oturum (#31)

Tüm hesaplar backend'de tutulur: demo seed kullanıcılar, kayıt olanlar ve Admin → Kullanıcılar'dan oluşturulanlar. Tarayıcıda hesap veya şifre saklanmaz.

| Konu | Davranış |
|------|----------|
| Şifre saklama | stdlib scrypt hash (`backend/app/auth/passwords.py`). Eski düz metin kayıtlar backend açılırken otomatik hash'lenir |
| Şifre politikası | En az 8 karakter, en az bir harf ve bir rakam (kayıt, admin, sıfırlama, değiştirme) |
| Kayıt | `POST /api/v1/auth/register`. Yalnızca `vet` kayıt olabilir ve admin onayı bekler (kliniği `VETMIND_SELF_REGISTRATION_OWNER_CLINIC`). Diğer roller kayıtla açılmaz. `VETMIND_SELF_REGISTRATION=0` kapatır. E-posta kayıtlı olsa da olmasa da aynı `202` cevabı döner (#41) |
| E-posta doğrulama (#41) | Kayıttan sonra 24 saat geçerli tek kullanımlık link gider (`VETMIND_EMAIL_VERIFY_TTL_SECONDS`). Kayıtlı adrese link yerine "zaten hesabınız var" e-postası gider, şifre değişmez. `POST /auth/verify-email` doğrular, `POST /auth/verify-email/resend` yeni link yollar (aynı cevap + deneme sınırı). Doğrulanmamış hesap admin tarafından aktifleştirilemez; admin "doğrulanmış işaretle" diyebilir. Eski hesaplar, demo ve admin'in açtığı hesaplar doğrulanmış sayılır |
| Klinik kuralı | `vet` / `expert` / `clinic_owner` hesapları klinik atanmadan aktif olamaz |
| Access token | HS256 JWT, varsayılan 15 dk (`VETMIND_JWT_TTL_SECONDS`), `tv` (token_version) claim'i taşır |
| Refresh token | Opak, 7 gün kayan pencere (`VETMIND_REFRESH_TTL_SECONDS`). Her kullanımda döner. Kullanılmış token 20 sn sonra tekrar gelirse oturum ailesi iptal edilir. DB'de sadece SHA-256 |
| Çıkış | `POST /api/v1/auth/logout` refresh ailesini iptal eder |
| Şifre değiştirme | `POST /api/v1/auth/password/change` (giriş yapmış kullanıcı). Diğer oturumlar kapanır |
| İki adımlı giriş (#107) | İsteğe bağlı TOTP (Google / Microsoft Authenticator). Ayarlar → QR ile kurulum, 10 tek kullanımlık yedek kod (scrypt hash'li). Açıkken `/auth/login` token yerine 5 dk geçerli tek kullanımlık bir bilet döner; `/auth/mfa/verify` kod veya yedek kodla girişi tamamlar. Aynı kod iki kez kabul edilmez, yanlış kodlara deneme sınırı uygulanır. Gizli anahtar Fernet ile şifreli saklanır (`VETMIND_MFA_ENCRYPTION_KEY`; yoksa JWT secret'tan HKDF ile türetilir). Admin → Kullanıcılar'daki **"İki adımlı doğrulama zorunluluğu"** kartından roller zorunlu tutulur (veritabanında saklanır, Alembic `0005`; kaydedilene kadar başlangıç değeri `VETMIND_MFA_REQUIRED_ROLES`). Kurmayan kullanıcı bir sonraki girişinde yalnızca Ayarlar'da kurulum yapabileceği bir oturum alır. Aynı sayfada 2FA sütunu ve "2FA'yı sıfırla" (telefon kaybı). **Demo hesaplar (`*@demo.local`) hiçbir zaman etkilenmez**: 2FA açamaz, zorunluluk uygulanmaz |
| Şifremi unuttum | `POST /api/v1/auth/password/forgot` → 30 dk geçerli tek kullanımlık link. Hesap olsa da olmasa da aynı cevap. Demo modda e-posta sunucu log'una yazılır, `VETMIND_SMTP_*` ile gerçek e-posta |
| Sıfırlama | `POST /api/v1/auth/password/reset`. Tüm oturumlar kapanır |
| Deneme sınırı | login, register, forgot, reset, change için `429` + `Retry-After` (`VETMIND_AUTH_RATE_LIMIT`). Sayaçlar süreç belleğinde |
| Audit ekranı (#106) | `/guvenlik`: son 24 saat / 7 gün kartları, şüpheli durumlar (15 dk içinde 5+ başarısız giriş, deneme sınırı, kullanılmış refresh token'ın tekrar gelmesi), olay / kişi / sonuç / tarih filtresi (adres çubuğunda paylaşılabilir), satır ayrıntısı, CSV (en fazla 5 000 satır, formül enjeksiyonuna karşı temizlenmiş). Admin her şeyi, klinik sahibi sadece kendi kliniğini görür. Ekran **sadece okur**: hesap kilitlemez, değiştirmez. Ekranı açmak ve CSV indirmek de audit'e yazılır (`admin.audit_view`, `admin.audit_export`). IP / tarayıcı bilgisi tutulmaz |

Ayarların tamamı ve varsayılanları: `backend/.env.example`.

### Frontend ↔ backend auth

1. Giriş / kayıt `backendLogin` / `backendRegister` ile yapılır. UI oturumu `src/shared/auth/session.ts` → localStorage (`vetmind.demo.session`)
2. Token çifti: `vetmind.backend.jwt` + `vetmind.backend.refresh` (protected modda sessionStorage). `backend.ts` `Authorization: Bearer` ekler, 401'de bir kez sessizce yenileyip isteği tekrarlar. Yenileme reddedilirse `vetmind:auth-expired` olayıyla çıkış yapılır
3. Sayfalar: `/kayit`, `/giris`, `/sifremi-unuttum`, `/sifre-sifirla?token=…`, `/eposta-dogrula?token=…` (EN: `/register`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email`), Ayarlar → Şifre değiştir (sadece auth açıkken)
4. Çıkışta backend'deki refresh token iptal edilir ve IndexedDB DICOM önbelleği temizlenir

### Güvenlik notları (dürüst)

- Varsayılan auth kapalı; internete açık deploy için **uygun değil**.
- Demo seed şifresi (`demo1234`) ve varsayılan JWT secret bilinir. Protected mod varsayılan veya 32 karakterden kısa secret ile açılmaz.
- Auth açıkken (veya protected modda) `/docs`, `/redoc`, `/openapi.json` kapalıdır; `/api/v1/health` ayrıntıları yalnızca admin / API anahtarına gösterilir.
- nginx her yanıta CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy` ve HSTS ekler (`docker/security-headers.conf`).
- Bir admin, başka bir admin'in şifresini, sıfırlama bağlantısını veya 2FA'sını JWT ile sıfırlayamaz; bunun için API anahtarı gerekir.
- `*@demo.local` demo hesapları yalnızca demo modda vardır; protected modda giriş yapamaz (aynı veritabanında demo moddan kalmış olsalar bile). Testler için `VETMIND_DEMO_ACCOUNTS=1` ile bilinçli olarak açılabilir.
- `docker compose` web (8080) ve PostgreSQL (5432) portlarını yalnızca `127.0.0.1`'de açar: demo modda giriş yoktur ve rol seçici herkesi admin yapar. Başka makinelerden erişim için protected overlay'i kullanın (`VETMIND_WEB_BIND`).
- Deneme sayaçları süreç belleğinde: yeniden başlatmada sıfırlanır, birden fazla worker'da her biri ayrı sayar.
- Kayıt, şifremi unuttum ve doğrulama linkini tekrar gönderme uçları kayıtlı e-postayı belli etmez (aynı cevap, iş cevaptan sonra yapılır).
- Quarantine yerel diskte; üretim AV / şifreleme yok.
- Tenant isolation auth açık + `tenant_isolation` ile anlamlıdır.
- AI çıktıları tanı değildir; UI disclaimer'ları bilinçlidir.

---

## 11. Frontend

### Rotalar

| Rota (TR; EN karşılığı da var) | Sayfa (aksi yazmadıkça `src/features/…`) | Roller | Backend kullanımı |
|------|-------|--------|-------------------|
| `/` | `shared/shell/Landing.tsx` (misafir) / `src/app/Dashboard.tsx` | misafir / tümü | — |
| `/giris`, `/kayit` | `auth/Login.tsx`, `auth/Register.tsx` | — | `POST /auth/login`, `POST /auth/register` (yalnız veteriner, admin onayıyla) |
| `/sifremi-unuttum`, `/sifre-sifirla` | `auth/ForgotPassword.tsx`, `auth/ResetPassword.tsx` | — / tümü | `POST /auth/password/forgot`, `/reset` |
| `/eposta-dogrula` | `auth/VerifyEmail.tsx` | — / tümü | `POST /auth/verify-email`, `/verify-email/resend` |
| `/ayarlar` | `auth/Settings.tsx` | vet, expert, clinic_owner, admin | ayarlar, şifre değiştir |
| `/vakalar/yeni` | `cases/NewCase.tsx` | vet | vaka aç → tetkik yükleme (DICOM) → analiz |
| `/vakalar` | `cases/CaseList.tsx` | vet, expert, clinic_owner | liste; `?durum=onaylandi` onaylı raporlar |
| `/vakalar/:id` | `cases/CaseDetailPage.tsx` | vet, expert, clinic_owner | vaka, bulgular, geçmiş, RAG, önceki tetkikler (`patients/PriorStudiesPanel.tsx`) |
| `/vakalar/:id/isleme` | `analysis/Processing.tsx` | vet, expert | job poll |
| `/vakalar/:id/calisma` | `expert/RadiologistWorkspace.tsx` | expert | review submit (+ hydrate) |
| `/vakalar/:id/inceleme` | yönlendirme → `/calisma` | expert | eski bağlantı |
| `/kuyruk`, `/ai-tekrar` | `expert/ReviewQueue.tsx`, `expert/ExpertAiResend.tsx` | expert | kuyruk, AI'ye yeniden gönderme |
| `/raporlar/:id` | `reports/ApprovedReport.tsx` | vet, expert, clinic_owner | onaylı rapor + PDF |
| `/raporlar` | yönlendirme → `/vakalar?durum=onaylandi` | — | eski bağlantı (#81) |
| `/rapor-baglanti` | `reports/ReportLink.tsx` | herkes (bağlantıyla) | paylaşılan rapor |
| `/dicom-yukle` | yönlendirme → `/vakalar/yeni` | — | eski bağlantı (#79); test build'inde eski sayfa |
| `/mesajlar` | `messaging/Messages.tsx` | vet, expert, clinic_owner, admin | mesajlaşma |
| `/ai-dersleri` | `rag-admin/AiLessons.tsx` | expert, admin | `/lessons` |
| `/moduller`, `/bilgi-tabani` | `rag-admin/Modules.tsx`, `rag-admin/KnowledgeBase.tsx` | admin | `rag/*` |
| `/kullanicilar`, `/radyologlarim` | `admin/AdminUsers.tsx`, `admin/AdminRadiologists.tsx` | admin | kullanıcı yönetimi |
| `/guvenlik` | `admin/SecurityAudit.tsx` | admin, clinic_owner (kendi kliniği) | `GET /admin/audit`, `/summary`, `/export.csv` |
| `/sistem`, `/model-performansi` | `admin/SystemStatus.tsx`, `admin/ModelPerformance.tsx` | admin | `GET /health`, değerlendirme sonuçları |

Rotalar her feature'ın `routes.tsx` dosyasında; `src/App.tsx` bunları bağlar. Rol kapısı: `src/shared/shell/routing.tsx` → `<Gate roles={[...]}>`.

### Önemli bileşenler / lib

| Dosya | Amaç |
|-------|------|
| `src/shared/shell/lazyPage.ts` + `src/shared/ui/PageLoader.tsx` | Sayfalar `React.lazy` ile ayrı parçalarda yüklenir. Yeni sürümden sonra eski parça bulunamazsa sayfa bir kez yenilenir |
| `vite.config.ts` (`manualChunks`) | `react-vendor`, `icons`, `charts` (sadece grafikli sayfalar), `dicom` kütüphane parçaları |
| `src/shared/dicom/DicomViewer.tsx` + `src/shared/lib/dicomPreview.ts` | Tarayıcı viewer (klinik PACS değil) |
| `src/shared/ui/RagCitations.tsx` | `rag_citations` paneli |
| `src/shared/api/*` | Domain'lere ayrılmış `/api/v1` istemcisi (`client.ts`: token, 401'de yenileme), async poll |
| `src/shared/lib/caseMapper.ts` | Backend record → UI `VetCase` |
| `src/shared/auth/session.ts` | Oturum + JWT saklama |
| `src/shared/shell/AppContext.tsx` | Backend hydrate / refresh |

Modül sınırları ve import kuralları: [docs/modularization.md](docs/modularization.md).

---

## 12. API referansı

Önek: `/api/v1`. Canlı şema: http://127.0.0.1:8000/docs

| Method | Path | Amaç |
|--------|------|------|
| GET | `/health` | Canlılık + storage / rag / jobs / auth / vision bayrakları |
| GET | `/auth/status` | Auth zorunlu mu? |
| POST | `/auth/login` | Access + refresh token |
| POST | `/auth/register` | Veteriner kaydı (doğrulama e-postası + admin onayı) |
| POST | `/auth/verify-email` | E-postadaki link ile adresi doğrula |
| POST | `/auth/verify-email/resend` | Yeni doğrulama linki (her adrese aynı cevap) |
| POST | `/auth/refresh` | Token çiftini yenile (rotation) |
| POST | `/auth/logout` | Refresh ailesini iptal et |
| POST | `/auth/mfa/verify` | İkinci adım: bilet + kod / yedek kod → token çifti |
| GET | `/auth/mfa/status` | 2FA durumu (açık mı, kalan yedek kod, rol zorunluluğu, demo hesap mı) |
| POST | `/auth/mfa/setup` · `/enable` · `/disable` · `/backup-codes` | Kurulum (QR), açma (yedek kodlar bir kez gösterilir), kapatma ve yeni yedek kodlar (şifre + kod) |
| POST | `/admin/users/{email}/mfa-reset` | Admin: kullanıcının 2FA'sını kapatır, oturumlarını sonlandırır |
| GET / PUT | `/admin/mfa-policy` | 2FA zorunlu roller (kaynak: ekran / sunucu ayarı / yok) |
| POST | `/auth/password/change` | Şifre değiştir (giriş gerekli) |
| POST | `/auth/password/forgot` | Sıfırlama linki e-postala |
| POST | `/auth/password/reset` | Link ile yeni şifre |
| GET | `/auth/me` | Principal |
| GET | `/admin/audit` | Audit kayıtları (`event_type` tam ya da `auth.` gibi ön ek, `actor`, `outcome`, `clinic_id`, `since`, `until`, `limit`, `cursor`) |
| GET | `/admin/audit/summary` | Özet kartları ve şüpheli durumlar (son 7 gün) |
| GET | `/admin/audit/export.csv` | Aynı filtrelerle CSV (en fazla 5 000 satır) |
| POST | `/cases` | Sentetik vaka oluştur (opsiyonel `patient_id`) |
| GET / POST | `/patients` | Hasta ara (`?q=` ad, mikroçip, klinik no) / oluştur (#108) |
| GET / PATCH | `/patients/{id}` | Hasta kaydı |
| GET | `/patients/{id}/studies` | Hastanın tüm tetkikleri |
| POST | `/patients/{id}/merge` | Çift kaydı birleştir (klinik sahibi / admin) |
| GET | `/cases/{id}/prior-studies` | Vakanın önceki tetkikleri veya hasta önerileri |
| PUT | `/cases/{id}/patient` | Vakayı hastaya bağla / bağlantıyı kaldır |
| GET / POST / PUT | `/cases/{id}/owner-summary` | Sahip özeti: durum / oluştur (onaylı rapor gerekir) / düzenle (#113) |
| POST | `/cases/{id}/owner-summary/approve` | Özeti onayla |
| GET | `/cases/{id}/owner-summary.pdf` | Onaylı özetin PDF'i |
| GET | `/cases` | Vaka listesi |
| GET | `/cases/{id}` | Tam vaka kaydı |
| POST | `/cases/{id}/model-input` | ImagingModelInput üret / yenile |
| GET | `/cases/{id}/model-input` | Model input getir |
| GET | `/cases/{id}/findings` | Structured findings |
| POST | `/cases/{id}/analyze` | Sync pipeline |
| POST | `/cases/{id}/analyze/async` | Async enqueue (202) |
| GET | `/jobs/{id}` | Job durumu / outcome |
| POST | `/jobs/{id}/cancel` | Cooperative iptal |
| GET | `/cases/{id}/report` | Draft / sürüm (`?version=`) |
| GET | `/cases/{id}/report/versions` | Sürüm listesi |
| GET | `/cases/{id}/report/versions/{n}` | Belirli sürüm |
| POST | `/cases/{id}/review` | Uzman inceleme |
| POST | `/dicom/upload` | Multipart DICOM → quarantine |
| POST | `/dicom/demo/{kind}` | `brain_mri` \| `cervical_mri` \| `brain_ct` \| `thorax_xr` |
| GET | `/dicom/fixtures/{kind}/{index}` | Viewer için `.dcm` |
| GET | `/dicom/ingestions/{id}` | Ingestion kaydı |
| POST | `/dicom/ingestions/{id}/confirm` | Sınıflandırma onayı → case |
| POST | `/documents/upload` | PDF/JPG/PNG/text |
| GET | `/documents/ingestions/{id}` | Doküman ingestion |
| POST | `/documents/ingestions/{id}/confirm` | Onay → case |
| GET | `/rag/search?q=&top_k=` | RAG arama |
| POST | `/rag/reindex` | İndeks yenile (admin) |
| POST | `/rag/documents` | Özel pasaj ekle (admin) |

Backend özeti: [backend/README.md](backend/README.md).

---

## 13. Ortam değişkenleri

Şablon: [`backend/.env.example`](backend/.env.example) · okuma: `backend/app/settings.py`.

### Temel

| Değişken | Varsayılan | Anlam |
|----------|------------|--------|
| `VETMIND_STORAGE` | `postgres` | `postgres` \| `sqlite` (yerel geliştirme) \| `memory` (testler) |
| `VETMIND_DATABASE_URL` / `DATABASE_URL` | `postgresql://vetmind:vetmind@localhost:5432/vetmind` | Postgres DSN |
| `VETMIND_SQLITE_PATH` | `./data/vetmind.sqlite3` | `VETMIND_STORAGE=sqlite` iken tek dosya |
| `VETMIND_QUARANTINE_ROOT` | `./data/quarantine` | Karantina kökü |
| `VETMIND_ASYNC_DELAY_MS` | `400` | Async yapay gecikme (0–10000) |
| `VETMIND_DEMO_SEED` | `0` | `1` → vaka yokken örnek vakaları yükle (§5 Örnek vakalar) |
| `VETMIND_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | API'yi başka adresten çağırabilecek tarayıcı adresleri (virgülle). nginx arkasında (aynı adres) gerekmez; korumalı modda `*` reddedilir |

### Jobs

| Değişken | Varsayılan | Anlam |
|----------|------------|--------|
| `VETMIND_JOB_BACKEND` | `thread` | `thread` \| `rq` |
| `VETMIND_REDIS_URL` | — | RQ Redis URL |
| `VETMIND_RQ_QUEUE` | `vetmind` | Kuyruk adı (API ve worker aynı değeri kullanır; `vetmind-gpu` → `rq_gpu_worker`) |

### RAG / Vision / LLM

| Değişken | Varsayılan | Anlam |
|----------|------------|--------|
| `VETMIND_RAG` | `embedding` | `embedding` \| `lexical` |
| `VETMIND_RAG_EMBEDDING` | `ollama` | `ollama` (bge-m3, anlamsal; ulaşılamazsa hash) \| `hash` |
| `VETMIND_RAG_EMBEDDING_MODEL` / `_URL` | `bge-m3` / `http://localhost:11434` | Embedding modeli ve Ollama adresi |
| `VETMIND_RAG_STORE` | `auto` | `auto` (PostgreSQL varsa `pgvector`, yoksa `json`) \| `pgvector` \| `json` \| `chroma` (isteğe bağlı, `requirements-chroma.txt`) |
| `VETMIND_CHROMA_PATH` | `./data/chroma` | Yalnızca `RAG_STORE=chroma`: Chroma klasörü |
| `VETMIND_CHROMA_URL` | — | Yalnızca `RAG_STORE=chroma`: ayrı Chroma sunucusu (ör. `http://chroma:8000`) |
| `VETMIND_RAG_INDEX_PATH` | `./data/rag_index.json` | JSON indeks: `RAG_STORE=json` deposu veya pgvector / Chroma'ya ilk taşıma kaynağı |
| `VETMIND_VISION_ENDPOINT` | — | Remote Vision HTTP |
| `VETMIND_VISION_MODEL_ID` | `remote-vision-v1` | Remote model id |
| `VETMIND_VISION_API_KEY` | — | Bearer |
| `VETMIND_VISION_MODALITIES` / `_REGIONS` | — | Endpoint set ise zorunlu capability beyanı |
| `VETMIND_VISION_EXECUTION_POLICY` | `exclusive_real` | `exclusive_real` \| `mixed` |
| `VETMIND_LLM_PROVIDER` | `mock` | `mock` \| `stub` \| `http` \| `ollama` \| `openai` \| `anthropic` (+ `vllm`, `openrouter`, `groq`, `lmstudio`) |
| `VETMIND_LLM_MODEL_ID` | — | Model adı, ör. `qwen2.5:7b` (`anthropic` boşsa varsayılan model) |
| `VETMIND_LLM_ENDPOINT` | sağlayıcıya göre | Temel URL (Ollama: `http://localhost:11434/v1`) |
| `VETMIND_LLM_API_KEY` | — | OpenAI / Anthropic için |
| `VETMIND_LLM_TIMEOUT_S` | `30` | Gerçek modelde **180** önerilir |
| `VETMIND_LLM_PROMPT_VERSION` | `vetmind-report-v5` | `v2` metin · `v3` tek çağrı + tanılar · `v4` iki adım + onarım · `v5` v4 + atıf örneği |
| `VETMIND_LLM_VERIFY` | `false` | Hakem (atıf doğrulama) çağrısı |
| `VETMIND_LLM_VERIFIER_MODEL_ID` | yazar model | Farklı hakem modeli (aynı sunucu) |
| `VETMIND_LLM_REPORT_LANGUAGE` | `tr` | `tr` \| `en` |
| `VETMIND_LLM_TEMPERATURE` / `_MAX_TOKENS` / `_JSON_MODE` | `0.2` / `2048` / `schema` | Bkz. [docs/LLM_KATMANI.md](docs/LLM_KATMANI.md) |
| `VETMIND_CLASSIFIER_LLM` | `0` | `1` → DICOM sınıflandırıcıda boşlukları dil modeli doldurur (§4.4) |
| `VETMIND_CLASSIFIER_LLM_MODEL_ID` | `VETMIND_LLM_MODEL_ID` | Sınıflandırıcı için ayrı model |
| `VETMIND_RAG_CARD_LLM` | `0` | `1` → yüklenen bilgi bankası kaynaklarının bölge/tür etiketinde kuralların boş bıraktığını dil modeli doldurur |
| `VETMIND_CLASSIFIER_LLM_TIMEOUT_S` | `20` | Aşılırsa o yükleme için kurallarla devam edilir |

### Auth / güvenlik

| Değişken | Varsayılan | Anlam |
|----------|------------|--------|
| `VETMIND_AUTH_ENABLED` | `0` | `1` → JWT/API key zorunlu |
| `VETMIND_API_KEY` | — | `X-API-Key` |
| `VETMIND_JWT_SECRET` | demo secret | Auth açıkken değiştirin |
| `VETMIND_JWT_TTL_SECONDS` | `43200` | Token TTL |
| `VETMIND_DEPLOYMENT_MODE` | `demo` | `demo` \| `protected` |
| `VETMIND_TENANT_ISOLATION` | off | Klinik izolasyonu |
| `VETMIND_ALLOW_INSECURE_DEMO` | off | Auth kapalıyken anonim isteklere tam yetki (yalnızca yerel geliştirme); protected modda ve varsayılan JWT secret ile auth açıkken kabul edilmez |
| `VETMIND_DEMO_ACCOUNTS` | demo: on, protected: off | `*@demo.local` hesapları (`demo1234`) giriş yapabilir mi; protected'da yalnızca test için |
| `VETMIND_MALWARE_SCANNER` | — | `clamav` = her DICOM/belge yüklemesi ClamAV daemon'ında taranır (virüs → 422, tarayıcıya ulaşılamazsa → 503). Protected modda zorunlu; `fake_clean` yalnızca testte |
| `VETMIND_CLAMD_HOST` / `VETMIND_CLAMD_PORT` / `VETMIND_CLAMD_SOCKET` | `127.0.0.1` / `3310` / — | ClamAV daemon adresi (TCP ya da Unix soketi) |
| `VETMIND_ALLOW_TEST_SCANNER` | off | Protected modda her dosyayı temiz sayan test tarayıcısına izin (yalnızca CI / readiness, gerçek veri yok) |
| `VETMIND_AUDIT_LOG_PATH` | `./data/audit/security.jsonl` | Audit JSONL |
| `VETMIND_MAX_CONCURRENT_ANALYZE` | `8` | Eşzamanlı analiz limiti |

---

## 14. Opsiyonel altyapı

### Redis (RQ işleri)

```bash
docker compose up -d db                              # repo kökünden: PostgreSQL
cd backend
docker compose -f docker-compose.yml up -d           # Redis
pip install -r requirements-optional.txt
export VETMIND_JOB_BACKEND=rq
export VETMIND_REDIS_URL=redis://127.0.0.1:6379/0
# terminal A
uvicorn app.main:app --reload --port 8000
# terminal B
python -m app.workers.rq_worker
```

### Mock remote Vision

```bash
cd backend
python scripts/mock_vision_server.py   # :8090/infer
export VETMIND_VISION_ENDPOINT=http://127.0.0.1:8090/infer
# + modality/region capability env’leri (settings / .env.example)
```

### Geçici (test) storage

```bash
export VETMIND_STORAGE=memory
```

---

## 15. Testler

### Envanter (Phase 6 baseline)

| Katman | Konum | Not |
|--------|-------|-----|
| Frontend unit | `src/**/*.test.ts` | Vitest |
| Backend | `backend/tests/` | ~238 pytest (+1 skip tipik) |
| Phase 6 API journeys | `test_phase6_e2e_journey.py` | DICOM→approve→versions, authz, persistence, … |
| Browser E2E | `e2e/*.spec.ts` | Tam workflow + negatives + smoke |
| Typecheck / build | `npm run typecheck` · `npm run build` | |

### Komutlar

```bash
npm test
npm run typecheck
npm run lint                                         # ESLint (frontend)
npm run build
npm run backend:test
cd backend && ruff check .                           # ruff (pip install ruff==0.17.6; kurallar backend/ruff.toml)
# veya: cd backend && pytest

npm run e2e                                          # demo modu (masaüstü + mobil), Windows/macOS/Linux
E2E_PROTECTED=1 npx playwright test --project=e2e-protected   # korumalı mod (auth açık)
# Sistem Google Chrome kullanılır (channel: chrome); tarayıcı indirmez.

# PostgreSQL testleri (CI'da ayrı iş; boş bir test veritabanı verin, tabloları siler):
VETMIND_TEST_DATABASE_URL=postgresql://vetmind:vetmind@localhost:5432/vetmind_test \
  pytest -m postgres tests/test_sql_stores.py tests/test_postgres_app.py -q
```

### Browser E2E kapsamı

| Dosya | Senaryo |
|-------|---------|
| `e2e/full-workflow.spec.ts` | Login → Brain MRI demo → viewer/slice → confirm+analyze → findings → expert approve → versions → print/PDF |
| `e2e/negative.spec.ts` | Geçersiz DICOM, yetkisiz inceleme, refresh kalıcılık, timeout, cancel, backend down |
| `e2e/demo-journey.spec.ts` | Login / logout (desktop + mobil viewport) |

Playwright izole sqlite kullanır (`e2e/.data/`); üretim `backend/data/` dokunulmaz. Backend'i
`scripts/e2e-backend.mjs` başlatır (her işletim sisteminde; her çalıştırmada veri sıfırlanır, gerçek
LLM çağrılmaz). CI'da (`.github/workflows/ci.yml` → **E2E** işi) her push ve PR'da çalışır; hata
olursa Playwright raporu ve trace'ler `playwright-report` artifact'i olarak indirilebilir.
Trace açmak için: `npx playwright show-trace <trace.zip>`.

### Backend test odakları (örnek)

`test_api`, `test_dicom`, `test_ct_xr`, `test_documents`, `test_quarantine`, `test_orchestrator`, `test_router`, `test_mock_vision`, `test_http_vision`, `test_llm`, `test_rag` / `test_embedding_rag`, `test_async_analyze`, `test_report_versioning`, `test_auth` / `test_rbac`, `test_phase3_ai_readiness`, `test_phase5_security`, `test_phase6_e2e_journey`, `test_hardening_p0`, …

---

## 16. Depo düzeni

```text
veteriner/
├── README.md                      ← bu dosya (giriş noktası)
├── ARCHITECTURE.md                genel mimari (derinlik)
├── package.json
├── playwright.config.ts
├── vite.config.ts                 /api → :8000
├── vitest.config.ts
├── vercel.json
├── index.html
├── public/
├── scripts/                       build-share.mjs vb.
├── src/
│   ├── App.tsx                    Router + Gate
│   ├── main.tsx
│   ├── types.ts
│   ├── pages/                     Landing, Login, DicomUpload, Processing,
│   │                              CaseList, CaseDetail, ExpertReview,
│   │                              ApprovedReport, KnowledgeBase, SystemStatus, …
│   ├── components/                Layout, DicomViewer, RagCitations, …
│   ├── context/AppContext.tsx
│   ├── lib/                       backend.ts, auth.ts, caseMapper.ts, …
│   └── data/mock.ts               Yerel seed vakalar / KB
├── e2e/
│   ├── full-workflow.spec.ts
│   ├── negative.spec.ts
│   ├── demo-journey.spec.ts
│   └── helpers/
├── docs/
│   ├── ARCHITECTURE_AND_LLM.md
│   ├── PHASE_*.md
│   └── audits/
└── backend/
    ├── README.md
    ├── .env.example
    ├── requirements.txt
    ├── requirements-optional.txt  # redis, rq, psycopg
    ├── docker-compose.yml         # Redis 7 (Postgres kök docker-compose.yml'de)
    ├── migrations/                # Alembic şema migration'ları (#102)
    ├── pytest.ini
    ├── scripts/                   mock_vision_server, bench_dicom_synthetic
    ├── data/                      runtime (gitignore)
    ├── app/
    │   ├── main.py
    │   ├── container.py
    │   ├── settings.py
    │   ├── api/
    │   ├── auth/
    │   ├── services/
    │   ├── storage/
    │   ├── dicom/
    │   ├── ingest/
    │   ├── imaging/
    │   ├── routing/
    │   ├── models/
    │   ├── orchestration/
    │   ├── llm/
    │   ├── rag/
    │   ├── validation/
    │   ├── workers/
    │   ├── security/
    │   └── schemas/
    └── tests/
```

---

## 17. Swap-in noktaları

Gerçek modeller / altyapı eklerken orchestrator’ı yeniden yazmak gerekmez:

| Katman | Dosyalar |
|--------|----------|
| Vision | `models/mock_vision.py`, `models/http_vision.py`, `models/interfaces.py` |
| LLM | `llm/mock_provider.py`, `llm/http_provider.py`, `llm/interfaces.py`, `llm/factory.py` |
| RAG | `rag/embedding_retriever.py`, `rag/vector_store.py` |
| Repo | `services/repository.py`, `services/sqlite_repository.py` (`SqlCaseRepository`), `storage/sql.py` |
| Jobs | `workers/job_backend.py` |
| Wiring | `container.py` (yalnızca bağlama) |
| Capabilities | `routing/capabilities.py`, `routing/remote_config.py` |

| Katman | Varsayılan (demo) | Gerçek şekilli | Klinik üretim |
|--------|-------------------|----------------|---------------|
| Vision | Mock fixture | HTTP remote adapter | Validate edilmiş GPU model + pixel pipeline |
| LLM | Mock | HTTP provider | Vendor LLM + privacy + audit |
| RAG | Hash / lexical seed | Aynı yüzey | Gerçek embed + vector DB |
| Jobs | Thread | RQ + Redis | Managed queue / K8s |
| Auth | Kapalı | JWT + API key | OAuth/SSO IdP |

---

## 18. Dokümantasyon indeksi

Tam liste ve hangi belgenin güncel olduğu: [docs/README.md](docs/README.md).

| Belge | Amaç |
|-------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Mimari, API, kalıcılık, frontend, güvenlik, demo |
| [docs/README.md](docs/README.md) | `docs/` dizini: güncel belgeler ve arşiv |
| [docs/modularization.md](docs/modularization.md) | Frontend/backend modül sınırları (`src/features`, `src/shared`) |
| [docs/ARCHITECTURE_MAP.md](docs/ARCHITECTURE_MAP.md) | Paket → API → FE mimari haritası |
| [docs/ARCHITECTURE_AND_LLM.md](docs/ARCHITECTURE_AND_LLM.md) | AI/LLM pipeline, mock↔real, eksikler |
| [docs/LLM_KATMANI.md](docs/LLM_KATMANI.md) | **LLM katmanı:** sağlayıcılar, prompt sürümleri, doğrulama/hakem, KVKK, değerlendirme, geri bildirim |
| [docs/ACIK_KAYNAK_ARASTIRMA.md](docs/ACIK_KAYNAK_ARASTIRMA.md) | Açık kaynak modeller, doğrulayıcılar, değerlendirme araçları, veri setleri — araştırma |
| [docs/MASTER_ROADMAP.md](docs/MASTER_ROADMAP.md) | Master engineering roadmap — workstream'ler, kabul kriterleri |
| [docs/ENGINEERING_STATUS.md](docs/ENGINEERING_STATUS.md) | Olgunluk skorları ve quality-gate listesi |
| [docs/TECHNICAL_DEBT.md](docs/TECHNICAL_DEBT.md) | Öncelikli teknik borç kaydı |
| [docs/RELEASE_READINESS.md](docs/RELEASE_READINESS.md) | Demo / protected / Goal A / Goal B GO–NO-GO |
| [docs/READINESS_GOALS.md](docs/READINESS_GOALS.md) | Goal A vs Goal B ayrımı (karıştırma) |
| [docs/PROTECTED_DEMO_RUNBOOK.md](docs/PROTECTED_DEMO_RUNBOOK.md) | Auth-on / protected demo runbook |
| [docs/TRAINING_EXPORT_RUNBOOK.md](docs/TRAINING_EXPORT_RUNBOOK.md) | Verify → training export runbook |
| [docs/MODEL_PROMOTION.md](docs/MODEL_PROMOTION.md) | Deneysel checkpoint promotion kuralları |
| [docs/INTEGRATION_PLAYBOOK.md](docs/INTEGRATION_PLAYBOOK.md) | AI/LLM/veri gelince bağlama (basit Türkçe) |
| [docs/HEDEF_MIMARI_GAP_ISSUE_LISTESI.md](docs/HEDEF_MIMARI_GAP_ISSUE_LISTESI.md) | Hedef mimari gap / issue listesi |
| [docs/arsiv/](docs/arsiv/) | Tarihsel faz raporları (PHASE_*), Ekim denetimleri, uygulanmamış planlar |
| [backend/eval/](backend/eval/) | Değerlendirme setleri; [results/README.md](backend/eval/results/README.md) hangi sonucun nerede kullanıldığını yazar |
| [backend/README.md](backend/README.md) | Backend env + API kısa özet |
| [backend/.env.example](backend/.env.example) | Ortam şablonu |

Davranış çelişkisi varsa kaynak kod esas alınır (`container.py`, `orchestrator.py`, API router’lar).

---

## 19. Uyarılar ve sonraki adımlar

**Kullanım uyarısı:** Bitirme prototipidir. Klinik karar, tanı veya tedavi önerisi olarak kullanılamaz. Korumalı klinik veri için auth, izolasyon, şifreleme, AV ve model validasyonu tamamlanmadan deploy edilmemelidir.

**LLM katmanı — yapılabilecekler** (bkz. [araştırma](docs/ACIK_KAYNAK_ARASTIRMA.md)):

| # | İş | Neden | Kim |
|---|----|-------|-----|
| 1 | **Referans raporlu test seti** — VRM uzmanlarının yazdığı gerçek (anonim) vakalar + referans rapor | GREEN tarzı klinik hata sayımı ve tezin "klinik doğruluk" sonucu için şart | Buğra + VRM |
| 2 | **GREEN tarzı referanslı değerlendirme** — üretilen rapor ↔ uzman raporu: uydurma / atlanan bulgu, yanlış konum, yanlış ciddiyet | Atıf kontrolünün ötesinde gerçek kalite ölçümü | Alperen |
| 3 | **Hakem doğruluğunu ölçmek** — hakem kararlarını uzman kararlarıyla karşılaştırmak; TurkMedNLI alt kümesiyle hakem model seçimi | Hakeme ne kadar güvenebileceğimizi bilmek | Alperen |
| 4 | **Türkçe veteriner terim sözlüğü** — İngilizce terimlerin (%3–9) Türkçe karşılıkları | Rapor dili tutarlılığı | Alperen + Buğra |
| 5 | **Uzman düzeltmeleriyle ince ayar (LoRA)** — `feedback/export?format=chat` hazır | Yeterli onaylı rapor biriktikçe model alana uyum sağlar | Alperen |
| 6 | **Sunucuda model** — vLLM + guidance/XGrammar ile yapılandırılmış çıktı; daha büyük model (Qwen 14B+) | Hız (dizüstünde ~1 dk/rapor) ve kalite | Beyza + Alperen |
| 7 | **Görüntü tarafı için MedGemma 4B** — açık, çok modlu tıbbi model (göğüs röntgeni rapor üretiminde güçlü) | Gerçek Vision bulguları | Beyza |
| 8 | Ollama bağlam penceresi (4096 token) — uzun öykü/çok pasajda `OLLAMA_CONTEXT_LENGTH` artırılmalı | Prompt sessizce kesilmesin | Beyza |

**Olası sonraki adımlar (platform):**

1. Gerçek şirket Vision / GPU serving (HTTP adapter üzerinde)  
2. ~~Anlamsal embedding + vektör veritabanı~~ → bge-m3 + pgvector (#101, #117; ChromaDB isteğe bağlı, #103)  
3. OAuth / SSO IdP  
4. Object storage quarantine + malware scan  
5. K8s / managed queue  
6. Daha zengin ilişkisel klinik şema (JSONB’den çıkış)  
7. Klinik validasyon ve regülasyon süreci (bu deponun dışında)  

---

*Son güncelleme: 2026-11-13 · Backend `0.2.0` · Phase 6 / 6.1 demo readiness · LLM katmanı (gerçek model, prompt v5) · DICOM sınıflandırıcı (Türkçe kurallar + LLM) · örnek vakalar · gerçek kullanıcı sistemi (#31) · 404 sayfası (#28)*
