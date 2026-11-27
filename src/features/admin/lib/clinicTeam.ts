import type { TranslateFn } from '../../../i18n'
import { isSlaAttention } from '../../../shared/lib/reviewSla'
import { reviewerDisplay } from '../../../shared/lib/reviewer'
import type { BackendManagedUser, VetCase } from '../../../shared/types'
import { isAwaitingReport, isOverdueCase } from '../../cases/lib/caseStatusMap'

export type TeamCounts = { total: number; open: number; overdue: number; dueSoon: number; approved: number }

export type RadiologistRow = TeamCounts & { id: string; name: string; openCases: VetCase[] }

export type VetRow = TeamCounts & {
  email: string
  name: string
  active: boolean | null
  recent: VetCase[]
}

function emptyCounts(): TeamCounts {
  return { total: 0, open: 0, overdue: 0, dueSoon: 0, approved: 0 }
}

function addCase(row: TeamCounts, c: VetCase) {
  row.total += 1
  if (c.status === 'onaylandi') row.approved += 1
  if (!isAwaitingReport(c.status)) return
  row.open += 1
  if (isOverdueCase(c)) row.overdue += 1
  else if (isSlaAttention(c.reviewDueAt)) row.dueSoon += 1
}

/** Overdue first, then least time left, then newest. */
function byUrgency(a: VetCase, b: VetCase) {
  const da = a.reviewDueAt ? Date.parse(a.reviewDueAt) : Infinity
  const db = b.reviewDueAt ? Date.parse(b.reviewDueAt) : Infinity
  if (da !== db) return da - db
  return b.createdAt.localeCompare(a.createdAt)
}

/** Radiologists with cases at this clinic, plus the open cases nobody has been assigned. */
export function radiologistRows(cases: VetCase[], t: TranslateFn, locale: string) {
  const byId = new Map<string, RadiologistRow>()
  const unassigned: VetCase[] = []
  let overdue = 0
  for (const c of cases) {
    if (c.status === 'iptal') continue
    if (isOverdueCase(c)) overdue += 1
    const id = c.assignedReviewerId?.trim()
    if (!id) {
      if (isAwaitingReport(c.status)) unassigned.push(c)
      continue
    }
    const row = byId.get(id) ?? { id, name: reviewerDisplay(c, t), openCases: [], ...emptyCounts() }
    addCase(row, c)
    if (isAwaitingReport(c.status)) row.openCases.push(c)
    byId.set(id, row)
  }
  const rows = [...byId.values()]
  for (const r of rows) r.openCases.sort(byUrgency)
  rows.sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name, locale))
  return { rows, unassigned: unassigned.sort(byUrgency), overdue }
}

/** The clinic's vets (staff list) with the cases each one sent; senders not in the staff list are added too. */
export function vetRows(cases: VetCase[], staff: BackendManagedUser[], locale: string): VetRow[] {
  const byEmail = new Map<string, VetRow>()
  for (const s of staff) {
    if (s.role !== 'vet') continue
    const email = s.email.toLowerCase()
    byEmail.set(email, { email, name: s.display_name || s.email, active: s.active, recent: [], ...emptyCounts() })
  }
  for (const c of cases) {
    if (c.status === 'iptal') continue
    const email = c.submittedBy?.trim().toLowerCase()
    if (!email) continue
    // Without a staff list (backend offline) show every sender; otherwise only the clinic's vets.
    if (!byEmail.has(email) && staff.length) continue
    const row = byEmail.get(email) ?? { email, name: email, active: null, recent: [], ...emptyCounts() }
    addCase(row, c)
    row.recent.push(c)
    byEmail.set(email, row)
  }
  const rows = [...byEmail.values()]
  for (const r of rows) r.recent.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  rows.sort((a, b) => b.open - a.open || b.total - a.total || a.name.localeCompare(b.name, locale))
  return rows
}
