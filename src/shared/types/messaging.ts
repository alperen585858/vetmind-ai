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
