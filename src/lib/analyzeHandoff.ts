import type {
  BackendAnatomicalRegion,
  BackendModality,
  DicomDemoKind,
  DicomUploadResponse,
  Patient,
} from '../types'

/** In-memory handoff so "Analize gönder" can navigate before upload/enqueue finishes. */
export type AnalyzeHandoff = {
  pendingId: string
  files: File[]
  pendingDemo: DicomDemoKind | null
  ingestId?: string
  uploadSnap: DicomUploadResponse | null
  patientName: string
  species: Patient['species']
  breed: string
  ageYears: string
  history: string
  consent: boolean
  acceptSuggestion: boolean
  overrideModality: BackendModality
  overrideRegion: BackendAnatomicalRegion
  vetName: string
}

let pending: AnalyzeHandoff | null = null

export function setAnalyzeHandoff(handoff: AnalyzeHandoff): void {
  pending = handoff
}

/** Read handoff without clearing (survives React Strict Mode remounts). */
export function getAnalyzeHandoff(pendingId: string): AnalyzeHandoff | null {
  if (!pending || pending.pendingId !== pendingId) return null
  return pending
}

export function clearAnalyzeHandoff(pendingId: string): void {
  if (pending?.pendingId === pendingId) pending = null
}
