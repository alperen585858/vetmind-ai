import type { TranslateFn } from '../../../i18n'
import { demoAccountName } from '../../../shared/auth/session'
import type { TimelineEvent } from '../../../shared/types'

export type ActivityEvent = { event_id: string; kind: string; actor_subject: string; at: string; detail?: string | null }

export type TimelineRow = { key: string; at: string; label: string; by: string; tone: 'status' | 'action' }

/** Activity kinds with a translated label (cases.activity.<kind>); others show the raw kind. */
const ACTIVITY_KINDS = new Set([
  'case_message',
  'ai_chat',
  'clinical_note',
  'internal_note',
  'info_request_opened',
  'info_request_answered',
  'info_request_closed',
  'document_attached',
  'owner_contact_updated',
  'case_cancelled',
  'report_delivered',
  'ai_regenerated',
  'vet_report_email_sent',
])

/** Who did it (#69): the person's name where known, "System" for automatic steps. */
export function actorName(subject: string | undefined, t: TranslateFn): string {
  const s = (subject ?? '').trim()
  if (!s || s === 'system' || s === 'Sistem' || s === 'anonymous') return t('cases.detail.actorSystem')
  return demoAccountName(s) ?? s
}

/**
 * #69/#73: the case's single timeline, shown on the History tab. Status milestones from the
 * record and the real activity events, oldest first; ties keep their original order.
 */
export function buildCaseTimeline(milestones: TimelineEvent[], activity: ActivityEvent[], t: TranslateFn): TimelineRow[] {
  const rows: TimelineRow[] = [
    ...milestones.map((m, i) => ({
      key: `m-${i}`,
      at: m.date,
      label: m.label,
      by: actorName(m.by, t),
      tone: 'status' as const,
    })),
    ...activity.map((e) => ({
      key: e.event_id,
      at: e.at,
      label: ACTIVITY_KINDS.has(e.kind) ? t(`cases.activity.${e.kind}`) : e.kind,
      by: actorName(e.actor_subject, t),
      tone: 'action' as const,
    })),
  ]
  return rows
    .map((row, index) => ({ row, index, ms: Date.parse(row.at) }))
    .sort((a, b) => (Number.isNaN(a.ms) || Number.isNaN(b.ms) ? 0 : a.ms - b.ms) || a.index - b.index)
    .map(({ row }) => row)
}
