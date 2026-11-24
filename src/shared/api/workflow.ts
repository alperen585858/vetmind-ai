import { request } from './client'

// --- Phase 14 role workflows ---

export async function appendCaseClinicalNote(caseId: string, body: string) {
  return request<import('../types').BackendCaseRecord>(`/cases/${caseId}/clinical-notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export async function appendCaseInternalNote(caseId: string, body: string) {
  return request<import('../types').BackendCaseRecord>(`/cases/${caseId}/internal-notes`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export async function createCaseInfoRequest(
  caseId: string,
  payload: { body: string; to_role?: 'vet' | 'expert' },
) {
  return request<import('../types').BackendCaseRecord>(`/cases/${caseId}/info-requests`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function replyCaseInfoRequest(caseId: string, requestId: string, reply: string) {
  return request<import('../types').BackendCaseRecord>(
    `/cases/${caseId}/info-requests/${requestId}/reply`,
    { method: 'POST', body: JSON.stringify({ reply }) },
  )
}

export async function closeCaseInfoRequest(caseId: string, requestId: string) {
  return request<import('../types').BackendCaseRecord>(
    `/cases/${caseId}/info-requests/${requestId}/close`,
    { method: 'POST' },
  )
}

export async function attachCaseDocument(caseId: string, ingestId: string) {
  return request<import('../types').BackendCaseRecord>(`/cases/${caseId}/documents`, {
    method: 'POST',
    body: JSON.stringify({ ingest_id: ingestId }),
  })
}

export async function getClinicStats() {
  return request<import('../types').BackendClinicStats>('/clinic/stats')
}
