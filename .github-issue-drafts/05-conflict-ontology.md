## Özet

Evidence Fusion içindeki conflict detection hâlâ büyük ölçüde **normalized location string** (+ opsiyonel series UID) üzerinden. Finding code ontology, laterality ve SOP-anchor önceliği yetersiz → gerçek multi-model senaryoda false positive/negative.

**Kaynak:** `docs/HEDEF_MIMARI_GAP_ISSUE_LISTESI.md` → **ISS-FUS-01**, **ISS-FUS-02** · audit **F9**, **P8-R3** (P2)

## Mevcut durum

- `backend/app/models/normalizer.py`
  - `_conflict_group_key` = `location|series:{uid}` veya yalnız location
  - `detect_potential_conflicts`: distinct `finding_code` / opposing status
- Evidence refs: study/series/SOP UID + `frame_index` (`evidence_validation.py`) — F6 kapatıldı
- Series UID gruplama eklendi (Phase 7 kısmi); laterality / ontology yok

## Sorun

1. Aynı lezyon farklı location phrasing → conflict kaçabilir (false negative).
2. Aynı phrasing + farklı benign kodlar → aşırı flag (false positive).
3. Left/right / cranial-caudal laterality ayrılmıyor.
4. Diyagramdaki “Evidence Fusion + Provenance” klinik ensemble derinliğinde değil.

## Kabul kriterleri

- [ ] Conflict grouping öncelik sırası belgelensin ve kodlansın:
  1. SOP Instance UID + frame (varsa)
  2. Series UID + finding_code family
  3. Normalized location **soft** signal
- [ ] Laterality alanı (`LEFT`/`RIGHT`/`MIDLINE`/`UNKNOWN`) finding şemasına eklensin; çelişen laterality → conflict.
- [ ] Finding code family map (minimal): örn. `IVDD_*` aynı aile; aile içi severity farkı soft, aileler arası hard conflict.
- [ ] Findings **asla drop edilmez / auto-resolve edilmez** (mevcut sözleşme korunur).
- [ ] Pytest fixture seti:
  - divergent labels, same SOP → conflict
  - same label text, different series → no auto-conflict
  - opposing laterality → conflict
- [ ] UI: conflict listesinde group key / reason_codes görünsün.

## Teknik notlar

- Ontology map başlangıçta YAML/JSON config olabilir (`backend/app/models/finding_ontology.yaml`).
- REAL vs MOCK provenance fusion kuralları (`exclusive_real`) değişmemeli.

## Referans

- `docs/audits/01_AI_ARCHITECTURE.md` F9
- `docs/audits/PHASE_8_SECURITY_ASYNC.md` P8-R3
- `models/normalizer.py` `detect_potential_conflicts`
