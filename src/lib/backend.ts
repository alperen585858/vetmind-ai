import { getBackendAccessToken, loadSession } from './auth'
import { MAX_VIEWER_FRAMES } from './dicomFolder'
import type { AIAssessment, ReportSections, Species } from '../types'
import type {
  BackendCaseRecord,
  BackendCaseSummary,
  BackendDraftReport,
  BackendFindings,
  BackendAnatomicalRegion,
  BackendModality,
  BackendPipelineResult,
  BackendScenario,
  BackendSpecies,
  DicomDemoKind,
  DicomIngestionRecord,
  DicomUploadResponse,
} from '../types'

const API_BASE = '/api/v1'

export class BackendUnavailableError extends Error {
  constructor(message = 'FastAPI backend is not reachable. Start it with: cd backend && uvicorn app.main:app --port 8000') {
    super(message)
    this.name = 'BackendUnavailableError'
  }
}

/**
 * Frontend stopped polling (unmount / navigation / user cancel).
 * Does NOT cancel the backend AnalysisJob — the worker may still finish.
 */
export class PollingCancelledError extends Error {
  readonly jobId?: string
  constructor(message = 'Job polling cancelled by client', jobId?: string) {
    super(message)
    this.name = 'PollingCancelledError'
    this.jobId = jobId
  }
}

function throwIfAborted(signal: AbortSignal | undefined, jobId?: string): void {
  if (signal?.aborted) {
    throw new PollingCancelledError('Job polling cancelled by client', jobId)
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PollingCancelledError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new PollingCancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object' && 'message' in detail) {
    return String((detail as { message: unknown }).message)
  }
  try {
    return JSON.stringify(detail)
  } catch {
    return 'Request failed'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData
  if (!isForm && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getBackendAccessToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  // When auth is disabled, attribute support messages to the active demo session.
  const session = loadSession()
  if (session?.role && session?.email) {
    if (!headers.has('X-VetMind-Demo-Role')) headers.set('X-VetMind-Demo-Role', session.role)
    if (!headers.has('X-VetMind-Demo-Subject')) headers.set('X-VetMind-Demo-Subject', session.email)
  }

  let res: Response
  try {
    if (init?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'AbortError') throw err
    throw new BackendUnavailableError()
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (body.detail !== undefined) detail = formatDetail(body.detail)
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export function toBackendSpecies(species: Species): BackendSpecies {
  if (species === 'Köpek') return 'canine'
  if (species === 'Kedi') return 'feline'
  return 'other'
}

/** Optional backend JWT login (used when VETMIND_AUTH_ENABLED=1). */
export async function backendLogin(email: string, password: string): Promise<{
  access_token: string
  role: string
  auth_enabled: boolean
}> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function backendAuthStatus(): Promise<{
  auth_enabled: boolean
  deployment_mode?: string
  tenant_isolation?: boolean
  encryption_at_rest?: string
  malware_scan_required?: boolean
}> {
  return request('/auth/status')
}

export type BackendHealth = {
  status: string
  mode: string
  version: string
  storage: string
  sqlite_path?: string
  quarantine_root?: string
  rag: string
  job_backend: string
  auth_enabled: boolean
  vision_endpoint: boolean
  note?: string
}

export type BackendModelReadinessEntry = {
  model_id: string
  version: string
  species: string[]
  modalities: string[]
  body_regions: string[]
  input_requirements: string[]
  task_capabilities: string[]
  availability: string
  source_kind: string
  allows_pixel_analysis: boolean
  adapter_kind: string
  enabled: boolean
  adapter_registered: boolean
  description: string
  resource_hint: string
  timeout_s: number
  preprocessing_contract_id?: string | null
  input_contract_id: string
  output_schema_version: string
  blockers?: string[]
  ready_for_real_integration?: boolean
}

export type BackendModelReadiness = {
  schema_version: string
  model_count: number
  enabled_count: number
  models_with_blockers?: number
  pixel_analysis_default: boolean
  note: string
  models: BackendModelReadinessEntry[]
  remaining_steps_to_first_real_model?: string[]
}

export async function fetchBackendHealth(): Promise<BackendHealth> {
  return request('/health')
}

export async function fetchModelReadiness(): Promise<BackendModelReadiness> {
  return request('/models/readiness')
}

// --- LLM layer: active model, expert feedback, offline evaluation (admin) ---

export interface LlmStatus {
  kind: string
  provider_id: string
  model_id: string
  model_version: string
  prompt_version: string | null
  report_language: string
}

export interface LlmFeedbackSummary {
  reviews: number
  by_decision: Record<string, number>
  sections: Record<string, { edited_rate: number | null; mean_similarity: number | null }>
  models: Record<string, { reviews: number; approved_rate: number; approved_unedited_rate: number; mean_similarity: number }>
  note: string
}

export interface LlmEvalCase {
  case_id: string
  ok: boolean
  error: string
  score: number | null
  latency_s: number
}

export interface LlmEvalRun {
  label: string
  provider_id: string
  model_id: string
  prompt_version: string
  summary: Record<string, number | null>
  cases: LlmEvalCase[]
}

export interface LlmEvalResult {
  file: string
  set: string
  set_version: number
  runs: LlmEvalRun[]
}

export async function fetchLlmStatus(): Promise<LlmStatus> {
  return request('/llm/status')
}

export async function fetchLlmFeedback(): Promise<LlmFeedbackSummary> {
  return request('/llm/feedback')
}

/** Latest scripts/llm_eval.py result, or null when none has been run yet. */
export async function fetchLatestLlmEval(): Promise<LlmEvalResult | null> {
  try {
    return await request<LlmEvalResult>('/llm/eval/latest')
  } catch (err) {
    if (err instanceof BackendUnavailableError) throw err
    return null
  }
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
  patientName: string
  species: Species
  breed: string
  clinicalHistory: string
  scenario: BackendScenario
  patientAgeYears?: number
  priority?: 'normal' | 'high' | 'urgent' | 'stat'
  clinicalHistoryStructured?: {
    complaint?: string
    onset?: string
    course?: string
    medications?: string
    relevant_history?: string
    handoff_notes?: string
  }
}): Promise<BackendPipelineResult> {
  const { modality, anatomical_region } = scenarioRouting(input.scenario)
  const created = await request<{ case_id: string }>('/cases', {
    method: 'POST',
    body: JSON.stringify({
      patient_name: input.patientName,
      species: toBackendSpecies(input.species),
      breed: input.breed || null,
      patient_age_years: input.patientAgeYears ?? null,
      modality,
      anatomical_region,
      clinical_history: input.clinicalHistory || 'Synthetic demo case. Not a real patient.',
      clinical_history_structured: input.clinicalHistoryStructured ?? null,
      priority: input.priority ?? 'normal',
      scenario: input.scenario,
      referring_clinic: 'Ornek Veteriner Klinigi (demo)',
    }),
  })
  return analyzeCaseAsyncAndWait(created.case_id)
}

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
  form.append('referring_clinic', 'Ornek Veteriner Klinigi (demo)')
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
  form.append('referring_clinic', 'Ornek Veteriner Klinigi (demo)')
  return request<DicomUploadResponse>(`/dicom/demo/${input.kind}`, {
    method: 'POST',
    body: form,
    signal: input.signal,
  })
}

const DEMO_FILE_PREFIX: Record<DicomDemoKind, string> = {
  brain_mri: 'brain_mr',
  cervical_mri: 'cervical_mr',
  brain_ct: 'brain_ct',
  thorax_xr: 'thorax_xr',
}

/** Fetch synthetic .dcm bytes for the in-browser viewer (display only). */
export async function fetchDemoDicomFiles(kind: DicomDemoKind, count = 12): Promise<File[]> {
  const out: File[] = []
  const n = kind === 'thorax_xr' ? Math.min(count, 1) : Math.min(count, 24)
  const headers = new Headers()
  const token = getBackendAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let available = n
  for (let i = 0; i < available; i++) {
    let res: Response
    try {
      res = await fetch(`${API_BASE}/dicom/fixtures/${kind}/${i}?count=${n}`, { headers })
    } catch {
      throw new BackendUnavailableError()
    }
    if (!res.ok) {
      if (i === 0) throw new Error(`Demo DICOM indirilemedi (${kind} #${i})`)
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
  form.append('referring_clinic', 'Ornek Veteriner Klinigi (demo)')
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

export async function confirmDocumentAndAnalyze(ingestId: string): Promise<BackendPipelineResult> {
  const caseRecord = await confirmDocumentIngest(ingestId)
  return analyzeCaseAsyncAndWait(caseRecord.case_id)
}

/** Enqueue background analyze and poll until completed/failed.
 *
 * `signal` aborts **client polling only** — it does not cancel the backend job.
 * Catch {@link PollingCancelledError} vs network/backend failures separately.
 */
export async function analyzeCaseAsyncAndWait(
  caseId: string,
  opts?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal },
): Promise<BackendPipelineResult> {
  const timeoutMs = opts?.timeoutMs ?? 15_000
  const intervalMs = opts?.intervalMs ?? 120
  const signal = opts?.signal
  let jobId: string | undefined
  try {
    throwIfAborted(signal)
    const job = await request<{ job_id: string; status: string; case_id: string }>(
      `/cases/${caseId}/analyze/async`,
      { method: 'POST', signal },
    )
    jobId = job.job_id
    const deadline = Date.now() + timeoutMs
    let status = job.status
    while (Date.now() < deadline) {
      throwIfAborted(signal, job.job_id)
      const polled = await request<{
        job_id: string
        case_id: string
        status: string
        outcome: BackendPipelineResult['outcome'] | null
        error_message?: string | null
        routed_model_ids?: string[]
        route_reason?: string | null
      }>(`/jobs/${job.job_id}`, { signal })
      status = polled.status
      const terminal =
        status === 'completed' ||
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'timed_out'
      if (terminal) {
        throwIfAborted(signal, job.job_id)
        const [findings, report, caseRecord] = await Promise.all([
          request<BackendFindings | null>(`/cases/${caseId}/findings`, { signal }).catch(() => null),
          request<BackendDraftReport | null>(`/cases/${caseId}/report`, { signal }).catch(() => null),
          getBackendCase(caseId, signal),
        ])
        const outcome =
          (polled.outcome as BackendPipelineResult['outcome'] | null) ??
          (status === 'failed' || status === 'cancelled' || status === 'timed_out'
            ? 'failed'
            : caseRecord.status === 'manual_review'
              ? 'unsupported'
              : 'success')
        return {
          outcome,
          job: {
            job_id: polled.job_id,
            case_id: polled.case_id,
            status: polled.status,
            routed_model_ids: polled.routed_model_ids ?? [],
            route_reason: polled.route_reason,
            error_message: polled.error_message,
          },
          findings,
          report,
          messages: [
            status === 'completed'
              ? 'Async analyze (demo thread worker) completed.'
              : `Async analyze ended with status=${status}.`,
            'Client poll abort does not cancel the backend job.',
          ],
        }
      }
      await sleep(intervalMs, signal)
    }
    throw new Error(`Analyze job ${job.job_id} timed out (last status=${status}).`)
  } catch (err) {
    if (err instanceof PollingCancelledError) throw err
    const name = err instanceof Error ? err.name : ''
    if (name === 'AbortError') {
      throw new PollingCancelledError('Job polling cancelled by client', jobId)
    }
    throw err
  }
}

export async function searchRag(query: string, topK = 5): Promise<{
  query: string
  hits: { source_id: string; title: string; section: string; passage: string; score: number }[]
  method: string
  note: string
}> {
  const params = new URLSearchParams({ q: query, top_k: String(topK) })
  return request(`/rag/search?${params.toString()}`)
}

export async function confirmDicomClassification(input: {
  ingestId: string
  acceptSuggestion: boolean
  modality?: BackendModality
  anatomicalRegion?: BackendAnatomicalRegion
  patientName?: string
  clinicalHistory?: string
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
      imaging_source_permission_verified: Boolean(input.imagingSourcePermissionVerified),
      imaging_analysis_consent_verified: Boolean(input.imagingAnalysisConsentVerified),
    }),
  })
}

/** Confirm DICOM classification, then run async mock analyze (poll until done). */
export async function confirmDicomAndAnalyze(input: {
  ingestId: string
  acceptSuggestion: boolean
  modality?: BackendModality
  anatomicalRegion?: BackendAnatomicalRegion
  patientName?: string
  clinicalHistory?: string
  imagingSourcePermissionVerified?: boolean
  imagingAnalysisConsentVerified?: boolean
  signal?: AbortSignal
}): Promise<BackendPipelineResult> {
  const caseRecord = await confirmDicomClassification(input)
  return analyzeCaseAsyncAndWait(caseRecord.case_id, { signal: input.signal })
}

export async function listBackendCases(): Promise<BackendCaseSummary[]> {
  return request<BackendCaseSummary[]>('/cases')
}

export async function listBackendWorklist(filters?: {
  status?: string
  modality?: string
  priority?: string
  assigned_to?: string
  q?: string
}): Promise<BackendCaseSummary[]> {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.modality) params.set('modality', filters.modality)
  if (filters?.priority) params.set('priority', filters.priority)
  if (filters?.assigned_to) params.set('assigned_to', filters.assigned_to)
  if (filters?.q) params.set('q', filters.q)
  const qs = params.toString()
  return request<BackendCaseSummary[]>(`/cases/worklist${qs ? `?${qs}` : ''}`)
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

export async function listCaseMessages(
  caseId: string,
): Promise<import('../types').BackendCaseMessage[]> {
  return request(`/cases/${caseId}/messages`)
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

export async function markReportDelivered(caseId: string): Promise<BackendCaseRecord> {
  return request(`/cases/${caseId}/report/deliver`, { method: 'POST' })
}

export async function markReportViewed(caseId: string): Promise<BackendCaseRecord> {
  return request(`/cases/${caseId}/report/viewed`, { method: 'POST' })
}

export async function saveBackendDraftReport(
  caseId: string,
  sections: ReportSections,
  note?: string,
): Promise<BackendDraftReport> {
  return request(`/cases/${caseId}/report/draft`, {
    method: 'PUT',
    body: JSON.stringify({
      editor_id: 'expert-demo',
      technique: sections.klinikOzet,
      findings: sections.bulgular,
      impression: sections.degerlendirme,
      recommendations: sections.oneriler,
      note: note || undefined,
    }),
  })
}

export async function getBackendCase(caseId: string, signal?: AbortSignal): Promise<BackendCaseRecord> {
  return request<BackendCaseRecord>(`/cases/${caseId}`, { signal })
}

export async function listReportVersions(
  caseId: string,
  signal?: AbortSignal,
): Promise<import('../types').BackendReportVersionSummary[]> {
  return request(`/cases/${caseId}/report/versions`, { signal })
}

export async function getReportVersion(
  caseId: string,
  version: number,
  signal?: AbortSignal,
): Promise<import('../types').BackendReportVersionSnapshot> {
  return request(`/cases/${caseId}/report/versions/${version}`, { signal })
}

export async function getBackendReport(
  caseId: string,
  version?: number,
  signal?: AbortSignal,
): Promise<import('../types').BackendDraftReport> {
  const q = version != null ? `?version=${version}` : ''
  return request(`/cases/${caseId}/report${q}`, { signal })
}

export type BackendAnalysisJob = {
  job_id: string
  case_id: string
  status: string
  outcome?: string | null
  error_message?: string | null
  routed_model_ids?: string[]
  routed_model_versions?: string[]
  route_reason?: string | null
  analysis_mode?: string
  cancel_requested?: boolean
  timeout_s?: number | null
  idempotency_key?: string | null
}

export async function getAnalysisJob(jobId: string, signal?: AbortSignal): Promise<BackendAnalysisJob> {
  return request<BackendAnalysisJob>(`/jobs/${jobId}`, { signal })
}

export async function requestCancelAnalysisJob(jobId: string): Promise<BackendAnalysisJob> {
  return request<BackendAnalysisJob>(`/jobs/${jobId}/cancel`, { method: 'POST' })
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
  const headers = new Headers()
  const token = getBackendAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const out: File[] = []
  const limit = Math.min(listing.files.length, maxFiles)
  for (let i = 0; i < limit; i++) {
    const meta = listing.files[i]
    let res: Response
    try {
      res = await fetch(`${API_BASE}/dicom/ingestions/${ingestId}/files/${meta.index}`, { headers })
    } catch {
      throw new BackendUnavailableError()
    }
    if (!res.ok) throw new Error(`DICOM indirilemedi (#${meta.index})`)
    const blob = await res.blob()
    out.push(new File([blob], meta.filename || `instance_${i + 1}.dcm`, { type: 'application/dicom' }))
  }
  return out
}

/** List quarantined DICOM files for a backend case (user upload, not synthetic fixtures). */
export async function listCaseDicomFiles(caseId: string): Promise<CaseDicomFileList> {
  return request<CaseDicomFileList>(`/cases/${caseId}/dicom/files`)
}

/**
 * Download quarantined DICOM bytes for case-detail viewing.
 * Returns empty array when the case has no ingest (seed / metadata-only).
 */
export async function fetchCaseDicomFiles(caseId: string, maxFiles = MAX_VIEWER_FRAMES): Promise<File[]> {
  const listing = await listCaseDicomFiles(caseId)
  if (!listing.files.length) return []
  const headers = new Headers()
  const token = getBackendAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const out: File[] = []
  const limit = Math.min(listing.files.length, maxFiles)
  for (let i = 0; i < limit; i++) {
    const meta = listing.files[i]
    let res: Response
    try {
      res = await fetch(`${API_BASE}/cases/${caseId}/dicom/files/${meta.index}`, { headers })
    } catch {
      throw new BackendUnavailableError()
    }
    if (!res.ok) throw new Error(`Vaka DICOM indirilemedi (#${meta.index})`)
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

/** Fetch a completed synchronous analyze run (no background queue). */
export async function getJob(jobId: string) {
  return request<{ job_id: string; status: string; outcome: string | null; error_message: string | null }>(`/jobs/${jobId}`)
}

export async function submitBackendReview(caseId: string, payload: {
  action: 'approve' | 'reject' | 'request_revision'
  comment?: string
  reason_codes?: string[]
  edited_technique?: string
  edited_findings?: string
  edited_impression?: string
  edited_recommendations?: string
}) {
  return request(`/cases/${caseId}/review`, {
    method: 'POST',
    body: JSON.stringify({ reviewer_id: 'expert-demo', ...payload }),
  })
}

export function draftToSections(report: BackendDraftReport): ReportSections {
  return {
    klinikOzet: report.technique.text,
    bulgular: report.findings.text,
    degerlendirme: report.impression.text,
    ayiriciTanilar:
      'Sentetik taslak: LLM ayırıcı tanı listesi üretmedi. İzlenebilirlik için rapor bölümleri structured finding_id değerlerine atıf yapar.',
    oneriler: report.recommendations.text,
  }
}

export function pipelineToAssessment(findings: BackendFindings, report: BackendDraftReport): AIAssessment {
  const mapped = findings.findings.map((f) => ({
    text: `[${f.finding_code}] ${f.description}`,
    severity: (f.finding_status === 'suspected' ? 'Yüksek' : f.finding_status === 'possible' ? 'Orta' : 'Düşük') as AIAssessment['findings'][number]['severity'],
  }))
  return {
    summary: report.impression.text,
    findings: mapped.length
      ? mapped
      : [{ text: 'Mock görüntüleme bağdaştırıcısı bulgu döndürmedi. Bu, hastalığın yokluğu anlamına gelmez.', severity: 'Orta' }],
    differentials: [],
    recommendedTests: [report.recommendations.text],
    validation: [
      { kind: 'unsupported', text: 'Kaynak: MOCK / sentetik pipeline', detail: 'Bu çıktı klinik doğrulanmış bir model değildir. Uzman veteriner radyolog incelemesi zorunludur.' },
      ...findings.warnings.map((w) => ({ kind: 'missing' as const, text: 'Pipeline uyarısı', detail: w })),
    ],
    model: `${findings.source_model_id} + ${report.generation.model_id}`,
    generatedAt: report.generation.generated_at,
  }
}

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

export async function createDemoPaymentIntent(submissionId: string) {
  return request<import('../types').BackendDemoPayment>('/payments/intents', {
    method: 'POST',
    body: JSON.stringify({ submission_id: submissionId }),
  })
}

export async function getDemoPayment(paymentId: string) {
  return request<import('../types').BackendDemoPayment>(`/payments/intents/${paymentId}`)
}

export async function getDemoPaymentBySubmission(submissionId: string) {
  return request<import('../types').BackendDemoPayment>(`/payments/by-submission/${submissionId}`)
}

export async function confirmDemoPayment(
  paymentId: string,
  payload: { card_number: string; expiry: string; cvc: string },
) {
  return request<import('../types').BackendDemoPaymentConfirmResponse>(
    `/payments/intents/${paymentId}/confirm-demo`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
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

export async function listManagedUsers() {
  return request<import('../types').BackendManagedUser[]>('/admin/users')
}

export async function createManagedUser(payload: {
  email: string
  password: string
  role: string
  clinic_id?: string
  display_name?: string
}) {
  return request<import('../types').BackendManagedUser>('/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateManagedUser(
  email: string,
  payload: Partial<{ role: string; clinic_id: string; display_name: string; active: boolean; password: string }>,
) {
  return request<import('../types').BackendManagedUser>(`/admin/users/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
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

export async function createSupportThread(payload: {
  channel: 'radiologist' | 'admin'
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

export async function downloadApprovedReportPdf(caseId: string, version?: number): Promise<Blob> {
  const q = version != null ? `?version=${version}` : ''
  const headers = new Headers()
  const token = getBackendAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  let res: Response
  try {
    res = await fetch(`${API_BASE}/cases/${caseId}/report/pdf${q}`, { headers })
  } catch {
    throw new BackendUnavailableError()
  }
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(detail || 'PDF indirilemedi')
  }
  return res.blob()
}

export async function listCaseActivity(caseId: string) {
  return request<Array<{ event_id: string; kind: string; actor_subject: string; at: string; detail?: string | null }>>(
    `/cases/${caseId}/activity`,
  )
}
