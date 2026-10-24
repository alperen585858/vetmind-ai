export type Role = 'vet' | 'expert' | 'owner' | 'clinic_owner' | 'admin'

export interface BackendPet {
  pet_id: string
  owner_subject: string
  clinic_id?: string | null
  name: string
  species: string
  breed?: string | null
  age_years?: number | null
  sex?: string | null
  medical_history?: string | null
  created_at: string
  updated_at: string
}

export type BackendSubmissionStatus =
  | 'draft'
  | 'pending_verification'
  | 'needs_info'
  | 'verified'
  | 'rejected'
  | 'linked'

export type InfoRequestStatus = 'OPEN' | 'ANSWERED' | 'CLOSED'

export interface BackendInfoRequest {
  request_id: string
  status: InfoRequestStatus
  from_role: string
  from_subject: string
  to_role: string
  body: string
  reply?: string | null
  created_at: string
  answered_at?: string | null
  closed_at?: string | null
}

export interface BackendAttachmentRef {
  attachment_id: string
  kind: 'dicom' | 'document'
  ingest_id: string
  uploaded_by: string
  created_at: string
  label?: string | null
}

export interface BackendClinicalNoteEntry {
  note_id: string
  body: string
  author_subject: string
  author_role: string
  created_at: string
  kind: 'clinical' | 'internal'
}

export interface BackendImagingSubmission {
  submission_id: string
  pet_id: string
  pet_owner_subject: string
  clinic_id?: string | null
  status: BackendSubmissionStatus
  chief_complaint?: string | null
  clinical_notes?: string | null
  dicom_ingest_id?: string | null
  document_ingest_id?: string | null
  vet_notes?: string | null
  missing_info_request?: string | null
  assigned_reviewer_id?: string | null
  linked_case_id?: string | null
  verified_by?: string | null
  verified_at?: string | null
  payment_id?: string | null
  payment_status?: 'requires_confirmation' | 'approved' | 'failed' | null
  attachments?: BackendAttachmentRef[]
  info_requests?: BackendInfoRequest[]
  created_at: string
  updated_at: string
}

export interface BackendDemoPayment {
  payment_id: string
  submission_id: string
  amount: number
  currency: 'EUR'
  mode: 'demo'
  status: 'requires_confirmation' | 'approved' | 'failed'
  owner_subject: string
  clinic_id?: string | null
  created_at: string
  updated_at: string
  approved_at?: string | null
}

export interface BackendDemoPaymentConfirmResponse {
  payment: BackendDemoPayment
  message: string
  submission_finalized: boolean
  submission_id?: string | null
  submission_status?: string | null
}

export interface BackendManagedUser {
  email: string
  role: string
  clinic_id?: string | null
  display_name?: string | null
  active: boolean
  password?: string | null
}

export interface BackendClinicStats {
  clinic_id: string
  case_count: number
  awaiting_review: number
  approved: number
  pending_submissions: number
  staff: BackendManagedUser[]
}

export type SupportMessageChannel = 'radiologist' | 'admin'

export interface BackendSupportThreadSummary {
  thread_id: string
  channel: SupportMessageChannel
  owner_subject: string
  clinic_id?: string | null
  subject: string
  status: 'open' | 'closed'
  related_case_id?: string | null
  related_submission_id?: string | null
  message_count: number
  unread_count: number
  last_message_preview?: string | null
  last_message_at?: string | null
  created_at: string
  updated_at: string
}

export interface BackendSupportMessage {
  message_id: string
  author_subject: string
  author_role: string
  body: string
  created_at: string
  unread: boolean
}

export interface BackendSupportThreadDetail {
  thread: BackendSupportThreadSummary
  messages: BackendSupportMessage[]
}

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

export type Species = 'Köpek' | 'Kedi'
export type Priority = 'STAT' | 'Acil' | 'Yüksek' | 'Normal'
export type Severity = 'Yüksek' | 'Orta' | 'Düşük'
export type DocType = 'MR Raporu' | 'BT Raporu' | 'Laboratuvar Sonucu' | 'Önceki Rapor'

export interface User {
  name: string
  title: string
  org: string
  initials: string
  /** Demo / backend subject (e.g. owner@demo.local) when known. */
  email?: string
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

export type BackendScenario =
  | 'brain_mri_suspected'
  | 'cervical_mri_suspected'
  | 'ct_brain_suspected'
  | 'xr_thorax_suspected'
  | 'document_context'
  | 'no_findings'
  | 'unsupported'
  | 'model_failure'
  | 'conflicting'

export type DicomDemoKind = 'brain_mri' | 'cervical_mri' | 'brain_ct' | 'thorax_xr'

export type BackendSpecies = 'canine' | 'feline' | 'other'

export interface BackendFinding {
  finding_id: string
  finding_code: string
  description: string
  anatomical_location: string
  finding_status: string
  source_model: string
  requires_review: boolean
  synthetic: boolean
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
  potential_conflicts?: {
    conflict_id: string
    finding_ids: string[]
    anatomical_location_key: string
    reason: string
    note: string
  }[]
}

export interface BackendRagCitation {
  source_id: string
  title: string
  section: string
  passage: string
  score: number
  keywords?: string[]
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
  }
  technique: { text: string; cited_finding_ids: string[] }
  findings: { text: string; cited_finding_ids: string[] }
  impression: { text: string; cited_finding_ids: string[] }
  recommendations: { text: string; cited_finding_ids: string[] }
  validation_warnings: string[]
  expert_review_status?: string
  reviewer_comment?: string | null
  rag_citations?: BackendRagCitation[]
  rag_note?: string
  version?: number
  created_at?: string
  updated_at?: string
  immutable?: boolean
  revision_notes?: string | null
  reviewed_by?: string | null
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

export type BackendModality = 'MR' | 'CT' | 'XR' | 'OTHER'
export type BackendAnatomicalRegion = 'BRAIN' | 'CERVICAL' | 'THORAX' | 'OTHER' | 'UNKNOWN'
export type ClassificationConfidence = 'high' | 'medium' | 'low' | 'unknown'

export interface DicomValidationIssue {
  code: string
  severity: 'error' | 'warning'
  message: string
  filename?: string | null
  sop_instance_uid?: string | null
}

export interface ClassificationSuggestion {
  suggested_modality: BackendModality
  suggested_anatomical_region: BackendAnatomicalRegion
  confidence: ClassificationConfidence
  needs_confirmation: boolean
  rationale: string[]
  source_tags: Record<string, string | null>
  note: string
}

export interface DicomStudyMeta {
  schema_version: string
  study_instance_uid: string
  study_description?: string | null
  accession_number?: string | null
  series: {
    series_instance_uid: string
    modality?: BackendModality | null
    series_description?: string | null
    body_part_examined?: string | null
    instances: { sop_instance_uid: string; filename?: string | null; has_pixel_data: boolean; pixel_data_analyzed: boolean }[]
  }[]
}

export interface DicomUploadResponse {
  ingest_id: string
  blocked: boolean
  block_reason?: string | null
  issues: DicomValidationIssue[]
  study: DicomStudyMeta | null
  classification: ClassificationSuggestion | null
  quarantine_dir?: string | null
  quarantined_file_count?: number
  note: string
}

export interface DicomQuarantineFileRef {
  original_filename: string
  stored_filename: string
  relative_path: string
  size_bytes: number
  sha256: string
  content_kind: string
}

/** Full ingest record from GET /dicom/ingestions/{id} (owner-readable when owned). */
export interface DicomIngestionRecord {
  ingest_id: string
  created_at: string
  patient_name: string
  species: string
  breed?: string | null
  clinical_history?: string | null
  referring_clinic?: string | null
  owner_subject?: string | null
  clinic_id?: string | null
  study: DicomStudyMeta | null
  issues: DicomValidationIssue[]
  classification: ClassificationSuggestion | null
  accepted: boolean
  case_id?: string | null
  blocked: boolean
  block_reason?: string | null
  quarantine_dir?: string | null
  quarantined_files: DicomQuarantineFileRef[]
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
}

export interface BackendCaseSummary {
  case_id: string
  patient_name: string
  species: BackendSpecies
  breed?: string | null
  patient_age_years?: number | null
  modality: BackendModality
  anatomical_region: BackendAnatomicalRegion
  status: string
  priority?: BackendCasePriority
  assigned_reviewer_id?: string | null
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
  submission_id?: string | null
  vet_verified?: boolean
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
  scenario?: string | null
  referring_clinic?: string | null
  /** Phase 5 ownership — null in demo / legacy rows. */
  owner_subject?: string | null
  clinic_id?: string | null
  classification_confirmed: boolean
  latest_job_id?: string | null
  pet_id?: string | null
  pet_owner_subject?: string | null
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
  handoffNotes?: string
  reportVersions?: BackendReportVersionSummary[]
  currentReportVersion?: number
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
