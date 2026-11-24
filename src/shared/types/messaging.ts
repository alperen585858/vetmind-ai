export type SupportMessageChannel = 'radiologist' | 'admin'

export interface BackendSupportThreadSummary {
  thread_id: string
  channel: SupportMessageChannel
  owner_subject: string
  /** Direct recipient (a radiologist); null on the support channel. */
  recipient_subject?: string | null
  /** The other side of the conversation, from the viewer's point of view. */
  counterpart_name?: string | null
  counterpart_role?: string | null
  counterpart_online?: boolean
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
  /** Own messages: read by someone else in the conversation. */
  read_by_other?: boolean
  deleted?: boolean
  deleted_at?: string | null
  /** Set only for whoever deleted it, until the undo window closes. */
  restorable_until?: string | null
}

export interface BackendSupportThreadDetail {
  thread: BackendSupportThreadSummary
  messages: BackendSupportMessage[]
}

/** Someone the current user may start a conversation with. ``support`` = shared support inbox. */
export interface BackendMessageRecipient {
  subject: string
  display_name: string
  role: 'expert' | 'support' | string
  channel: SupportMessageChannel
}
