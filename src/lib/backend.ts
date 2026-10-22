import { getBackendAccessToken } from './auth'
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
  DicomUploadResponse,
} from '../types'

const API_BASE = '/api/v1'

export class BackendUnavailableError extends Error {
  constructor(message = 'FastAPI backend is not reachable. Start it with: cd backend && uvicorn app.main:app --port 8000') {
    super(message)
    this.name = 'BackendUnavailableError'
  }
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

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  } catch {
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
  return res.json() as Promise<T>
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

export async function backendAuthStatus(): Promise<{ auth_enabled: boolean }> {
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

export async function fetchBackendHealth(): Promise<BackendHealth> {
  return request('/health')
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
}): Promise<BackendPipelineResult> {
  const { modality, anatomical_region } = scenarioRouting(input.scenario)
  const created = await request<{ case_id: string }>('/cases', {
    method: 'POST',
    body: JSON.stringify({
      patient_name: input.patientName,
      species: toBackendSpecies(input.species),
      breed: input.breed || null,
      modality,
      anatomical_region,
      clinical_history: input.clinicalHistory || 'Synthetic demo case. Not a real patient.',
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
  return request<DicomUploadResponse>('/dicom/upload', { method: 'POST', body: form })
}

/** Server-side synthetic DICOM fixtures (no real PHI). */
export async function uploadDicomDemo(input: {
  kind: DicomDemoKind
  patientName: string
  species: Species
  breed?: string
  clinicalHistory?: string
}): Promise<DicomUploadResponse> {
  const form = new FormData()
  form.append('patient_name', input.patientName)
  form.append('species', toBackendSpecies(input.species))
  if (input.breed) form.append('breed', input.breed)
  if (input.clinicalHistory) form.append('clinical_history', input.clinicalHistory)
  form.append('referring_clinic', 'Ornek Veteriner Klinigi (demo)')
  return request<DicomUploadResponse>(`/dicom/demo/${input.kind}`, { method: 'POST', body: form })
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

/** Enqueue background analyze and poll until completed/failed. */
export async function analyzeCaseAsyncAndWait(
  caseId: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<BackendPipelineResult> {
  const timeoutMs = opts?.timeoutMs ?? 15_000
  const intervalMs = opts?.intervalMs ?? 120
  const job = await request<{ job_id: string; status: string; case_id: string }>(
    `/cases/${caseId}/analyze/async`,
    { method: 'POST' },
  )
  const deadline = Date.now() + timeoutMs
  let status = job.status
  while (Date.now() < deadline) {
    const polled = await request<{
      job_id: string
      case_id: string
      status: string
      outcome: BackendPipelineResult['outcome'] | null
      error_message?: string | null
      routed_model_ids?: string[]
      route_reason?: string | null
    }>(`/jobs/${job.job_id}`)
    status = polled.status
    if (status === 'completed' || status === 'failed') {
      const [findings, report, caseRecord] = await Promise.all([
        request<BackendFindings | null>(`/cases/${caseId}/findings`).catch(() => null),
        request<BackendDraftReport | null>(`/cases/${caseId}/report`).catch(() => null),
        getBackendCase(caseId),
      ])
      const outcome =
        (polled.outcome as BackendPipelineResult['outcome'] | null) ??
        (status === 'failed' ? 'failed' : caseRecord.status === 'manual_review' ? 'unsupported' : 'success')
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
        messages: ['Async analyze (demo thread worker) completed.'],
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`Analyze job ${job.job_id} timed out (last status=${status}).`)
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
}): Promise<BackendCaseRecord> {
  return request<BackendCaseRecord>(`/dicom/ingestions/${input.ingestId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({
      accept_suggestion: input.acceptSuggestion,
      modality: input.modality ?? null,
      anatomical_region: input.anatomicalRegion ?? null,
      patient_name: input.patientName ?? null,
      clinical_history: input.clinicalHistory ?? null,
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
}): Promise<BackendPipelineResult> {
  const caseRecord = await confirmDicomClassification(input)
  return analyzeCaseAsyncAndWait(caseRecord.case_id)
}

export async function listBackendCases(): Promise<BackendCaseSummary[]> {
  return request<BackendCaseSummary[]>('/cases')
}

export async function getBackendCase(caseId: string): Promise<BackendCaseRecord> {
  return request<BackendCaseRecord>(`/cases/${caseId}`)
}

export interface CaseDicomFileList {
  case_id: string
  ingest_id?: string | null
  files: { index: number; filename: string; size_bytes: number; content_kind: string }[]
  note: string
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
