import type { TranslateFn } from '../../i18n'
import { fmtDate } from '../../shared/lib/format'
import type { BackendSupportMessage, BackendSupportThreadSummary, SupportMessageChannel } from '../../shared/types'

// --- helpers ---------------------------------------------------------------------------

export type Filter = 'all' | 'unread' | 'radiologist' | 'admin' | 'clinic'

/** A message as shown in the UI: server messages plus optimistic ones still sending. */
export type UiMessage = BackendSupportMessage & { localState?: 'sending' | 'failed'; localId?: string }

/** Demo rows saved before messages were attributed to a person (auth-off only); the
 * backend allows deleting them only in auth-off demo mode. */
export const LEGACY_DEMO_SUBJECTS = new Set(['anonymous', 'demo'])

export const UNDO_TOAST_MS = 10_000
export const TYPING_SHOW_MS = 4_000
export const TYPING_PING_MS = 3_000

export function channelLabel(channel: SupportMessageChannel, t: TranslateFn) {
  if (channel === 'admin') return t('messages.channelAdmin')
  if (channel === 'clinic') return t('messages.channelClinic')
  return t('messages.channelRadiologist')
}

export function roleLabel(role: string, t: TranslateFn): string {
  const keys: Record<string, string> = {
    owner: 'messages.roleOwner', // legacy rows only
    support: 'messages.roleSupport',
    expert: 'messages.roleExpert',
    admin: 'messages.roleAdmin',
    vet: 'messages.roleVet',
    clinic_owner: 'messages.roleClinicOwner',
    demo: 'messages.roleDemo',
    service: 'messages.roleService',
  }
  return keys[role] ? t(keys[role]) : role
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toLocaleUpperCase('tr')
}

export function avatarTone(role: string | null | undefined) {
  if (role === 'support' || role === 'admin') return 'bg-sky-100 text-sky-800'
  if (role === 'expert') return 'bg-violet-100 text-violet-800'
  if (role === 'clinic_owner') return 'bg-amber-100 text-amber-800'
  return 'bg-teal-100 text-teal-800'
}

export function clock(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

export function localDayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function dayLabel(iso: string, locale: 'tr' | 'en', t: TranslateFn): string {
  const key = localDayKey(iso)
  const now = new Date()
  const today = localDayKey(now.toISOString())
  const yesterday = localDayKey(new Date(now.getTime() - 86_400_000).toISOString())
  if (key === today) return t('messages.today')
  if (key === yesterday) return t('messages.yesterday')
  return fmtDate(key, locale)
}

export function listTime(iso: string | null | undefined, locale: 'tr' | 'en', t: TranslateFn): string {
  if (!iso) return ''
  if (localDayKey(iso) === localDayKey(new Date().toISOString())) return clock(iso)
  return dayLabel(iso, locale, t).replace(/\s\d{4}$/, '')
}

export type Group = { day: string; runs: { author: string; role: string; items: UiMessage[] }[] }

/** Group by local day, then by consecutive author (name/avatar shown once per run). */
export function groupMessages(messages: UiMessage[]): Group[] {
  const out: Group[] = []
  for (const m of messages) {
    const day = localDayKey(m.created_at)
    let g = out[out.length - 1]
    if (!g || g.day !== day) {
      g = { day, runs: [] }
      out.push(g)
    }
    const run = g.runs[g.runs.length - 1]
    if (run && run.author === m.author_subject) run.items.push(m)
    else g.runs.push({ author: m.author_subject, role: m.author_role, items: [m] })
  }
  return out
}

// --- page ------------------------------------------------------------------------------

/** Newest first, then the chip filter and the free-text search (subject, preview, names). */
export function filterThreads(
  threads: BackendSupportThreadSummary[],
  filter: Filter,
  query: string,
): BackendSupportThreadSummary[] {
  const q = query.trim().toLocaleLowerCase('tr')
  return [...threads]
    .sort((a, b) => (b.last_message_at || b.updated_at || '').localeCompare(a.last_message_at || a.updated_at || ''))
    .filter((th) => {
      if (filter === 'unread' && th.unread_count === 0) return false
      if (filter === 'radiologist' && th.channel !== 'radiologist') return false
      if (filter === 'admin' && th.channel !== 'admin') return false
      if (filter === 'clinic' && th.channel !== 'clinic') return false
      if (!q) return true
      return [th.subject, th.last_message_preview, th.counterpart_name, th.owner_subject]
        .filter(Boolean)
        .some((f) => String(f).toLocaleLowerCase('tr').includes(q))
    })
}

/** Participants (and admins) may delete a whole conversation. */
export function canDeleteThread(th: BackendSupportThreadSummary | undefined, role: string | null | undefined, me: string): boolean {
  return Boolean(
    th && (role === 'admin' || th.owner_subject === me || th.recipient_subject === me || LEGACY_DEMO_SUBJECTS.has(th.owner_subject)),
  )
}
