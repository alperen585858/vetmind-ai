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
