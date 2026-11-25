# VetMind AI — Yapay Zekâ Akışı

Yüklemeden onaylı rapora kadar kodda gerçekten çalışan AI akışı. Kesik çizgiler opsiyonel / yan girdileri gösterir.

```mermaid
flowchart TD
    A("Drag & Drop Upload<br/>DICOM · PDF · JPG · PNG") --> B("Upload API<br/>Malware Scan + Quarantine Storage<br/>SHA256 + manifest")
    B --> C("File Type Detector")
    C --> D("DICOM Metadata Parser + Validator<br/>pydicom · Study → Series → Instance")
    C --> E("PDF / JPG / PNG / Text Parser")
    D --> F("Species / Modality / Body Region Classifier<br/>kurallar + opsiyonel LLM")
    E --> F
    F --> G("Kullanıcı Onayı<br/>sınıflandırma onayı → Vaka")
    G --> H("Model Input Builder<br/>seri seçimi · görüntü kalitesi · piksel izni")
    H --> R("AI Model Router<br/>capability → senaryo → execution policy")

    R -->|X-Ray| X("X-Ray Vision Model<br/>DenseNet121 TorchXRayVision + MONAI<br/>veya mock")
    R -->|CT| CT("CT 3D Model<br/>MONAI entrypoint veya mock")
    R -->|MRI| M("MRI Model<br/>beyin · servikal · TL<br/>MONAI entrypoint veya mock")
    R -->|Image + Text| V("Multimodal VLM<br/>OpenAI-uyumlu VLM")
    R -.->|Remote| HV("HTTP Remote Vision")
    R -.->|Desteklenmiyor| MRV("Manual Review<br/>AI taslağı üretilmez")

    X --> N("Structured Findings + Evidence<br/>normalize · fusion · çatışma ipuçları<br/>kanıt görüntüleri")
    CT --> N
    M --> N
    V --> N
    HV --> N

    N --> L("LLM Gateway<br/>KVKK maskeleme · prompt-injection temizleme<br/>uzman dersleri")
    RAG[("RAG<br/>bge-m3 / hash embedding · ChromaDB<br/>kaynak kartları · bölge/tür filtresi")] -.-> L
    L --> LLM("Veterinary LLM<br/>Ollama qwen2.5 · OpenAI-uyumlu · Claude · mock<br/>taslak → onarım → ayırıcı tanılar → hakem")
    LLM --> VAL("Report Validation<br/>ReportValidator + atıf grounding")
    VAL --> RR("Veteriner Radyolog İncelemesi<br/>onay · red · revizyon")
    RR -.->|"Yapay zekâ ile yeniden yaz"| L
    RR --> OK("Onaylı Rapor<br/>değişmez sürüm → PDF")
    RR -.->|"geri bildirim veri seti · dersler"| FB[("Uzman Geri Bildirimi")]
    FB -.-> L

    classDef box fill:#0b2a4a,stroke:#1e4d7a,color:#cfe3ff;
    classDef router fill:#06182b,stroke:#3b6ea5,color:#cfe3ff,stroke-dasharray:3 3;
    classDef store fill:#0b2a4a,stroke:#3b6ea5,color:#cfe3ff;
    classDef optional fill:#0b2a4a,stroke:#1e4d7a,color:#8fb3d9,stroke-dasharray:4 4;
    class A,B,C,D,E,F,G,H,X,CT,M,V,N,L,LLM,VAL,RR,OK box;
    class R router;
    class RAG,FB store;
    class HV,MRV optional;
```

## Kod karşılıkları

| Kutu | Kod |
|------|-----|
| Upload API / Quarantine | `api/dicom.py`, `api/documents.py`, `storage/quarantine.py`, `storage/malware_scan.py` |
| File Type Detector | `ingest/filetype.py` |
| DICOM Parser / Validator | `dicom/parser.py`, `dicom/validator.py`, `dicom/ingest.py` |
| Doküman Parser | `ingest/documents.py` |
| Classifier | `dicom/classifier.py`, `dicom/llm_classifier.py` |
| Model Input Builder | `models/model_input_builder.py`, `imaging/series_selection.py`, `imaging/quality.py`, `models/pixel_authorization.py` |
| AI Model Router | `routing/model_router.py`, `routing/scenario_policy.py`, `routing/execution_policy.py`, `routing/capabilities.py` |
| X-Ray / CT / MRI | `models/local_torch.py`, `models/entrypoints/{xray,ct,mri}_monai.py`, `models/mock_vision.py` |
| Multimodal VLM | `models/vlm_vision.py` |
| HTTP Remote Vision | `models/http_vision.py` |
| Structured Findings + Evidence | `models/normalizer.py`, `models/evidence_attach.py` |
| LLM Gateway | `llm/gateway.py`, `llm/privacy.py`, `llm/lessons.py` |
| RAG | `rag/retriever.py`, `rag/relevance.py`, `rag/chroma_store.py`, `rag/ollama_embeddings.py` |
| Veterinary LLM | `llm/factory.py`, `llm/chat_providers.py`, `llm/verifier.py` |
| Report Validation | `validation/report_validator.py`, `llm/grounding.py` |
| Akışı yöneten | `orchestration/orchestrator.py` (`AIOrchestrator.run`) |
