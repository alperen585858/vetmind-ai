import { request } from './client'

export async function listCaseMessages(
  caseId: string,
): Promise<import('../types').BackendCaseMessage[]> {
  return request(`/cases/${caseId}/messages`)
}

export interface AiChatTurn {
  role: 'user' | 'assistant'
  content: string
  created_at?: string
  author_id?: string | null
}

export interface AiChatResponse {
  case_id: string
  reply: string
  history: AiChatTurn[]
  provider: string
  note?: string
}

export async function listCaseAiChat(caseId: string): Promise<AiChatTurn[]> {
  return request(`/cases/${encodeURIComponent(caseId)}/ai-chat`)
}

export async function askCaseAiChat(
  caseId: string,
  message: string,
  opts?: { signal?: AbortSignal },
): Promise<AiChatResponse> {
  return request(`/cases/${encodeURIComponent(caseId)}/ai-chat`, {
    method: 'POST',
    body: JSON.stringify({ message }),
    signal: opts?.signal,
  })
}

export async function clearCaseAiChat(caseId: string): Promise<AiChatTurn[]> {
  return request(`/cases/${encodeURIComponent(caseId)}/ai-chat`, { method: 'DELETE' })
}

export async function postCaseMessage(
  caseId: string,
  body: string,
): Promise<import('../types').BackendCaseMessage> {
  return request(`/cases/${caseId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export async function markCaseMessagesRead(
  caseId: string,
): Promise<import('../types').BackendCaseMessage[]> {
  return request(`/cases/${caseId}/messages/read`, { method: 'POST' })
}

// --- Phase 17 functional expansion ---

export interface AppNotification {
  notification_id: string
  recipient_subject: string
  kind: string
  title: string
  body: string
  link_path: string
  case_id?: string | null
  submission_id?: string | null
  clinic_id?: string | null
  dedupe_key: string
  created_at: string
  read_at?: string | null
}

export async function listSupportThreads() {
  return request<import('../types').BackendSupportThreadSummary[]>('/messages/threads')
}

export async function listMessageRecipients(q?: string) {
  const qs = q?.trim() ? `?${new URLSearchParams({ q: q.trim() })}` : ''
  return request<import('../types').BackendMessageRecipient[]>(`/messages/recipients${qs}`)
}

export async function createSupportThread(payload: {
  channel: 'radiologist' | 'admin'
  /** Required for the radiologist channel. */
  recipient_subject?: string
  subject: string
  body: string
  related_case_id?: string
  related_submission_id?: string
}) {
  return request<import('../types').BackendSupportThreadDetail>('/messages/threads', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getSupportThread(threadId: string) {
  return request<import('../types').BackendSupportThreadDetail>(`/messages/threads/${threadId}`)
}

export async function postSupportMessage(threadId: string, body: string) {
  return request<import('../types').BackendSupportMessage>(`/messages/threads/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export async function markSupportThreadRead(threadId: string) {
  return request<import('../types').BackendSupportThreadDetail>(`/messages/threads/${threadId}/read`, {
    method: 'POST',
  })
}

/** Soft delete: the message stays as a placeholder and can be restored for a few minutes. */
export async function deleteSupportMessage(threadId: string, messageId: string) {
  return request<import('../types').BackendSupportThreadDetail>(
    `/messages/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE' },
  )
}

/** Undo a delete (only the person who deleted it, within the undo window). */
export async function restoreSupportMessage(threadId: string, messageId: string) {
  return request<import('../types').BackendSupportThreadDetail>(
    `/messages/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/restore`,
    { method: 'POST' },
  )
}

/** "Typing…" ping for the other participants (not stored). */
export async function sendTypingPing(threadId: string) {
  await request<void>(`/messages/threads/${encodeURIComponent(threadId)}/typing`, { method: 'POST' })
}

export async function deleteSupportThread(threadId: string) {
  await request<void>(`/messages/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' })
}

export async function listNotifications(unreadOnly = false) {
  const q = unreadOnly ? '?unread_only=true' : ''
  return request<{ items: AppNotification[]; unread_count: number }>(`/notifications${q}`)
}

export async function markNotificationRead(id: string) {
  return request<AppNotification>(`/notifications/${id}/read`, { method: 'POST' })
}

export async function markAllNotificationsRead() {
  return request<{ marked: number }>('/notifications/read-all', { method: 'POST' })
}

export async function deleteNotification(id: string) {
  return request<{ deleted: boolean }>(`/notifications/${id}/delete`, { method: 'POST' })
}

export async function clearAllNotifications() {
  return request<{ deleted: number }>('/notifications/clear-all', { method: 'POST' })
}
