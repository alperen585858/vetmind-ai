import type { BackendSupportMessage } from '../../../shared/types'

/** A message as shown in the UI: server messages plus optimistic ones still sending. */
export type UiMessage = BackendSupportMessage & { localState?: 'sending' | 'failed'; localId?: string }

export type MessageGroup = { day: string; runs: { author: string; role: string; items: UiMessage[] }[] }

/** Avatar letters: first + last word ("Dr. Ayşe Kaya" -> "DK"), punctuation ignored. */
export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toLocaleUpperCase('tr')
}

/** YYYY-MM-DD in the browser's time zone (a message at 00:30 belongs to that local day). */
export function localDayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Group by local day, then by consecutive author (name/avatar shown once per run). */
export function groupMessages(messages: UiMessage[]): MessageGroup[] {
  const out: MessageGroup[] = []
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
