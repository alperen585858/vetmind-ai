/**
 * DICOM workspace workflow phases (no payment).
 *
 * Ingest-level (frontend / DicomIngestionRecord):
 *   EMPTY → SELECTING → VALIDATING → UPLOADING → UPLOADED → READY_FOR_CONFIRMATION
 *
 * After confirm creates a CaseRecord (classification_confirmed=True):
 *   CONFIRMED → QUEUED → PROCESSING → AWAITING_REVIEW | COMPLETED | FAILED
 *
 * Note: CaseLifecycleStatus.AWAITING_CLASSIFICATION_CONFIRMATION is reserved but unused.
 * Classification confirmation happens on the ingest record before a case exists.
 */

export type DicomWorkspacePhase =
  | 'EMPTY'
  | 'SELECTING'
  | 'VALIDATING'
  | 'UPLOADING'
  | 'UPLOADED'
  | 'READY_FOR_CONFIRMATION'
  | 'CONFIRMED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'AWAITING_REVIEW'
  | 'COMPLETED'
  | 'FAILED'

/** Phases that exist only in the UI / ingest session (not CaseLifecycleStatus). */
export const INGEST_UI_PHASES: ReadonlySet<DicomWorkspacePhase> = new Set([
  'EMPTY',
  'SELECTING',
  'VALIDATING',
  'UPLOADING',
  'UPLOADED',
  'READY_FOR_CONFIRMATION',
])

export type BackendLifecycleStatus =
  | 'created'
  | 'awaiting_classification_confirmation'
  | 'analyzing'
  | 'awaiting_review'
  | 'manual_review'
  | 'failed'
  | 'approved'
  | 'rejected'
  | 'revision_requested'
  | string

export type BackendJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'timed_out'
  | string

export type BackendPipelineOutcome = 'success' | 'partial' | 'unsupported' | 'failed' | string

/** Map persisted case lifecycle → workspace phase (best-effort). */
export function phaseFromBackendLifecycle(status: BackendLifecycleStatus): DicomWorkspacePhase {
  switch (status) {
    case 'awaiting_classification_confirmation':
      // Reserved enum — prefer ingest UI READY_FOR_CONFIRMATION before case exists.
      return 'READY_FOR_CONFIRMATION'
    case 'analyzing':
      return 'PROCESSING'
    case 'awaiting_review':
      return 'AWAITING_REVIEW'
    case 'manual_review':
      return 'AWAITING_REVIEW'
    case 'approved':
      return 'COMPLETED'
    case 'rejected':
      return 'FAILED'
    case 'revision_requested':
      return 'AWAITING_REVIEW'
    case 'failed':
      return 'FAILED'
    case 'created':
      return 'CONFIRMED'
    default:
      return 'CONFIRMED'
  }
}

export function phaseFromJobStatus(status: BackendJobStatus): DicomWorkspacePhase {
  if (status === 'queued') return 'QUEUED'
  if (status === 'running' || status === 'cancel_requested') return 'PROCESSING'
  if (status === 'failed' || status === 'cancelled' || status === 'timed_out') return 'FAILED'
  if (status === 'completed') return 'AWAITING_REVIEW'
  return 'PROCESSING'
}

export function phaseFromPipelineOutcome(outcome: BackendPipelineOutcome): DicomWorkspacePhase {
  if (outcome === 'failed') return 'FAILED'
  if (outcome === 'unsupported') return 'AWAITING_REVIEW'
  return 'AWAITING_REVIEW'
}

export function deriveSelectionPhase(input: {
  fileCount: number
  validating: boolean
  uploading: boolean
  previewReady: boolean
  previewBlocked: boolean
  confirmed: boolean
}): DicomWorkspacePhase {
  if (input.confirmed) return 'CONFIRMED'
  if (input.uploading) return 'UPLOADING'
  if (input.validating) return 'VALIDATING'
  if (input.previewBlocked) return 'FAILED'
  if (input.previewReady) return 'READY_FOR_CONFIRMATION'
  if (input.fileCount > 0) return 'UPLOADED'
  return 'EMPTY'
}

export type PatientFormInput = {
  patientName: string
  species: string
  consent: boolean
}

export type PatientFormErrors = {
  patientName?: string
  species?: string
  consent?: string
}

export function validatePatientForm(input: PatientFormInput): PatientFormErrors {
  const errors: PatientFormErrors = {}
  const name = input.patientName.trim()
  if (!name) errors.patientName = 'Hasta adı gerekli'
  else if (name.length > 120) errors.patientName = 'Hasta adı en fazla 120 karakter olabilir'
  if (!input.species) errors.species = 'Tür gerekli'
  if (!input.consent) {
    errors.consent = 'Klinik kullanım onayını işaretleyin'
  }
  return errors
}

export function isPatientFormValid(input: PatientFormInput): boolean {
  return Object.keys(validatePatientForm(input)).length === 0
}

/** Gate for starting demo/mock analysis (no payment prerequisites). */
export function canStartDemoAnalysis(input: {
  phase: DicomWorkspacePhase
  consent: boolean
  previewBlocked: boolean
  hasIngestOrDemo: boolean
}): { ok: boolean; reason?: string } {
  if (!input.consent) return { ok: false, reason: 'Consent required' }
  if (input.previewBlocked) return { ok: false, reason: 'Upload blocked' }
  if (!input.hasIngestOrDemo) return { ok: false, reason: 'No study' }
  if (input.phase === 'FAILED' || input.phase === 'PROCESSING' || input.phase === 'QUEUED') {
    return { ok: false, reason: 'Invalid phase' }
  }
  return { ok: true }
}

/**
 * Human-readable classification confirmation state for UI.
 * Ingest confirmation is separate from case lifecycle enums.
 */
export function classificationConfirmationLabel(input: {
  ingestAccepted?: boolean
  classificationConfirmed?: boolean
  needsConfirmation?: boolean
  blocked?: boolean
}): string {
  if (input.blocked) return 'Engellendi'
  if (input.classificationConfirmed || input.ingestAccepted) return 'Sınıflandırma onaylandı'
  if (input.needsConfirmation) return 'Sınıflandırma onayı bekleniyor'
  return 'Sınıflandırma bekleniyor'
}

export const PHASE_LABELS: Record<DicomWorkspacePhase, string> = {
  EMPTY: 'Boş',
  SELECTING: 'Seçiliyor',
  VALIDATING: 'Doğrulanıyor',
  UPLOADING: 'Yükleniyor',
  UPLOADED: 'Yüklendi',
  READY_FOR_CONFIRMATION: 'Sınıflandırma onayı',
  CONFIRMED: 'Vaka oluşturuldu',
  QUEUED: 'Kuyrukta',
  PROCESSING: 'İşleniyor',
  AWAITING_REVIEW: 'Uzman incelemesi',
  COMPLETED: 'Tamamlandı',
  FAILED: 'Başarısız',
}
