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

/**
 * Create a synthetic case and run mock analysis synchronously.
 * The analyze endpoint blocks until the pipeline finishes; job_id is a run id, not a queue ticket.
 */
export async function createAndAnalyzeCase(input: {
  patientName: string
  species: Species
  breed: string
  clinicalHistory: string
  scenario: BackendScenario
}): Promise<BackendPipelineResult> {
  const modality = 'MR'
  const anatomical_region = input.scenario === 'cervical_mri_suspected' ? 'CERVICAL' : 'BRAIN'
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
  return request<BackendPipelineResult>(`/cases/${created.case_id}/analyze`, { method: 'POST' })
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
  kind: 'brain_mri' | 'cervical_mri'
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

/** Fetch synthetic .dcm bytes for the in-browser viewer (display only). */
export async function fetchDemoDicomFiles(kind: 'brain_mri' | 'cervical_mri', count = 2): Promise<File[]> {
  const out: File[] = []
  for (let i = 0; i < count; i++) {
    let res: Response
    try {
      res = await fetch(`${API_BASE}/dicom/fixtures/${kind}/${i}`)
    } catch {
      throw new BackendUnavailableError()
    }
    if (!res.ok) throw new Error(`Demo DICOM indirilemedi (${kind} #${i})`)
    const blob = await res.blob()
    const name = kind === 'brain_mri' ? `brain_mr_${i + 1}.dcm` : `cervical_mr_${i + 1}.dcm`
    out.push(new File([blob], name, { type: 'application/dicom' }))
  }
  return out
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

/** Confirm DICOM classification, then run synchronous mock analyze. */
export async function confirmDicomAndAnalyze(input: {
  ingestId: string
  acceptSuggestion: boolean
  modality?: BackendModality
  anatomicalRegion?: BackendAnatomicalRegion
  patientName?: string
  clinicalHistory?: string
}): Promise<BackendPipelineResult> {
  const caseRecord = await confirmDicomClassification(input)
  return request<BackendPipelineResult>(`/cases/${caseRecord.case_id}/analyze`, { method: 'POST' })
}

export async function listBackendCases(): Promise<BackendCaseSummary[]> {
  return request<BackendCaseSummary[]>('/cases')
}

export async function getBackendCase(caseId: string): Promise<BackendCaseRecord> {
  return request<BackendCaseRecord>(`/cases/${caseId}`)
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
