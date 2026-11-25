<!-- Bu dosya otomatik üretilir; elle düzenlemeyin.
     Kaynak: backend/app/services/architecture_status.py
     Yeniden üretmek için: cd backend && python scripts/generate_architecture_doc.py -->

# VetMind AI — Yapay Zekâ Akışı

Yüklemeden onaylı rapora kadar AI akışı. Diyagram koddan üretilir: analiz adımları `orchestration/progress.py` içindeki `PIPELINE_STAGES` listesinden, router dalları `Modality` listesinden, modeller kayıtlı model tablosundan gelir. Kod değişince GitHub Action bu dosyayı yeniden üretir.

Renkler **varsayılan kurulumu** gösterir (`.env` yok: mock LLM, mock görüntü modelleri, hash embedding). Çalışan sistemin canlı durumu admin panelinde **AI Mimarisi** sayfasındadır.

```mermaid
flowchart TD
    upload("Dosya Yükleme<br/>DICOM · PDF · JPG · PNG · TXT")
    quarantine("Karantina<br/>SHA256 + manifest · virüs taraması kapalı")
    dicom_parser("DICOM Okuyucu<br/>pydicom · Study → Series → Instance")
    doc_parser("Doküman Okuyucu<br/>Metin çıkarma (OCR yok)")
    classifier("Tür / Modalite / Bölge Sınıflandırma<br/>Yalnızca kurallar")
    confirm("Kullanıcı Onayı<br/>Sınıflandırma onaylanınca vaka açılır")
    model_input("Model Girdisi Hazırlama<br/>Seri seçimi · görüntü kalitesi · piksel izni")
    router("AI Model Router<br/>Yalnızca gerçek modeller öncelikli")
    mri("MRI Modeli<br/>mock-brain-mri-v1 +2")
    ct("CT 3D Modeli<br/>mock-ct-3d-v1")
    xray("X-Ray Vision Modeli<br/>mock-xr-vision-v1")
    document("Multimodal VLM<br/>mock-multimodal-vlm-v1")
    findings("Yapılandırılmış Bulgular + Kanıt<br/>Normalize · birleştirme · kanıt görüntüleri")
    gateway("LLM Gateway<br/>KVKK maskeleme · prompt-injection temizleme · uzman dersleri")
    rag("RAG Bilgi Bankası<br/>hash · memory")
    llm("Rapor LLM<br/>Şablon (mock)")
    validation("Rapor Doğrulama<br/>ReportValidator + atıf kontrolü")
    review("Veteriner Radyolog İncelemesi<br/>Onay · red · revizyon")
    approved("Onaylı Rapor<br/>Değişmez sürüm → PDF")
    upload --> quarantine
    quarantine --> dicom_parser
    quarantine --> doc_parser
    dicom_parser --> classifier
    doc_parser --> classifier
    classifier --> confirm
    confirm --> model_input
    model_input --> router
    router -->|"MRI"| mri
    router -->|"CT"| ct
    router -->|"X-Ray"| xray
    router -->|"Görüntü + Metin"| document
    mri --> findings
    ct --> findings
    xray --> findings
    document --> findings
    rag -.-> gateway
    findings --> gateway
    gateway --> llm
    llm --> validation
    validation --> review
    review --> approved
    classDef active fill:#0b2a4a,stroke:#34d399,color:#cfe3ff,stroke-width:2px;
    classDef mock fill:#0b2a4a,stroke:#fbbf24,color:#cfe3ff,stroke-width:2px;
    classDef fallback fill:#0b2a4a,stroke:#f97316,color:#cfe3ff,stroke-width:2px;
    classDef off fill:#0a1e33,stroke:#64748b,color:#8fb3d9,stroke-dasharray:4 4;
    class upload,quarantine,dicom_parser,doc_parser,classifier,confirm,model_input,router,findings,gateway,rag,validation,review,approved active;
    class mri,ct,xray,document,llm mock;
```

🟢 Gerçek / her zaman çalışan adım · 🟡 Mock (sahte çıktı) · 🟠 Yedeğe düştü · ⚪ Kapalı / yapılandırılmamış

## Kod karşılıkları

| Kutu | Kod |
|------|-----|
| Dosya Yükleme | `api/dicom.py`, `api/documents.py` |
| Karantina | `storage/quarantine.py`, `storage/malware_scan.py`, `ingest/filetype.py` |
| DICOM Okuyucu | `dicom/parser.py`, `dicom/validator.py`, `dicom/ingest.py` |
| Doküman Okuyucu | `ingest/documents.py` |
| Tür / Modalite / Bölge Sınıflandırma | `dicom/classifier.py`, `dicom/llm_classifier.py` |
| Kullanıcı Onayı | `services/dicom_service.py` |
| Model Girdisi Hazırlama | `models/model_input_builder.py`, `imaging/series_selection.py`, `imaging/quality.py`, `models/pixel_authorization.py` |
| AI Model Router | `routing/model_router.py`, `routing/scenario_policy.py`, `routing/execution_policy.py`, `routing/capabilities.py` |
| Router dalları (MRI, CT, X-Ray, Görüntü + Metin) | `models/mock_vision.py`, `models/local_torch.py`, `models/vlm_vision.py`, `models/http_vision.py` |
| Yapılandırılmış Bulgular + Kanıt | `models/normalizer.py`, `models/evidence_attach.py` |
| LLM Gateway | `llm/gateway.py`, `llm/privacy.py`, `llm/lessons.py` |
| RAG Bilgi Bankası | `rag/retriever.py`, `rag/relevance.py`, `rag/chroma_store.py`, `rag/ollama_embeddings.py` |
| Rapor LLM | `llm/factory.py`, `llm/chat_providers.py`, `llm/verifier.py` |
| Rapor Doğrulama | `validation/report_validator.py`, `llm/grounding.py` |
| Veteriner Radyolog İncelemesi | `services/workflow_service.py`, `services/report_versioning.py` |
| Onaylı Rapor | `services/pdf_report.py` |

Akışı yöneten: `orchestration/orchestrator.py` (`AIOrchestrator.run`).
