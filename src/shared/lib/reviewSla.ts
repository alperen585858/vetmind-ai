/** Expert response SLA helpers (urgent/STAT = 24h, else = 48h). */

export type SlaTone = 'ok' | 'warn' | 'critical' | 'overdue' | 'none'

/** Dashboard / worklist “süresi az kalan” bucket (broader than notify threshold). */
export const SLA_ATTENTION_WITHIN_MS = 12 * 3_600_000

export function slaHoursForPriority(priority: string | undefined | null): number {
  if (priority === 'STAT' || priority === 'Acil' || priority === 'stat' || priority === 'urgent') {
    return 24
  }
  return 48
}

export function remainingMs(reviewDueAt: string | null | undefined, now = Date.now()): number | null {
  if (!reviewDueAt) return null
  const due = Date.parse(reviewDueAt)
  if (Number.isNaN(due)) return null
  return due - now
}

export function slaTone(reviewDueAt: string | null | undefined, now = Date.now()): SlaTone {
  const rem = remainingMs(reviewDueAt, now)
  if (rem == null) return 'none'
  if (rem <= 0) return 'overdue'
  const hours = rem / 3_600_000
  if (hours <= 2) return 'critical'
  if (hours <= 6) return 'warn'
  return 'ok'
}

/** Cases the expert should jump to first: overdue or ≤12h left. */
export function isSlaAttention(reviewDueAt: string | null | undefined, now = Date.now()): boolean {
  const rem = remainingMs(reviewDueAt, now)
  if (rem == null) return false
  return rem <= SLA_ATTENTION_WITHIN_MS
}

export function compareBySlaUrgency(
  aDue: string | null | undefined,
  bDue: string | null | undefined,
  now = Date.now(),
): number {
  const a = remainingMs(aDue, now)
  const b = remainingMs(bDue, now)
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a - b
}

export type SlaFormatLabels = {
  overdue?: string
  hoursMins?: (h: number, m: number) => string
  minsOnly?: (m: number) => string
  remainingSuffix?: string
}

/** Build SLA labels from `t('cases.detail.sla*')` keys. */
export function slaLabelsFromT(t: (key: string, params?: Record<string, string | number>) => string): SlaFormatLabels {
  return {
    overdue: t('cases.detail.slaOverdue'),
    hoursMins: (h, m) => t('cases.detail.slaHoursMins', { h, m }),
    minsOnly: (m) => t('cases.detail.slaMins', { m }),
    remainingSuffix: t('cases.detail.slaRemainingSuffix'),
  }
}

export function formatSlaRemaining(
  reviewDueAt: string | null | undefined,
  now = Date.now(),
  labels?: SlaFormatLabels,
): string {
  const rem = remainingMs(reviewDueAt, now)
  if (rem == null) return '—'
  if (rem <= 0) return labels?.overdue ?? 'Süresi geçmiş'
  const h = Math.floor(rem / 3_600_000)
  const m = Math.floor((rem % 3_600_000) / 60_000)
  const label =
    h > 0
      ? labels?.hoursMins?.(h, m) ?? `${h} sa ${m} dk`
      : labels?.minsOnly?.(Math.max(1, m)) ?? `${Math.max(1, m)} dk`
  const suffix = labels?.remainingSuffix ?? 'kaldı'
  return `${label} ${suffix}`.trim()
}

export function slaRowClass(tone: SlaTone): string {
  switch (tone) {
    case 'overdue':
    case 'critical':
      return 'bg-rose-50/90'
    case 'warn':
      return 'bg-amber-50/70'
    default:
      return ''
  }
}

export function slaBadgeClass(tone: SlaTone): string {
  switch (tone) {
    case 'overdue':
    case 'critical':
      return 'bg-rose-600 text-white ring-rose-700'
    case 'warn':
      return 'bg-amber-500 text-white ring-amber-600'
    case 'ok':
      return 'bg-slate-100 text-slate-700 ring-slate-200'
    default:
      return 'bg-slate-50 text-slate-500 ring-slate-200'
  }
}
