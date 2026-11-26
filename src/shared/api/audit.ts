import { fetchWithAuth, request } from './client'

/** Issue #106: admin security / audit log (read-only). */

export type AuditOutcome = 'success' | 'denied' | 'error' | 'info'

export interface AuditEventRow {
  event_id: string
  timestamp: string
  event_type: string
  actor: string
  resource: string
  outcome: AuditOutcome | string
  detail?: string | null
  clinic_id?: string | null
  suspicious: boolean
}

export interface AuditPage {
  items: AuditEventRow[]
  next_cursor?: string | null
  scoped_to_clinic?: string | null
}

export interface AuditSuspiciousItem {
  kind: 'failed_logins' | 'rate_limited' | 'refresh_reuse'
  actor?: string | null
  count: number
  first_at: string
  last_at: string
}

export interface AuditSummary {
  events_24h: number
  events_7d: number
  logins_24h: number
  failed_logins_24h: number
  rate_limited_24h: number
  by_type_7d: { event_type: string; count: number }[]
  suspicious: AuditSuspiciousItem[]
  scoped_to_clinic?: string | null
}

export interface AuditFilters {
  event_type?: string
  actor?: string
  outcome?: AuditOutcome | ''
  since?: string
  until?: string
}

function query(filters: AuditFilters, extra: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries({ ...filters, ...extra })) {
    if (v !== undefined && v !== null && String(v).trim() !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export async function listAuditEvents(
  filters: AuditFilters,
  opts?: { cursor?: string | null; limit?: number; signal?: AbortSignal },
): Promise<AuditPage> {
  return request(`/admin/audit${query(filters, { cursor: opts?.cursor ?? undefined, limit: opts?.limit ?? 50 })}`, {
    signal: opts?.signal,
  })
}

export async function getAuditSummary(): Promise<AuditSummary> {
  return request('/admin/audit/summary')
}

/** Download the filtered audit log as CSV (max 5 000 rows). Returns the row count. */
export async function downloadAuditCsv(filters: AuditFilters): Promise<{ rows: number; truncated: boolean }> {
  const res = await fetchWithAuth(`/admin/audit/export.csv${query(filters)}`)
  if (!res.ok) throw new Error(`CSV export failed (${res.status})`)
  const blob = await res.blob()
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'vetmind-audit.csv'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return { rows: Number(res.headers.get('X-Audit-Rows') ?? 0), truncated: res.headers.get('X-Audit-Truncated') === '1' }
}
