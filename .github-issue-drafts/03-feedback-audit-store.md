## Özet

Hedef mimarideki **Feedback / Audit Store** kutusu eksik. Security JSONL ve `ReviewFeedback` history var; reject/revision çıktılarından model iyileştirme / training-signal döngüsü yok.

**Kaynak:** `docs/HEDEF_MIMARI_GAP_ISSUE_LISTESI.md` → **ISS-AUD-01** (P1), kısmen **ISS-AUD-02**

## Mevcut durum

- Security audit: `backend/app/security/audit.py` (JSONL; auth/resource olayları)
- Review: `ReviewFeedback` on `CaseRecord.review_history` (approve / reject / revision)
- Onaylı rapor: immutable versioning (`report_versioning.py`)
- Model drift / feedback dataset / export pipeline: **yok**

## Sorun

1. Radyolog reject/revision gerekçesi structured training signal’e dönüşmüyor.
2. Hangi model_id / finding / evidence’ın reddedildiği sorguulamıyor.
3. Diyagramdaki Feedback Store → iyileştirme döngüsü kopuk.

## Önerilen tasarım (minimal)

Yeni append-only store (ör. `data/feedback/feedback.jsonl` veya repo tablosu):

```text
FeedbackEvent
  event_id, case_id, report_version_id
  actor, clinic_id
  decision: approve | reject | revision
  reason_codes[], free_text (redacted)
  snapshot_refs:
    model_ids[], finding_ids[], source_kind, rag_passage_ids[]
  created_at
```

- PHI / piksel / ham DICOM path yazılmasın.
- Export endpoint (admin): `GET /api/v1/feedback/export` (auth zorunlu).

## Kabul kriterleri

- [ ] Reject / revision (ve opsiyonel approve) `FeedbackEvent` üretir.
- [ ] Event’te model_id + finding_id + source_kind snapshot’ı vardır.
- [ ] Security audit’ten ayrı kanal; karışmaz.
- [ ] Admin-only list/export API + pytest (tenant izolasyonu).
- [ ] FE ExpertReview’da reason code seçimi (en az 3 kod: wrong_finding, missing_finding, report_quality).
- [ ] Docs: Feedback Store diyagram düğümü bu store’a map edilir.

## Out of scope

Otomatik model retrain, RLHF pipeline, klinik validasyon bayrağının açılması.
