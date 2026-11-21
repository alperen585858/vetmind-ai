import type { Severity } from './case'

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
  /** Real LLM drafts: relative ranking label instead of a percentage. */
  likelihood?: DifferentialLikelihood
  /** Real LLM drafts: citation aliases (F1, S2) resolved via BackendDraftReport.citation_map. */
  aliases?: string[]
}

export type DifferentialLikelihood = 'high' | 'moderate' | 'low'

export interface BackendDifferential {
  name: string
  likelihood: DifferentialLikelihood
  supporting: string[]
  against: string[]
  citations: string[]
  finding_ids: string[]
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

export interface BackendEvidenceReference {
  evidence_id: string
  description: string
  evidence_type?: 'bbox' | 'segmentation_mask' | 'heatmap' | 'overlay'
  series_hint?: string | null
  study_instance_uid?: string | null
  series_instance_uid?: string | null
  sop_instance_uid?: string | null
  frame_index?: number | null
  mask_ref?: string | null
  mask_encoding?: string | null
  overlay_ref?: string | null
  heatmap_ref?: string | null
  bbox?: {
    x_min: number
    y_min: number
    x_max: number
    y_max: number
    coordinate_space?: string
    transform_chain?: { name: string; params: Record<string, number> }[]
  } | null
  origin?: 'ai_proposed' | 'vet_manual'
  review_status?: 'pending' | 'accepted' | 'rejected' | 'edited'
  include_in_report?: boolean
  reviewed_by?: string | null
  expert_verification_status?: 'unverified' | 'verified' | 'rejected'
  expert_verified_by?: string | null
  expert_verified_at?: string | null
  annotation_version?: string
  vet_note?: string | null
  supersedes_evidence_id?: string | null
  note?: string
}

export interface BackendFinding {
  finding_id: string
  finding_code: string
  description: string
  anatomical_location: string
  finding_status: string
  source_model: string
  source_model_version?: string | null
  requires_review: boolean
  synthetic: boolean
  laterality?: 'LEFT' | 'RIGHT' | 'MIDLINE' | 'UNKNOWN'
  conflict_group_id?: string | null
  model_confidence?: number | null
  evidence_references?: BackendEvidenceReference[]
  uncertainty_note?: string | null
}

export interface BackendSeriesCoverage {
  series_instance_uid?: string | null
  series_description?: string | null
  is_localizer?: boolean
  frames_detected: number
  frames_planned: number
  frames_decoded?: number
  frames_visually_analyzed: number
  analyzed?: boolean
}

/** Honest visual-analysis scope — never treat metadata inventory as pixel analysis. */
export interface BackendAnalysisCoverage {
  dicom_files_total: number
  dicom_files_undecodable: number
  series_total: number
  series_analyzed: number
  frames_detected: number
  frames_detected_non_localizer: number
  frames_planned: number
  frames_decode_attempted?: number
  frames_decoded?: number
  frames_visually_analyzed: number
  frames_skipped: number
  batches_total: number
  batches_succeeded: number
  batches_failed: number
  per_batch_image_cap: number
  total_frame_budget: number
  include_localizers: boolean
  analysis_scope: 'full' | 'partial' | 'none'
  analysis_complete: boolean
  note?: string
  series?: BackendSeriesCoverage[]
  skipped_files?: { path: string; reason: string }[]
}

export interface BackendFindings {
  schema_version: string
  case_id: string
  source_model_id: string
  source_kind: string
  execution_status: string
  findings: BackendFinding[]
  warnings: string[]
  no_findings_returned: boolean
  absences_not_confirmed: boolean
  review_required: boolean
  contributing_model_ids?: string[]
  contributing_source_kinds?: string[]
  processing_metadata?: Record<string, string>
  analysis_coverage?: BackendAnalysisCoverage | null
  potential_conflicts?: {
    conflict_id: string
    finding_ids: string[]
    anatomical_location_key: string
    reason: string
    reason_codes?: string[]
    group_key?: string | null
    note: string
  }[]
}
