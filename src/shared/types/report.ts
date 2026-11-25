import type { BackendDifferential } from './findings'
import type { BackendRagCitation } from './rag'

export type SectionKey = 'klinikOzet' | 'bulgular' | 'degerlendirme' | 'ayiriciTanilar' | 'oneriler'
export type ReportSections = Record<SectionKey, string>

export type CorrectionCategory = 'Klinik hata' | 'Eksik bilgi' | 'Üslup' | 'Kaynak hatası'

export interface Correction {
  section: SectionKey
  before: string
  after: string
  category: CorrectionCategory
}

export interface BackendDraftReport {
  report_id: string
  case_id: string
  status: string
  synthetic: boolean
  clinically_validated: boolean
  generation: {
    provider_id: string
    model_id: string
    model_version: string
    generated_at: string
    source_kind?: string
    synthetic?: boolean
    /** Set when drafted by a real prompt-based LLM; enables grounding warnings. */
    prompt_version?: string | null
    /** Expert revision lessons that were in this draft's prompt. */
    applied_lesson_ids?: string[]
  }
  technique: { text: string; cited_finding_ids: string[] }
  findings: { text: string; cited_finding_ids: string[] }
  impression: { text: string; cited_finding_ids: string[] }
  recommendations: { text: string; cited_finding_ids: string[] }
  validation_warnings: string[]
  expert_review_status?: string
  reviewer_comment?: string | null
  rag_citations?: BackendRagCitation[]
  /** When set, only these source_ids are "cited" (ISS-RAG-04). Empty/missing = legacy. */
  used_passage_ids?: string[]
  /** Inline citation alias → id, e.g. { F1: finding_id, S1: rag source_id }. */
  citation_map?: Record<string, string>
  /** Issue #108: change since the prior study (null = case has no patient record). */
  comparison?: import('./patient').BackendReportComparison | null
  differentials?: BackendDifferential[]
  /** Model text per section at generation time; unchanged by expert edits. */
  ai_sections?: Record<string, string>
  rag_note?: string
  version?: number
  created_at?: string
  updated_at?: string
  immutable?: boolean
  revision_notes?: string | null
  reviewed_by?: string | null
  /** Frozen at approve: selected overlays embedded in the approved PDF package. */
  evidence_figures?: BackendReportEvidenceFigure[]
}

export interface BackendReportEvidenceFigure {
  finding_id: string
  evidence_id: string
  origin?: 'ai_proposed' | 'vet_manual'
  overlay_ref: string
  overlay_content_sha256?: string
  caption?: string
  disclaimer?: string
  sop_instance_uid?: string | null
  frame_index?: number | null
}

export interface BackendReportVersionSummary {
  version: number
  report_id: string
  case_id: string
  created_at: string
  updated_at: string
  author_or_source: string
  status: string
  expert_review_status: string
  immutable: boolean
  revision_notes?: string | null
  reviewed_by?: string | null
  source_kind: string
  model_id: string
  model_version: string
  synthetic: boolean
  is_current: boolean
}

export interface BackendReportVersionSnapshot extends BackendReportVersionSummary {
  content: BackendDraftReport
}
