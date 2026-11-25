import { canonicalizeCaseId } from '../lib/caseId'
import type { Species } from '../types'
import type {
  BackendAnatomicalRegion,
  BackendCaseRecord,
  BackendCaseSummary,
  BackendModality,
  BackendPipelineResult,
  BackendScenario,
  BackendSpecies,
} from '../types'
import { analyzeCaseAsyncAndWait } from './analysis'
import { request } from './client'

export function toBackendSpecies(species: Species): BackendSpecies {
  if (species === 'Köpek') return 'canine'
  if (species === 'Kedi') return 'feline'
  return 'other'
}

/**
 * Create a synthetic case and run mock analysis synchronously.
 * The analyze endpoint blocks until the pipeline finishes; job_id is a run id, not a queue ticket.
 */
function scenarioRouting(scenario: BackendScenario): {
  modality: BackendModality
  anatomical_region: BackendAnatomicalRegion
} {
  if (scenario === 'cervical_mri_suspected') return { modality: 'MR', anatomical_region: 'CERVICAL' }
  if (scenario === 'ct_brain_suspected') return { modality: 'CT', anatomical_region: 'BRAIN' }
  if (scenario === 'xr_thorax_suspected') return { modality: 'XR', anatomical_region: 'THORAX' }
  if (scenario === 'document_context' || scenario === 'unsupported') {
    return { modality: 'OTHER', anatomical_region: 'UNKNOWN' }
  }
  return { modality: 'MR', anatomical_region: 'BRAIN' }
}

export async function createAndAnalyzeCase(input: {
  /** Issue #108: existing clinic patient (optional). */
  patientId?: string | null
  patientName: string
  species: Species
  breed: string
  clinicalHistory: string
  scenario: BackendScenario
  patientAgeYears?: number
  priority?: 'normal' | 'high' | 'urgent' | 'stat'
  /** Optional pet-owner name for the vet's records (owners get no account and no email). */
  ownerName?: string
  clinicalHistoryStructured?: {
    complaint?: string
    onset?: string
    course?: string
    medications?: string
    relevant_history?: string
    handoff_notes?: string
    radiologist_questions?: string
    sex?: string
    weight_kg?: number
    neutered?: boolean
    neuro_exam?: Record<string, string | string[] | boolean | number | null>
  }
  signal?: AbortSignal
  cancelBackendOnAbort?: boolean
}): Promise<BackendPipelineResult> {
  const { modality, anatomical_region } = scenarioRouting(input.scenario)
  const created = await request<{ case_id: string }>('/cases', {
    method: 'POST',
    signal: input.signal,
    body: JSON.stringify({
      patient_name: input.patientName,
      species: toBackendSpecies(input.species),
      breed: input.breed || null,
      patient_age_years: input.patientAgeYears ?? null,
      modality,
      anatomical_region,
      clinical_history: input.clinicalHistory || 'Örnek vaka.',
      clinical_history_structured: input.clinicalHistoryStructured ?? null,
      priority: input.priority ?? 'normal',
      scenario: input.scenario,
      referring_clinic: '',
      owner_name: input.ownerName?.trim() || null,
      patient_id: input.patientId || null,
    }),
  })
  return analyzeCaseAsyncAndWait(created.case_id, {
    signal: input.signal,
    cancelBackendOnAbort: input.cancelBackendOnAbort,
  })
}

export async function updateCaseOwner(
  caseId: string,
  payload: { owner_name: string | null },
): Promise<BackendCaseRecord> {
  return request(`/cases/${encodeURIComponent(caseId)}/owner`, {
    method: 'PATCH',
    body: JSON.stringify({ owner_name: payload.owner_name?.trim() || null }),
  })
}

export async function revokeCaseReportViewLinks(caseId: string): Promise<BackendCaseRecord> {
  return request(`/cases/${encodeURIComponent(caseId)}/report-view-links/revoke`, { method: 'POST' })
}

export async function listBackendCases(): Promise<BackendCaseSummary[]> {
  return request<BackendCaseSummary[]>('/cases')
}

/** Permanent delete — administrators only, reason required (e.g. KVKK erasure). */
export async function deleteBackendCase(caseId: string, reason: string): Promise<void> {
  const qs = new URLSearchParams({ reason })
  await request<void>(`/cases/${encodeURIComponent(caseId)}?${qs}`, { method: 'DELETE' })
}

/** Cancel a draft that has not reached a radiologist; the record is kept (#78). */
export async function cancelBackendCase(caseId: string, reason: string): Promise<BackendCaseRecord> {
  return request<BackendCaseRecord>(`/cases/${encodeURIComponent(caseId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

/** "Listemden gizle": hide the case from the caller's own lists only. */
export async function hideBackendCase(caseId: string): Promise<void> {
  await request<void>(`/cases/${encodeURIComponent(caseId)}/hide`, { method: 'POST' })
}

export async function listBackendWorklist(filters?: {
  status?: string
  modality?: string
  priority?: string
  assigned_to?: string
  q?: string
  signal?: AbortSignal
}): Promise<BackendCaseSummary[]> {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.modality) params.set('modality', filters.modality)
  if (filters?.priority) params.set('priority', filters.priority)
  if (filters?.assigned_to) params.set('assigned_to', filters.assigned_to)
  if (filters?.q) params.set('q', filters.q)
  const qs = params.toString()
  return request<BackendCaseSummary[]>(`/cases/worklist${qs ? `?${qs}` : ''}`, {
    signal: filters?.signal,
  })
}

export async function updateCaseAssignment(
  caseId: string,
  payload: { assigned_reviewer_id?: string | null; priority?: 'normal' | 'high' | 'urgent' | 'stat' },
): Promise<BackendCaseRecord> {
  return request(`/cases/${caseId}/assignment`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function getClinicDashboard(filters?: {
  status?: string
  q?: string
}): Promise<import('../types').ClinicDashboardStats> {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.q) params.set('q', filters.q)
  const qs = params.toString()
  return request(`/cases/dashboard${qs ? `?${qs}` : ''}`)
}

export async function getBackendCase(caseId: string, signal?: AbortSignal): Promise<BackendCaseRecord> {
  const id = canonicalizeCaseId(caseId)
  return request<BackendCaseRecord>(`/cases/${id}`, { signal })
}

export async function listCaseActivity(caseId: string) {
  return request<Array<{ event_id: string; kind: string; actor_subject: string; at: string; detail?: string | null }>>(
    `/cases/${caseId}/activity`,
  )
}
