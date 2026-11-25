import type {
  BackendCaseRecord,
  BackendCasePriorStudies,
  BackendPatient,
  BackendPatientCreate,
  BackendPatientStudies,
} from '../types'
import { request } from './client'

/** Issue #108: clinic patient records and prior studies. */

export async function searchPatients(query: string, opts?: { signal?: AbortSignal }): Promise<BackendPatient[]> {
  const q = query.trim()
  return request(`/patients${q ? `?q=${encodeURIComponent(q)}` : ''}`, { signal: opts?.signal })
}

export async function createPatient(payload: BackendPatientCreate): Promise<BackendPatient> {
  return request('/patients', { method: 'POST', body: JSON.stringify(payload) })
}

export async function getPatient(patientId: string): Promise<BackendPatient> {
  return request(`/patients/${encodeURIComponent(patientId)}`)
}

export async function updatePatient(
  patientId: string,
  payload: Partial<BackendPatientCreate>,
): Promise<BackendPatient> {
  return request(`/patients/${encodeURIComponent(patientId)}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export async function getPatientStudies(patientId: string): Promise<BackendPatientStudies> {
  return request(`/patients/${encodeURIComponent(patientId)}/studies`)
}

export async function mergePatients(keepId: string, duplicateId: string): Promise<BackendPatient> {
  return request(`/patients/${encodeURIComponent(keepId)}/merge`, {
    method: 'POST',
    body: JSON.stringify({ duplicate_patient_id: duplicateId }),
  })
}

export async function getCasePriorStudies(caseId: string): Promise<BackendCasePriorStudies> {
  return request(`/cases/${encodeURIComponent(caseId)}/prior-studies`)
}

/** Link a case to a patient, or unlink it with ``null``. */
export async function linkCasePatient(caseId: string, patientId: string | null): Promise<BackendCaseRecord> {
  return request(`/cases/${encodeURIComponent(caseId)}/patient`, {
    method: 'PUT',
    body: JSON.stringify({ patient_id: patientId }),
  })
}
