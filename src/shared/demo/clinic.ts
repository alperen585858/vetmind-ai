// TÜM VERİLER DEMO AMAÇLIDIR. Gerçek hasta, kurum veya yayın bilgisi içermez.
import type { ClinicalInfo, DocType, NeuroExam, Patient, ReportSections } from '../types'
import { UNEVALUATED_NEURO } from '../lib/neuroExam'

export const CLINIC = ''


// "Örnek vaka ile doldur" butonunun kullandığı veri
export const SAMPLE_FORM = {
  patient: { name: 'Fındık', species: 'Köpek', breed: 'Beagle', sex: 'Dişi', neutered: true, age: 5, weight: 12, ownerName: 'Mehmet Yılmaz', ownerPhone: '0555 000 00 01' } as Patient,
  clinical: { complaint: 'Arka bacaklarda dün akşam başlayan güçsüzlük, sırtına dokunulunca ağrı, yürürken sendeleme', onset: 'Akut', course: 'Progresif', history: 'Daha önce benzer şikâyet yok. Aşıları güncel. Parkta yüksek bir yerden atladıktan sonra başladığı belirtiliyor.', medications: 'Meloksikam 0.1 mg/kg/gün (1 gündür)' } as ClinicalInfo,
  neuro: { consciousness: 'Uyanık', gait: 'Parezi', limbs: ['Sol arka', 'Sağ arka'], posturalThoracic: 'Normal', posturalPelvic: 'Azalmış', reflexThoracic: 'Normal', reflexPelvic: 'Artmış', cranialNervesStatus: 'Normal', cranialNerves: [], deepPain: 'Değerlendirilmedi', hyperesthesia: 'Torakolomber' } as NeuroExam,
  files: [
    { name: 'MR_raporu_Findik.pdf', type: 'MR Raporu' as DocType, size: '184 KB' },
    { name: 'Kan_tahlili_Findik.pdf', type: 'Laboratuvar Sonucu' as DocType, size: '96 KB' },
    { name: 'Onceki_muayene_notu.pdf', type: 'Önceki Rapor' as DocType, size: '121 KB' },
  ],
}

/** New-case form start state: nothing recorded yet (never pre-filled as normal, #72). */
export const EMPTY_NEURO = UNEVALUATED_NEURO

/** Turkish defaults for backward compatibility (non-React / legacy callers). */
export const SECTION_LABELS: Record<keyof ReportSections, string> = {
  klinikOzet: 'Teknik / Klinik özet',
  bulgular: 'Bulgular (Findings)',
  degerlendirme: 'Yorum / İzlenim (Interpretation & Impression)',
  ayiriciTanilar: 'Ayırıcı tanılar (opsiyonel)',
  oneriler: 'Öneriler (Recommendations)',
}

const SECTION_KEYS = Object.keys(SECTION_LABELS) as (keyof ReportSections)[]

/** Locale-aware section headings via `t('sections.*')`. */
export function getSectionLabels(t: (key: string) => string): Record<keyof ReportSections, string> {
  return Object.fromEntries(SECTION_KEYS.map((k) => [k, t(`sections.${k}`)])) as Record<
    keyof ReportSections,
    string
  >
}
