import type {
  BackendAnatomicalRegion,
  BackendModality,
  BackendSpecies,
  DicomDemoKind,
  DicomStudyMeta,
} from './dicom'
import type { AIAssessment, BackendFindings } from './findings'
import type {
  BackendDraftReport,
  BackendReportVersionSnapshot,
  BackendReportVersionSummary,
  Correction,
  ReportSections,
} from './report'
import type { BackendAttachmentRef, BackendClinicalNoteEntry, BackendInfoRequest } from './workflow'

export type CaseStatus =
  | 'taslak'
  | 'isleniyor'
  | 'ai_analizi'
  | 'uzman_incelemesinde'
  | 'onaylandi'
  | 'reddedildi'
  | 'revizyon'
  /** Mock/FastAPI adapter failure — not an expert-requested revision. */
  | 'analiz_basarisiz'
  /** Unsupported modality/region — manual review, no approvable AI draft. */
  | 'manuel_inceleme'

export type Species = 'Köpek' | 'Kedi' | 'Diğer'
export type Priority = 'STAT' | 'Acil' | 'Yüksek' | 'Normal'
export type Severity = 'Yüksek' | 'Orta' | 'Düşük'
export type DocType = 'MR Raporu' | 'BT Raporu' | 'Laboratuvar Sonucu' | 'Önceki Rapor'

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

/** "Not evaluated" — the vet did not record this item (never read it as a normal finding). */
export type NotEvaluated = 'Değerlendirilmedi'

export interface NeuroExam {
  consciousness: 'Uyanık' | 'Depresif' | 'Stupor' | 'Koma' | NotEvaluated
  gait: 'Normal' | 'Ataksi' | 'Parezi' | 'Pleji' | NotEvaluated
  limbs: string[]
  posturalThoracic: 'Normal' | 'Azalmış' | 'Yok' | NotEvaluated
  posturalPelvic: 'Normal' | 'Azalmış' | 'Yok' | NotEvaluated
  reflexThoracic: 'Normal' | 'Azalmış' | 'Artmış' | NotEvaluated
  reflexPelvic: 'Normal' | 'Azalmış' | 'Artmış' | NotEvaluated
  /** Whether cranial nerves were examined; the abnormal signs are in `cranialNerves`. */
  cranialNervesStatus: 'Normal' | 'Bulgu var' | NotEvaluated
  cranialNerves: string[]
  deepPain: 'Var' | 'Yok' | NotEvaluated
  hyperesthesia: 'Yok' | 'Servikal' | 'Torakolomber' | 'Lumbosakral' | NotEvaluated
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

export interface TimelineEvent {
  date: string
  label: string
  by?: string
}

export interface BackendReviewFeedback {
  reviewer_id: string
  action: string
  comment?: string | null
}

export interface BackendPipelineResult {
  outcome: 'success' | 'partial' | 'unsupported' | 'failed'
  job: { job_id: string; case_id: string; status: string; routed_model_ids: string[]; route_reason?: string | null; error_message?: string | null }
  findings: BackendFindings | null
  report: BackendDraftReport | null
  messages: string[]
}

export type BackendCasePriority = 'normal' | 'high' | 'urgent' | 'stat'

export interface BackendCaseMessage {
  message_id: string
  case_id: string
  author_id: string
  author_role: string
  body: string
  created_at: string
  unread: boolean
}

export interface ClinicDashboardStats {
  active_cases: number
  awaiting_review: number
  urgent_cases: number
  completed_reports: number
  unread_messages: number
}

export interface BackendStructuredClinicalHistory {
  complaint?: string | null
  onset?: string | null
  course?: string | null
  medications?: string | null
  relevant_history?: string | null
  handoff_notes?: string | null
  sex?: string | null
  weight_kg?: number | null
  neutered?: boolean | null
  neuro_exam?: Record<string, string | string[] | boolean | number | null> | null
}

export interface BackendCaseSummary {
  case_id: string
  patient_name: string
  species: BackendSpecies
  breed?: string | null
  patient_age_years?: number | null
  complaint?: string | null
  modality: BackendModality
  anatomical_region: BackendAnatomicalRegion
  status: string
  priority?: BackendCasePriority
  assigned_reviewer_id?: string | null
  awaiting_review_since?: string | null
  review_due_at?: string | null
  scenario?: string | null
  created_at: string
  latest_job_id?: string | null
  classification_confirmed?: boolean
  study_instance_uid?: string | null
  series_count?: number | null
  instance_count?: number | null
  owner_subject?: string | null
  clinic_id?: string | null
  referring_clinic?: string | null
  unread_messages?: number
  report_available_at?: string | null
  report_delivered_at?: string | null
  report_viewed_at?: string | null
  pet_id?: string | null
  pet_owner_subject?: string | null
  owner_contact_name?: string | null
  owner_contact_email?: string | null
  owner_email_consent?: boolean
  owner_email_delivery_status?: string | null
  submission_id?: string | null
  vet_verified?: boolean
  current_report_version?: number | null
  report_version_count?: number
}

export interface BackendCaseRecord {
  case_id: string
  created_at: string
  updated_at: string
  status: string
  patient_name: string
  species: BackendSpecies
  breed?: string | null
  patient_age_years?: number | null
  modality: BackendModality
  anatomical_region: BackendAnatomicalRegion
  clinical_history?: string | null
  clinical_history_structured?: BackendStructuredClinicalHistory | null
  priority?: BackendCasePriority
  assigned_reviewer_id?: string | null
  awaiting_review_since?: string | null
  review_due_at?: string | null
  scenario?: string | null
  referring_clinic?: string | null
  /** Phase 5 ownership — null in demo / legacy rows. */
  owner_subject?: string | null
  clinic_id?: string | null
  classification_confirmed: boolean
  latest_job_id?: string | null
  pet_id?: string | null
  pet_owner_subject?: string | null
  owner_contact_name?: string | null
  owner_contact_email?: string | null
  owner_email_consent?: boolean
  owner_email_delivery_status?: string | null
  owner_email_delivery_detail?: string | null
  submission_id?: string | null
  vet_verified?: boolean
  structured_findings?: BackendFindings | null
  draft_report?: BackendDraftReport | null
  /**
   * Embedded on GET /cases/{id} as full snapshots (may omit is_current).
   * List endpoint /report/versions returns summaries with is_current.
   */
  report_versions?: Array<BackendReportVersionSummary | BackendReportVersionSnapshot>
  current_report_version?: number | null
  review_history?: BackendReviewFeedback[]
  messages?: BackendCaseMessage[]
  report_available_at?: string | null
  report_delivered_at?: string | null
  report_viewed_at?: string | null
  dicom_study?: DicomStudyMeta | null
  dicom_ingest_id?: string | null
  study: {
    study_id?: string | null
    study_instance_uid?: string | null
    description?: string | null
    accession?: string | null
    dicom_available: boolean
    metadata_only?: boolean
    series_count?: number | null
    instance_count?: number | null
    classification_confidence?: string | null
  }
  clinical_notes_log?: BackendClinicalNoteEntry[]
  internal_notes?: BackendClinicalNoteEntry[]
  info_requests?: BackendInfoRequest[]
  attachment_refs?: BackendAttachmentRef[]
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
  backendCaseId?: string
  backendJobId?: string
  backendOutcome?: BackendPipelineResult['outcome']
  backendFindings?: BackendFindings
  backendDraft?: BackendDraftReport
  assignedReviewerId?: string
  /** When expert review queue clock started (ISO). */
  awaitingReviewSince?: string
  /** Expert response deadline (ISO). Urgent/STAT=24h, else=48h. */
  reviewDueAt?: string
  handoffNotes?: string
  reportVersions?: BackendReportVersionSummary[]
  currentReportVersion?: number
  /** Number of report versions (from list summary); >1 means revised. */
  reportVersionCount?: number
  unreadMessages?: number
  reportAvailableAt?: string
  reportDeliveredAt?: string
  reportViewedAt?: string
  /** True when this row was loaded/synced from FastAPI (SQLite). */
  fromBackend?: boolean
  /** Demo fixture kind used at ingest — for case-detail viewer reload (display only). */
  dicomDemoKind?: DicomDemoKind
  /** Imaging metadata from backend summary/record (never invented). */
  modality?: BackendModality | string
  anatomicalRegion?: BackendAnatomicalRegion | string
  classificationConfirmed?: boolean
  studyInstanceUid?: string
  seriesCount?: number
  instanceCount?: number
  /** Phase 14 — pet owner subject (email) for ACL / Sahip display. */
  petOwnerSubject?: string
  petId?: string
  submissionId?: string
  ownerContactName?: string
  ownerContactEmail?: string
  ownerEmailConsent?: boolean
  ownerEmailDeliveryStatus?: string
  ownerEmailDeliveryDetail?: string
}
