/**
 * Map backend error codes (and legacy English messages) to locale strings.
 * Unknown errors → generic localized message; raw text kept as technical detail.
 */
import type { TranslateFn } from '../../i18n'
import { ApiError, BackendUnavailableError } from '../api'

/** Legacy English `detail` strings → stable codes (until every endpoint returns `code`). */
const MESSAGE_TO_CODE: Record<string, string> = {
  'Invalid email or password.': 'invalid_credentials',
  'Self-registration is disabled.': 'self_registration_disabled',
  'Current password is incorrect.': 'wrong_current_password',
  'Sign in with a user account first.': 'sign_in_required',
  'Session expired. Please sign in again.': 'session_expired',
  'This reset link is invalid or has expired. Request a new one.': 'reset_link_invalid',
  'An account with this email already exists.': 'email_exists',
  'Enter a valid email address.': 'invalid_email',
  'This role cannot be self-registered.': 'role_not_self_registerable',
  'Owner submissions require veterinary verification before analysis.': 'needs_vet_verification',
  'Cannot analyze until DICOM metadata classification is confirmed.': 'classification_unconfirmed',
  'Cannot analyze: classification_confirmed is false.': 'classification_unconfirmed',
  'Analysis already in progress for this case.': 'analysis_in_progress',
  'No draft report to save.': 'no_draft',
  'Approved reports are immutable and cannot be edited in place.': 'report_immutable',
  'PDF only for approved cases.': 'pdf_not_approved',
  'No immutable approved report to export.': 'pdf_not_approved',
  'Selected version is not an approved immutable snapshot.': 'pdf_version_not_immutable',
  'DICOM ingestion not found.': 'dicom_not_found',
  'XR mock pipeline currently routes THORAX only.': 'xr_thorax_only',
  'Password must contain at least one letter and one digit.': 'password_needs_letter_digit',
}

const RATE_LIMIT_RE = /^Too many attempts\. Try again in (\d+) min\.$/
const APPROVED_REANALYZE_RE = /^Cannot re-analyze an approved case\./
const CONCURRENT_RE = /^Too many concurrent analyses \(max (\d+)\)\.$/
const PASSWORD_MIN_RE = /^Password must be at least (\d+) characters\.$/
const PASSWORD_MAX_RE = /^Password must be at most (\d+) characters\.$/

export type PresentedError = {
  /** Localized user-facing line */
  message: string
  /** Raw backend text (for optional secondary line) */
  technical: string
  code?: string
}

function inferFromMessage(message: string): { code?: string; params?: Record<string, string | number> } {
  const exact = MESSAGE_TO_CODE[message]
  if (exact) return { code: exact }

  let m = message.match(RATE_LIMIT_RE)
  if (m) return { code: 'rate_limited', params: { minutes: Number(m[1]) } }
  m = message.match(CONCURRENT_RE)
  if (m) return { code: 'concurrent_analyze_limit', params: { max: Number(m[1]) } }
  m = message.match(PASSWORD_MIN_RE)
  if (m) return { code: 'password_too_short', params: { min: Number(m[1]) } }
  m = message.match(PASSWORD_MAX_RE)
  if (m) return { code: 'password_too_long', params: { max: Number(m[1]) } }
  if (APPROVED_REANALYZE_RE.test(message)) return { code: 'approved_needs_revision' }
  if (message.includes('Pet owners attach DICOM')) return { code: 'owner_cannot_confirm' }
  if (message.includes('Blocked DICOM')) return { code: 'ingestion_blocked' }
  if (message.includes('no validated study/classification')) return { code: 'ingestion_incomplete' }
  if (message.includes('modality is unsupported')) return { code: 'unsupported_modality' }
  if (message.includes('anatomical region must be')) return { code: 'unsupported_region' }
  if (message.includes('routes BRAIN, CERVICAL or THORACOLUMBAR')) return { code: 'mr_ct_no_thorax' }
  return {}
}

function lookupCode(
  t: TranslateFn,
  code: string,
  params?: Record<string, string | number>,
): string | undefined {
  const key = `apiErrors.${code}`
  const text = t(key, params)
  // createTranslator returns the key itself when missing
  if (!text || text === key) return undefined
  return text
}

/** Resolve a user-facing error from ApiError / Error / unknown. */
export function presentApiError(err: unknown, t: TranslateFn): PresentedError {
  if (err instanceof BackendUnavailableError) {
    return { message: t('auth.backendUnreachable'), technical: err.message, code: 'backend_unavailable' }
  }

  let code: string | undefined
  let technical = ''
  let params: Record<string, string | number> | undefined

  if (err instanceof ApiError) {
    code = err.code
    technical = err.message
    params = err.params
    if (!code && technical) {
      const inferred = inferFromMessage(technical)
      code = inferred.code
      params = params ?? inferred.params
    }
  } else if (err instanceof Error) {
    technical = err.message
    const inferred = inferFromMessage(technical)
    code = inferred.code
    params = inferred.params
  } else if (typeof err === 'string') {
    technical = err
    const inferred = inferFromMessage(technical)
    code = inferred.code
    params = inferred.params
  }

  if (code) {
    const localized = lookupCode(t, code, params)
    if (localized) {
      return { message: localized, technical, code }
    }
    // Generic status code without a translation: a specific one may hide in the message.
    const inferred = technical ? inferFromMessage(technical) : {}
    const specific = inferred.code ? lookupCode(t, inferred.code, inferred.params ?? params) : undefined
    if (specific) return { message: specific, technical, code: inferred.code! }
  }

  // Heuristic fallbacks (status / network wording)
  const lower = technical.toLowerCase()
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network')) {
    return { message: t('apiErrors.network'), technical, code: 'network' }
  }
  if (lower.includes('internal server error') || /\b500\b/.test(technical)) {
    return { message: t('apiErrors.server'), technical, code: 'server' }
  }
  if (lower.includes('unauthorized') || lower.includes('forbidden') || /\b401\b/.test(technical) || /\b403\b/.test(technical)) {
    return { message: t('apiErrors.auth'), technical, code: 'auth' }
  }

  // Unknown: generic localized line + keep technical for secondary display
  return {
    message: t('apiErrors.unexpected'),
    technical: technical || t('apiErrors.unexpected'),
    code: code || 'unexpected',
  }
}

/** Single-string body for toasts / inline errors (message + optional technical line). */
export function userErrorMessage(err: unknown, t: TranslateFn): string {
  const { message, technical } = presentApiError(err, t)
  if (technical && technical !== message) return `${message}\n${technical}`
  return message
}

/** Toast body only (prefer localized; append technical when different). */
export function toastErrorBody(err: unknown, t: TranslateFn): string {
  return userErrorMessage(err, t)
}
