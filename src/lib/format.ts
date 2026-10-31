import { translate } from '../i18n'
import type { Locale } from '../i18n/types'

export function fmtDate(iso?: string, locale: Locale = 'tr') {
  if (!iso) return '—'
  const normalized = iso.includes('T') ? iso.replace('T', ' ').replace(/Z$/, '') : iso
  const [d, time] = normalized.split(' ')
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return iso
  const clock = time ? time.slice(0, 5) : ''
  const month = translate(locale, `format.month${m}`)
  return `${day} ${month} ${y}${clock ? ` · ${clock}` : ''}`
}

export function nowStamp() {
  const n = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`
}

export function today() {
  return nowStamp().split(' ')[0]
}
