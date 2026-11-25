import { canonicalizeCaseId } from '../lib/caseId'
import { MAX_VIEWER_FRAMES } from '../lib/dicomLimits'
import type { Species } from '../types'
import type {
  BackendAnatomicalRegion,
  BackendCaseRecord,
  BackendModality,
  BackendPipelineResult,
  DicomDemoKind,
  DicomIngestionRecord,
  DicomUploadResponse,
} from '../types'
import { analyzeCaseAsyncAndWait, enqueueAnalyzeCase } from './analysis'
import type { BackendAnalysisJob } from './analysis'
import { toBackendSpecies, updateCaseOwner } from './cases'
import { fetchWithAuth, request, throwIfNotOk } from './client'

/** Multipart DICOM metadata upload (pixels ignored for diagnosis). */
export async function uploadDicomFiles(input: {
  files: File[]
  patientName: string
  species: Species
  breed?: string
  clinicalHistory?: string
  signal?: AbortSignal
}): Promise<DicomUploadResponse> {
  const form = new FormData()
  form.append('patient_name', input.patientName)
  form.append('species', toBackendSpecies(input.species))
  if (input.breed) form.append('breed', input.breed)
  if (input.clinicalHistory) form.append('clinical_history', input.clinicalHistory)
  form.append('referring_clinic', '')
  for (const file of input.files) {
    form.append('files', file, file.name)
  }
  return request<DicomUploadResponse>('/dicom/upload', {
    method: 'POST',
    body: form,
    signal: input.signal,
  })
}

/** Server-side synthetic DICOM fixtures (no real PHI). */
export async function uploadDicomDemo(input: {
  kind: DicomDemoKind
  patientName: string
  species: Species
  breed?: string
  clinicalHistory?: string
  signal?: AbortSignal
}): Promise<DicomUploadResponse> {
  const form = new FormData()
  form.append('patient_name', input.patientName)
  form.append('species', toBackendSpecies(input.species))
  if (input.breed) form.append('breed', input.breed)
  if (input.clinicalHistory) form.append('clinical_history', input.clinicalHistory)
  form.append('referring_clinic', '')
  return request<DicomUploadResponse>(`/dicom/demo/${input.kind}`, {
    method: 'POST',
    body: form,
    signal: input.signal,
  })
}

const DEMO_FILE_PREFIX: Record<DicomDemoKind, string> = {
  brain_mri: 'brain_mr',
  cervical_mri: 'cervical_mr',
  thoracolumbar_mri: 'thoracolumbar_mr',
  brain_ct: 'brain_ct',
  thorax_xr: 'thorax_xr',
}

/** Fetch synthetic .dcm bytes for the in-browser viewer (display only). */
export async function fetchDemoDicomFiles(kind: DicomDemoKind, count = 12): Promise<File[]> {
  const out: File[] = []
  const n = kind === 'thorax_xr' ? Math.min(count, 1) : Math.min(count, 24)
  let available = n
  for (let i = 0; i < available; i++) {
    const res = await fetchWithAuth(`/dicom/fixtures/${kind}/${i}?count=${n}`)
    if (!res.ok) {
      if (i === 0) await throwIfNotOk(res, `Demo DICOM download failed (${kind} #${i})`)
      break
    }
    const headerCount = Number(res.headers.get('X-VetMind-Fixture-Count'))
    if (Number.isFinite(headerCount) && headerCount > 0) {
      available = Math.min(n, headerCount)
    }
    const blob = await res.blob()
    out.push(new File([blob], `${DEMO_FILE_PREFIX[kind]}_${i + 1}.dcm`, { type: 'application/dicom' }))
  }
  return out
}

/** Pick a demo fixture kind for case-detail viewing from stored hints (never invents clinical pixels). */
export function resolveDemoKindForCase(input: {
  dicomDemoKind?: DicomDemoKind
  statusNote?: string
  documents?: { name: string; type: string; rawText?: string }[]
}): DicomDemoKind {
  if (input.dicomDemoKind) return input.dicomDemoKind
  const hay = [
    input.statusNote ?? '',
    ...(input.documents ?? []).flatMap((d) => [d.name, d.type, d.rawText ?? '']),
  ]
    .join(' ')
    .toUpperCase()
  if (/CERVICAL|SERV[Iİ]KAL|C-SPINE|CSPINE/.test(hay)) return 'cervical_mri'
  if (/THORACOLUMBAR|TORAKOLOMBER|LOMBER|LUMBAR|TLSPINE/.test(hay)) return 'thoracolumbar_mri'
  if (/\bCT\b|B[İI]LG[İI]SAYARLI|\bBT\b/.test(hay)) return 'brain_ct'
  if (/\bXR\b|\bDX\b|THORAX|TORAKS|R[ÖO]NTGEN/.test(hay)) return 'thorax_xr'
  return 'brain_mri'
}

/** PDF / JPG / PNG / text → quarantine + text extract (multimodal stub path). */
export async function uploadDocuments(input: {
  files: File[]
  patientName: string
  species: Species
  breed?: string
  clinicalHistory?: string
}): Promise<{
  ingest_id: string
  blocked: boolean
  block_reason?: string | null
  documents: { filename: string; content_kind: string; extracted_text?: string | null }[]
  quarantined_file_count: number
}> {
  const form = new FormData()
  form.append('patient_name', input.patientName)
  form.append('species', toBackendSpecies(input.species))
  if (input.breed) form.append('breed', input.breed)
  if (input.clinicalHistory) form.append('clinical_history', input.clinicalHistory)
  form.append('referring_clinic', '')
  for (const file of input.files) {
    form.append('files', file, file.name)
  }
  return request('/documents/upload', { method: 'POST', body: form })
}

export async function confirmDocumentIngest(ingestId: string): Promise<BackendCaseRecord> {
  return request<BackendCaseRecord>(`/documents/ingestions/${ingestId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function confirmDocumentAndAnalyze(
  ingestId: string,
  opts?: {
    signal?: AbortSignal
    cancelBackendOnAbort?: boolean
    /** Optional pet-owner name (no account, no email). */
    ownerName?: string
  },
): Promise<BackendPipelineResult> {
  const caseRecord = await confirmDocumentIngest(ingestId)
  if (opts?.ownerName?.trim()) {
    await updateCaseOwner(caseRecord.case_id, { owner_name: opts.ownerName.trim() })
  }
  return analyzeCaseAsyncAndWait(caseRecord.case_id, {
    signal: opts?.signal,
    cancelBackendOnAbort: opts?.cancelBackendOnAbort,
  })
}

export async function confirmDicomClassification(input: {
  ingestId: string
  acceptSuggestion: boolean
  modality?: BackendModality
  anatomicalRegion?: BackendAnatomicalRegion
  patientName?: string
  clinicalHistory?: string
  /** Optional pet-owner name (no account, no email). */
  ownerName?: string
  /** Issue #108: existing clinic patient this study belongs to. */
  patientId?: string | null
  /** Maps UI consent → case flags (does not enable pixel inference by itself). */
  imagingSourcePermissionVerified?: boolean
  imagingAnalysisConsentVerified?: boolean
  signal?: AbortSignal
}): Promise<BackendCaseRecord> {
  return request<BackendCaseRecord>(`/dicom/ingestions/${input.ingestId}/confirm`, {
    method: 'POST',
    signal: input.signal,
    body: JSON.stringify({
      accept_suggestion: input.acceptSuggestion,
      modality: input.modality ?? null,
      anatomical_region: input.anatomicalRegion ?? null,
      patient_name: input.patientName ?? null,
      clinical_history: input.clinicalHistory ?? null,
      owner_name: input.ownerName?.trim() || null,
      patient_id: input.patientId || null,
      imaging_source_permission_verified: Boolean(input.imagingSourcePermissionVerified),
      imaging_analysis_consent_verified: Boolean(input.imagingAnalysisConsentVerified),
    }),
  })
}

/** Confirm DICOM classification, then enqueue analyze without waiting for completion. */
export async function confirmDicomAndEnqueueAnalyze(input: {
  ingestId: string
  acceptSuggestion: boolean
  modality?: BackendModality
  anatomicalRegion?: BackendAnatomicalRegion
  patientName?: string
  clinicalHistory?: string
  /** Optional pet-owner name (no account, no email). */
  ownerName?: string
  patientId?: string | null
  imagingSourcePermissionVerified?: boolean
  imagingAnalysisConsentVerified?: boolean
  signal?: AbortSignal
}): Promise<{ case: BackendCaseRecord; job: BackendAnalysisJob }> {
  const caseRecord = await confirmDicomClassification(input)
  const job = await enqueueAnalyzeCase(caseRecord.case_id, { signal: input.signal })
  return { case: caseRecord, job }
}

/** Confirm DICOM classification, then run async analyze (poll until done). */
export async function confirmDicomAndAnalyze(input: {
  ingestId: string
  acceptSuggestion: boolean
  modality?: BackendModality
  anatomicalRegion?: BackendAnatomicalRegion
  patientName?: string
  clinicalHistory?: string
  /** Optional pet-owner name (no account, no email). */
  ownerName?: string
  patientId?: string | null
  imagingSourcePermissionVerified?: boolean
  imagingAnalysisConsentVerified?: boolean
  signal?: AbortSignal
  onJobEnqueued?: (jobId: string) => void
  cancelBackendOnAbort?: boolean
}): Promise<BackendPipelineResult> {
  const caseRecord = await confirmDicomClassification(input)
  return analyzeCaseAsyncAndWait(caseRecord.case_id, {
    signal: input.signal,
    onJobEnqueued: input.onJobEnqueued,
    cancelBackendOnAbort: input.cancelBackendOnAbort,
  })
}

export interface CaseDicomFileList {
  case_id: string
  ingest_id?: string | null
  /** Phase 19: all linked DICOM ingests (primary + attachment_refs). */
  ingest_ids?: string[]
  files: {
    index: number
    filename: string
    size_bytes: number
    content_kind: string
    ingest_id?: string | null
    ingest_file_index?: number | null
  }[]
  note: string
}

/** Ingest metadata the uploader (incl. pet owner) can read. */
export async function getDicomIngestion(ingestId: string): Promise<DicomIngestionRecord> {
  return request<DicomIngestionRecord>(`/dicom/ingestions/${ingestId}`)
}

export interface IngestDicomFileList {
  ingest_id: string
  files: { index: number; filename: string; size_bytes: number; content_kind: string }[]
  note: string
}

export async function listIngestDicomFiles(ingestId: string): Promise<IngestDicomFileList> {
  return request<IngestDicomFileList>(`/dicom/ingestions/${ingestId}/files`)
}

/** Download quarantined DICOM bytes for owner/clinic preview of an ingest. */
export async function fetchIngestDicomFiles(ingestId: string, maxFiles = MAX_VIEWER_FRAMES): Promise<File[]> {
  const listing = await listIngestDicomFiles(ingestId)
  if (!listing.files.length) return []
  const out: File[] = []
  const limit = Math.min(listing.files.length, maxFiles)
  for (let i = 0; i < limit; i++) {
    const meta = listing.files[i]
    const res = await fetchWithAuth(`/dicom/ingestions/${ingestId}/files/${meta.index}`)
    await throwIfNotOk(res, `DICOM download failed (#${meta.index})`)
    const blob = await res.blob()
    out.push(new File([blob], meta.filename || `instance_${i + 1}.dcm`, { type: 'application/dicom' }))
  }
  return out
}

/** List quarantined DICOM files for a backend case (user upload, not synthetic fixtures). */
export async function listCaseDicomFiles(caseId: string): Promise<CaseDicomFileList> {
  const id = canonicalizeCaseId(caseId)
  return request<CaseDicomFileList>(`/cases/${id}/dicom/files`)
}

/**
 * Download quarantined DICOM bytes for case-detail viewing.
 * Returns empty array when the case has no ingest (seed / metadata-only).
 */
export async function fetchCaseDicomFiles(caseId: string, maxFiles = MAX_VIEWER_FRAMES): Promise<File[]> {
  const id = canonicalizeCaseId(caseId)
  const listing = await listCaseDicomFiles(id)
  if (!listing.files.length) return []
  const out: File[] = []
  const limit = Math.min(listing.files.length, maxFiles)
  for (let i = 0; i < limit; i++) {
    const meta = listing.files[i]
    const res = await fetchWithAuth(`/cases/${id}/dicom/files/${meta.index}`)
    await throwIfNotOk(res, `Case DICOM download failed (#${meta.index})`)
    const blob = await res.blob()
    out.push(new File([blob], meta.filename || `instance_${i + 1}.dcm`, { type: 'application/dicom' }))
  }
  return out
}

export interface ImagingModelInputPackage {
  schema_version: string
  case_id: string
  study_instance_uid?: string | null
  species: string
  modality: string
  anatomical_region: string
  total_instances: number
  metadata_only: boolean
  pixel_analysis_authorized: boolean
  prepared_for_models: string[]
  series: { series_instance_uid: string; frame_count: number; modality?: string | null }[]
  warnings: string[]
  note: string
}

export async function prepareModelInput(caseId: string): Promise<ImagingModelInputPackage> {
  return request<ImagingModelInputPackage>(`/cases/${caseId}/model-input`, { method: 'POST' })
}

export async function getModelInput(caseId: string): Promise<ImagingModelInputPackage> {
  return request<ImagingModelInputPackage>(`/cases/${caseId}/model-input`)
}
