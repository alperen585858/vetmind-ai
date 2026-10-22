# VetMind AI — Veteriner Teleradyoloji Demo

Acıbadem Üniversitesi CSE 401/402 bitirme projesi · VRM Teknoloji iş birliğiyle.

**Multimodal / multi-model AI destekli veteriner teleradyoloji platformu** prototipi. Platform radyoloğa yardımcı olur; otonom tanı koymaz.

> Klinik sistem değildir. Gerçek eğitilmiş Vision AI / VLM, ücretli LLM, PACS veya klinik validasyon **yoktur**. Mock çıktılar `MOCK` / `SYNTHETIC` etiketlidir ve uzman onayı gerektirir.

---

## Ne çalışıyor (güncel durum)

| Katman | Durum |
|--------|--------|
| Frontend (React + Vite + TS) | Giriş / kayıt (demo), DICOM sürükle-bırak + tarayıcı önizleme, vaka senkronu, uzman inceleme UI |
| Backend (FastAPI) | Case / Job / Findings / Report / Review API |
| DICOM | Metadata parse (pydicom), Study→Series→Instance, sınıflandırma + onay |
| AI | Deterministik mock Vision + mock LLM; `ImagingModel` + `ImagingModelInput` girdi paketi / LLM Gateway |
| DICOM viewer | W/L, dilim kaydırma, zoom/pan (görüntüleme; klinik PACS değil) |
| Router | Capability tabanlı (modality, bölge, tür) |
| Kalıcılık | SQLite JSON (`CaseRepository`); testlerde memory |
| Analiz | **Senkron** HTTP isteği içinde (`job_id` = koşu kimliği, kuyruk yok) |

### Henüz yok

PostgreSQL prod, async worker, gerçek model/GPU, ücretli LLM, PACS, şirket yazılımı entegrasyonu.

---

## Çalıştırma

Node.js 18+ · Python 3.11+

```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (ayrı terminal)
cd ..
npm install
npm run dev
```

- UI: http://localhost:5173  
- API / OpenAPI: http://127.0.0.1:8000/docs  
- Vite `/api` → backend `:8000`

Kalıcılık: varsayılan SQLite → `backend/data/vetmind.sqlite3`. Geçici: `VETMIND_STORAGE=memory`.

Backend ayrıntıları: [backend/README.md](backend/README.md).

---

## Önerilen demo akışı

1. **Giriş:** `vet@demo.local` / `demo1234` (veya kayıt ol).
2. Veteriner otomatik **DICOM Yükle** ekranına düşer → **Demo · Brain MRI** (veya `.dcm` sürükle) → sınıflandırmayı onayla → mock analiz.
3. **Vakalar** sayfasında **Backend’den yenile** ile SQLite’taki vakalar listelenir (restart sonrası da kalır).
4. İşleme ekranı → rol değiştir **Uzman Hekim** → taslağı incele / onayla.
4. İsteğe bağlı: **Yeni Vaka** ile eski yerel prototip veya sentetik mock senaryolar.

Diğer demo hesaplar (şifre `demo1234`): `expert@demo.local`, `owner@demo.local`, `admin@demo.local`.

---

## Mimari (hedef veri akışı)

```text
DICOM upload → metadata doğrulama / sınıflandırma (onay)
  → Model Router → Vision/VLM adapter(ler) [şimdi: mock]
  → Normalizer / Evidence Fusion → Structured Findings
  → LLM Gateway [şimdi: mock] → Draft Report → Validator
  → Radyolog inceleme → onay / ret / revizyon
```

Gerçek modeller adapter olarak eklenir; orchestrator yeniden yazılmaz.

---

## Teknoloji

- **Frontend:** React 18, TypeScript, Vite, Tailwind, React Router  
- **Backend:** Python, FastAPI, Pydantic, pydicom, SQLite  
- **Test:** pytest (`cd backend && pytest`)

---

## Klasörler

```text
src/           React UI (giriş, DICOM yükleme, vakalar, inceleme)
backend/app/   FastAPI (api, dicom, models, routing, orchestration, services)
backend/tests/ pytest
```
