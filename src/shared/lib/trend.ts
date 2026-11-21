import type { TranslateFn } from '../../i18n'
import type { VetCase } from '../types'

export function dayKey(iso: string) {
  return iso.slice(0, 10)
}

export function buildTrend(cases: VetCase[], t: TranslateFn) {
  const days: { key: string; label: string; yeni: number; tamamlanan: number; inceleme: number }[] = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const m = d.getMonth() + 1
    days.push({ key, label: `${d.getDate()} ${t(`format.month${m}`)}`, yeni: 0, tamamlanan: 0, inceleme: 0 })
  }
  const byKey = Object.fromEntries(days.map((x) => [x.key, x]))
  for (const c of cases) {
    const k = dayKey(c.createdAt)
    const row = byKey[k]
    if (!row) continue
    row.yeni += 1
    if (c.status === 'onaylandi') row.tamamlanan += 1
    if (c.status === 'uzman_incelemesinde' || c.status === 'revizyon') row.inceleme += 1
  }
  return days
}
