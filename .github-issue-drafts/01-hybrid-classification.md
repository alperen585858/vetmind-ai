## Özet

Hedef mimarideki **Hybrid Classification** kutusu şu an yalnızca DICOM metadata + token kurallarına dayanıyor. Vision / LLM destekli hibrit sınıflandırma yok; diyagram vaadiyle uyumsuz.

**Kaynak:** `docs/HEDEF_MIMARI_GAP_ISSUE_LISTESI.md` → **ISS-CLS-01** (P1)

## Mevcut durum

- Sınıflandırıcı: `backend/app/dicom/classifier.py`
- Açıkça belirtilmiş: *“No LLM. Missing values are never invented.”*
- Girdi: `DicomStudyMeta` (Modality, StudyDescription, SeriesDescription, PatientSpeciesDescription vb.)
- Çıktı: `ClassificationSuggestion` (species / modality / anatomical_region + confidence + status)
- Desteklenen modaliteler: `MR`, `CT`, `XR` → diğerleri `MANUAL_REVIEW`
- Kullanıcı onayı: `POST .../ingestions/{id}/confirm` zorunlu (iyi)

## Sorun

1. İsim “Hybrid” ama ikinci sinyal (piksel / küçük classifier / VLM) yok.
2. Token eşleştirme (`BRAIN`, `THORAX`, …) yanlış etiketli DICOM’da düşük güven üretir; vision-assisted düzeltme yok.
3. Confirm sonrası feedback (yanlış öneri → doğru etiket) modele geri yazılmıyor.

## Kabul kriterleri

- [ ] Classification pipeline’da en az **iki bağımsız sinyal** birleştirilsin (ör. metadata rules + lightweight modality/region hint adapter).
- [ ] Hibrit skor / disagreement `ClassificationSuggestion` üzerinde şeffaf alanlarla görünsün (`signals[]`, `disagreement: bool`).
- [ ] Metadata-only fallback korunsun; ikinci sinyal yoksa mevcut davranış bozulmasın.
- [ ] Pytest: çelişen metadata vs hint → `LOW`/`AMBIGUOUS` + insan onayı zorunlu.
- [ ] Diyagram / docs metni gerçek davranışla hizalansın (veya isim “Metadata Classification” olarak düzeltilsin — tercih: gerçek hybrid).

## Teknik notlar

- Pixel yolu default-deny; hibrit hint adapter da `source_kind` / `synthetic` provenance taşısın.
- `AIOrchestrator` routing’i classification confirm sonrası çalışmaya devam etmeli.
- Referans: `docs/ARCHITECTURE_AND_LLM.md` §3, hedef diyagram Hybrid Classification düğümü.

## Out of scope

Eğitilmiş klinik vision modelinin kendisi (BOUNDARY). Bu issue yalnızca classification hibritleştirme iskeleti / ikinci sinyal.
