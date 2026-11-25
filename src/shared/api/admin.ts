import { BackendUnavailableError, request } from './client'

export type BackendHealth = {
  status: string
  mode: string
  version: string
  storage: string
  sqlite_path?: string
  quarantine_root?: string
  rag: string
  /** #101: which embedding runs; fell_back = bge-m3 requested but Ollama unreachable. */
  rag_embedding?: {
    requested: string
    active: string
    model: string
    fell_back: boolean
    warning: string
  } | null
  rag_store?: string | null
  job_backend: string
  auth_enabled: boolean
  vision_endpoint: boolean
  deployment_mode?: string
  vlm_enabled?: boolean
  llm_provider?: string
  smtp_configured?: boolean
  demo_apis_enabled?: boolean
  self_registration_enabled?: boolean
  rate_limit_backend?: string
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

// --- Live AI architecture diagram (admin) ---

/** active = real / always-on step · mock = mock output · fallback = running but not as requested · off = not configured */
export type ArchitectureStatus = 'active' | 'mock' | 'fallback' | 'off'

export type ArchitectureNode = {
  id: string
  label: string
  status: ArchitectureStatus
  detail: string
  info: Record<string, string>
  /** Router branch name (X-Ray, CT …) for nodes in the branch row. */
  branch_label?: string
  /** Analyses of this branch among the most recent cases. */
  recent_uses?: number
}

export type ArchitectureResponse = {
  generated_at: string
  rows: string[][]
  side_nodes: string[]
  nodes: Record<string, ArchitectureNode>
  summary: { real: number; mock: number; fallback: number; off: number; recent_jobs: number }
}

export async function fetchArchitecture(): Promise<ArchitectureResponse> {
  return request('/admin/architecture')
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
  attempt?: number
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
  repeats?: number
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

export interface ClassificationFieldSummary {
  labels: string[]
  matrix: number[][]
  accuracy: number
  macro_f1: number
  per_class: Record<string, { precision: number; recall: number; f1: number; specificity: number; support: number }>
  n: number
}

export interface ClassificationEvalRun {
  label: string
  classifier: string
  summary: {
    modality: ClassificationFieldSummary
    region: ClassificationFieldSummary
    species: ClassificationFieldSummary | null
    n_cases: number
    synthetic: boolean
    clinical_validation: boolean
    note: string
  }
  cases: Array<{
    case_id: string
    title: string
    modality: { gold: string; pred: string; correct: boolean }
    region: { gold: string; pred: string; correct: boolean }
    species: { gold: string; pred: string; correct: boolean } | null
    needs_confirmation: boolean
    disagreement: boolean
  }>
}

export interface ClassificationEvalResult {
  file: string
  set: string
  set_version: number
  set_note?: string
  synthetic?: boolean
  clinical_validation?: boolean
  runs: ClassificationEvalRun[]
}

/** Latest scripts/classification_eval.py result, or null when none has been run yet. */
export async function fetchLatestClassificationEval(): Promise<ClassificationEvalResult | null> {
  try {
    return await request<ClassificationEvalResult>('/dicom/eval/latest')
  } catch (err) {
    if (err instanceof BackendUnavailableError) throw err
    return null
  }
}

export interface RetentionPlanResponse {
  dry_run: boolean
  planned: { kind: string; target: string; reason: string; blocked: boolean; block_reason?: string | null }[]
  applied: string[]
  skipped_blocked: string[]
  temp_cleanup_would_remove?: number
  temp_cleanup_removed?: number
  audit_log_lines_removed?: number
  policy?: {
    dicom_days: number | null
    reports_days: number | null
    temp_hours: number
    preserve_approved_reports: boolean
  }
}

export async function fetchRetentionPlan(): Promise<RetentionPlanResponse> {
  return request('/admin/retention/plan')
}

export async function applyRetentionPlan(): Promise<RetentionPlanResponse> {
  return request('/admin/retention/apply', { method: 'POST' })
}

/** Expert revision note remembered for similar cases (backend app/llm/lessons.py). */
export interface RevisionLesson {
  lesson_id: string
  instruction: string
  region: string
  species: string
  modality: string
  finding_codes: string[]
  reason_codes: string[]
  source_case_id?: string | null
  created_by: string
  created_at: string
  active: boolean
  times_applied: number
  last_applied_at?: string | null
}

export async function listLessons(): Promise<RevisionLesson[]> {
  return request('/lessons')
}

export async function createLesson(caseId: string, instruction: string, reasonCodes: string[] = []) {
  return request<RevisionLesson>('/lessons', {
    method: 'POST',
    body: JSON.stringify({ case_id: caseId, instruction, reason_codes: reasonCodes }),
  })
}

export async function updateLesson(lessonId: string, patch: { active?: boolean; instruction?: string }) {
  return request<RevisionLesson>(`/lessons/${encodeURIComponent(lessonId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function deleteLesson(lessonId: string) {
  await request<void>(`/lessons/${encodeURIComponent(lessonId)}`, { method: 'DELETE' })
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

/** Admin: single-use password reset link for a user (nothing is emailed). */
export async function createPasswordResetLink(
  email: string,
): Promise<{ email: string; link: string; expires_in: number }> {
  return request(`/admin/users/${encodeURIComponent(email)}/reset-link`, { method: 'POST' })
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

export async function fetchRadiologistPayoutLedger() {
  return request<import('../types').BackendRadiologistPayoutLedger>('/admin/radiologist-payouts')
}

export async function fetchRadiologistPayoutDetail(email: string) {
  return request<import('../types').BackendRadiologistPayoutDetail>(
    `/admin/radiologist-payouts/${encodeURIComponent(email)}`,
  )
}

export async function markRadiologistPaid(email: string, caseIds?: string[]) {
  return request<import('../types').BackendRadiologistPayoutDetail>(
    `/admin/radiologist-payouts/${encodeURIComponent(email)}/mark-paid`,
    {
      method: 'POST',
      body: JSON.stringify(caseIds ? { case_ids: caseIds } : {}),
    },
  )
}

export async function updateRadiologistPayoutFee(feePerCase: number, applyToUnpaid = true) {
  return request<import('../types').BackendRadiologistPayoutSettings>(
    '/admin/radiologist-payouts/settings',
    {
      method: 'PUT',
      body: JSON.stringify({ fee_per_case: feePerCase, apply_to_unpaid: applyToUnpaid }),
    },
  )
}

export type TrainingExportPolicy = 'verified_only' | 'accepted_or_verified' | 'all'

export type TrainingExportResult = {
  manifest: {
    export_id: string
    dataset_version: string
    policy: string
    row_count: number
    source_case_ids?: string[]
    split_counts?: Record<string, number>
    created_by?: string
    [key: string]: unknown
  }
  jsonl: string
  rows: Record<string, unknown>[]
  splits?: Record<string, Record<string, unknown>[]> | null
}

/** Expert/admin: verified annotation export for offline training (CAP_TRAINING_VERIFY). */
export async function exportTrainingDataset(body: {
  dataset_version: string
  policy?: TrainingExportPolicy
  case_ids?: string[]
  max_cases?: number
  include_splits?: boolean
  split_salt?: string
  train_frac?: number
  val_frac?: number
}): Promise<TrainingExportResult> {
  return request<TrainingExportResult>('/training/export', {
    method: 'POST',
    body: JSON.stringify({
      dataset_version: body.dataset_version,
      policy: body.policy ?? 'verified_only',
      case_ids: body.case_ids,
      max_cases: body.max_cases ?? 200,
      include_splits: body.include_splits ?? true,
      split_salt: body.split_salt,
      train_frac: body.train_frac,
      val_frac: body.val_frac,
    }),
  })
}
