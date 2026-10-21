export type Role = 'vet' | 'expert' | 'owner' | 'admin'

export type CaseStatus =
  | 'taslak'
  | 'isleniyor'
  | 'ai_analizi'
  | 'uzman_incelemesinde'
  | 'onaylandi'
  | 'reddedildi'
  | 'revizyon'

export type Species = 'Köpek' | 'Kedi'
export type Priority = 'Acil' | 'Yüksek' | 'Normal'
export type Severity = 'Yüksek' | 'Orta' | 'Düşük'
export type DocType = 'MR Raporu' | 'BT Raporu' | 'Laboratuvar Sonucu' | 'Önceki Rapor'

export interface User {
  name: string
  title: string
  org: string
  initials: string
}

export interface Patient {
  name: string
  species: Species
  breed: string
  sex: 'Erkek' | 'Dişi'
  neutered: boolean
  age: number
  weight: number
  ownerName: string
  ownerPhone: string
}

export interface ClinicalInfo {
  complaint: string
  onset: 'Akut' | 'Kronik'
  course: 'Progresif' | 'Stabil' | 'İyileşen'
  history: string
  medications: string
}

export interface NeuroExam {
  consciousness: 'Uyanık' | 'Depresif' | 'Stupor' | 'Koma'
  gait: 'Normal' | 'Ataksi' | 'Parezi' | 'Pleji'
  limbs: string[]
  posturalThoracic: 'Normal' | 'Azalmış' | 'Yok'
  posturalPelvic: 'Normal' | 'Azalmış' | 'Yok'
  reflexThoracic: 'Normal' | 'Azalmış' | 'Artmış'
  reflexPelvic: 'Normal' | 'Azalmış' | 'Artmış'
  cranialNerves: string[]
  deepPain: 'Var' | 'Yok' | 'Değerlendirilmedi'
  hyperesthesia: 'Yok' | 'Servikal' | 'Torakolomber' | 'Lumbosakral'
}

export interface ExtractedField {
  field: string
  value: string
  source: string
}

export interface CaseDocument {
  id: string
  name: string
  type: DocType
  size: string
  pages: number
  rawText: string
  extracted: ExtractedField[]
}

export interface Finding {
  text: string
  severity: Severity
  citations?: number[]
}

export interface Differential {
  name: string
  probability: number
  pro: string[]
  con: string[]
  citations: number[]
}

export interface ValidationItem {
  kind: 'ok' | 'missing' | 'unsupported'
  text: string
  detail: string
  citations?: number[]
}

export interface AIAssessment {
  summary: string
  findings: Finding[]
  differentials: Differential[]
  recommendedTests: string[]
  validation: ValidationItem[]
  model: string
  generatedAt: string
}

export type SectionKey = 'klinikOzet' | 'bulgular' | 'degerlendirme' | 'ayiriciTanilar' | 'oneriler'
export type ReportSections = Record<SectionKey, string>

export type CorrectionCategory = 'Klinik hata' | 'Eksik bilgi' | 'Üslup' | 'Kaynak hatası'

export interface Correction {
  section: SectionKey
  before: string
  after: string
  category: CorrectionCategory
}

export interface TimelineEvent {
  date: string
  label: string
  by?: string
}

export interface VetCase {
  id: string
  no: string
  patient: Patient
  clinical: ClinicalInfo
  neuro: NeuroExam
  documents: CaseDocument[]
  status: CaseStatus
  module: string
  priority: Priority
  createdAt: string
  clinic: string
  vetName: string
  ai?: AIAssessment
  aiDraft?: ReportSections
  report?: ReportSections
  corrections: Correction[]
  timeline: TimelineEvent[]
  statusNote?: string
  approvedBy?: string
  approvedAt?: string
  reportNo?: string
  processingMs?: number
  processingStartedAt?: number
}

export interface KbSource {
  id: number
  title: string
  type: 'Kitap' | 'Bilimsel yayın' | 'VRM örnek rapor'
  section: string
  passage: string
  license: 'İzinli' | 'Beklemede'
  chunks: number
  indexedAt: string
  keywords: string[]
  indexing?: boolean
}
