import { request } from './client'

// --- Phase 14 role workflows ---

export async function listPets() {
  return request<import('../types').BackendPet[]>('/pets')
}

export async function createPet(payload: {
  name: string
  species: 'canine' | 'feline' | 'other'
  breed?: string
  age_years?: number
  sex?: string
  medical_history?: string
}) {
  return request<import('../types').BackendPet>('/pets', { method: 'POST', body: JSON.stringify(payload) })
}

export async function updatePet(
  petId: string,
  payload: Partial<{ name: string; breed: string; age_years: number; sex: string; medical_history: string }>,
) {
  return request<import('../types').BackendPet>(`/pets/${petId}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export async function listSubmissions(status?: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : ''
  return request<import('../types').BackendImagingSubmission[]>(`/submissions${q}`)
}

export async function createSubmission(payload: {
  pet_id: string
  chief_complaint?: string
  clinical_notes?: string
}) {
  return request<import('../types').BackendImagingSubmission>('/submissions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function deleteSubmission(id: string) {
  await request<void>(`/submissions/${id}`, { method: 'DELETE' })
}

export async function finalizeSubmission(id: string) {
  return request<import('../types').BackendImagingSubmission>(`/submissions/${id}/finalize`, {
    method: 'POST',
  })
}

export async function updateSubmission(
  id: string,
  payload: Partial<{
    chief_complaint: string
    clinical_notes: string
    dicom_ingest_id: string
    document_ingest_id: string
  }>,
) {
  return request<import('../types').BackendImagingSubmission>(`/submissions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function attachSubmission(
  id: string,
  payload: { kind: 'dicom' | 'document'; ingest_id: string; label?: string },
) {
  return request<import('../types').BackendImagingSubmission>(`/submissions/${id}/attachments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function replySubmissionInfoRequest(id: string, requestId: string, reply: string) {
  return request<import('../types').BackendImagingSubmission>(
    `/submissions/${id}/info-requests/${requestId}/reply`,
    { method: 'POST', body: JSON.stringify({ reply }) },
  )
}

export async function closeSubmissionInfoRequest(id: string, requestId: string) {
  return request<import('../types').BackendImagingSubmission>(
    `/submissions/${id}/info-requests/${requestId}/close`,
    { method: 'POST' },
  )
}

export async function vetSubmissionAction(
  id: string,
  payload: {
    action: 'accept' | 'reject' | 'request_info'
    vet_notes?: string
    missing_info_request?: string
    assigned_reviewer_id?: string
    run_analyze?: boolean
  },
) {
  return request<import('../types').BackendCaseRecord | import('../types').BackendImagingSubmission>(
    `/submissions/${id}/vet-action`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

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
  payload: { body: string; to_role?: 'vet' | 'owner' | 'expert' },
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

export interface PetHistoryEntry {
  at: string
  kind: string
  title: string
  detail?: string | null
  case_id?: string | null
  submission_id?: string | null
  dicom_ingest_id?: string | null
  report_available: boolean
  link_path?: string | null
}

export async function getPetMedicalHistory(petId: string) {
  return request<{
    pet: import('../types').BackendPet
    clinical_notes?: string | null
    timeline: PetHistoryEntry[]
  }>(`/pets/${petId}/medical-history`)
}
