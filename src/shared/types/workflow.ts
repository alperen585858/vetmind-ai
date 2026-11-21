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

export interface BackendManagedUser {
  email: string
  role: string
  clinic_id?: string | null
  display_name?: string | null
  active: boolean
  created_at?: string | null
  last_login_at?: string | null
}

export interface BackendClinicStats {
  clinic_id: string
  case_count: number
  awaiting_review: number
  approved: number
  pending_submissions: number
  staff: BackendManagedUser[]
}
