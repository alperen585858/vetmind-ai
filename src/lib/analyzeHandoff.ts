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
  ownerName: string
  ownerEmail: string
  ownerEmailConsent: boolean
  petOwnerSubject: string | null
}

let pending: AnalyzeHandoff | null = null
/** Prevents Strict Mode / remount from starting a second confirm for the same pending id. */
const startedPendingIds = new Set<string>()

export function setAnalyzeHandoff(handoff: AnalyzeHandoff): void {
  pending = handoff
  startedPendingIds.delete(handoff.pendingId)
}

/** Read handoff without clearing (survives React Strict Mode remounts). */
export function getAnalyzeHandoff(pendingId: string): AnalyzeHandoff | null {
  if (!pending || pending.pendingId !== pendingId) return null
  return pending
}

/** Returns false if another effect instance already owns this pending upload. */
export function claimAnalyzeHandoff(pendingId: string): boolean {
  if (startedPendingIds.has(pendingId)) return false
  startedPendingIds.add(pendingId)
  return true
}

export function clearAnalyzeHandoff(pendingId: string): void {
  if (pending?.pendingId === pendingId) pending = null
  startedPendingIds.delete(pendingId)
}
