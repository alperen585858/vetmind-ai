import type { AuditFilters, AuditOutcome } from '../../shared/api'

type Translate = (key: string, vars?: Record<string, string | number>) => string

/** Event types with a readable name (TR/EN under security.events.*); others show raw. */
export const NAMED_EVENTS = [
  'auth.login',
  'auth.logout',
  'auth.refresh',
  'auth.failure',
  'auth.register',
  'auth.rate_limited',
  'auth.password_change',
  'auth.password_forgot',
  'auth.password_reset',
  'auth.verify_email',
  'auth.verify_email_resend',
  'admin.password_reset_link',
  'admin.audit_view',
  'admin.audit_export',
  'case.create',
  'case.read',
  'dicom.upload',
  'dicom.list',
  'dicom.retrieve',
  'report_link.view',
  'training.export',
  'patient.create',
  'patient.update',
  'patient.link_case',
  'patient.unlink_case',
  'patient.merge',
] as const

const NAMED = new Set<string>(NAMED_EVENTS)

export function eventKey(eventType: string): string {
  return `security.events.${eventType.replace(/\./g, '_')}`
}

export function eventLabel(t: Translate, eventType: string): string {
  return NAMED.has(eventType) ? t(eventKey(eventType)) : eventType
}

/** Filter-bar groups: value is an exact type or a "prefix." */
export const EVENT_GROUPS = ['', 'auth.login', 'auth.', 'admin.', 'case.', 'patient.', 'dicom.', 'report_link.'] as const

const OUTCOMES: readonly AuditOutcome[] = ['success', 'denied', 'error', 'info']

/** Filters live in the address bar so a filtered view can be shared as a link. */
export function filtersFromSearch(params: URLSearchParams): AuditFilters {
  const outcome = params.get('sonuc') ?? ''
  return {
    event_type: params.get('olay') ?? '',
    actor: params.get('kisi') ?? '',
    outcome: (OUTCOMES as readonly string[]).includes(outcome) ? (outcome as AuditOutcome) : '',
    since: params.get('baslangic') ?? '',
    until: params.get('bitis') ?? '',
  }
}

export function filtersToSearch(filters: AuditFilters): URLSearchParams {
  const out = new URLSearchParams()
  const map: [keyof AuditFilters, string][] = [
    ['event_type', 'olay'],
    ['actor', 'kisi'],
    ['outcome', 'sonuc'],
    ['since', 'baslangic'],
    ['until', 'bitis'],
  ]
  for (const [key, param] of map) {
    const value = (filters[key] ?? '').toString().trim()
    if (value) out.set(param, value)
  }
  return out
}

/** Date inputs give YYYY-MM-DD; the API wants instants. "until" covers the whole day. */
export function toApiFilters(filters: AuditFilters): AuditFilters {
  const day = (value: string | undefined, endOfDay: boolean) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
    const d = new Date(`${value}T00:00:00`)
    if (endOfDay) d.setDate(d.getDate() + 1)
    return d.toISOString()
  }
  return {
    event_type: filters.event_type || undefined,
    actor: filters.actor?.trim() || undefined,
    outcome: filters.outcome || undefined,
    since: day(filters.since, false),
    until: day(filters.until, true),
  }
}
