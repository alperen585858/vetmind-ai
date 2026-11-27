import { useMemo, type ReactNode } from 'react'
import { ChevronRight, Clock, Loader2, UserPlus } from 'lucide-react'
import { useLocale } from '../../shared/shell/LocaleContext'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import { studyLabel } from '../../shared/lib/displayClean'
import {
  compareBySlaUrgency,
  formatSlaRemaining,
  isSlaAttention,
  slaHoursForPriority,
  slaLabelsFromT,
  slaTone,
} from '../../shared/lib/reviewSla'
import type { TranslateFn } from '../../i18n'
import type { Priority, VetCase } from '../../shared/types'
import { EmptyState } from '../../shared/ui/EmptyState'
import { PriorityBadge, StatusBadge } from '../../shared/ui/StatusBadge'

/** `newest`: urgent first, then the most recent case on top. `urgent`: least time left on top. */
export type WorklistOrder = 'newest' | 'urgent'

const PRIORITY_RANK: Record<Priority, number> = { STAT: 0, Acil: 1, Yüksek: 2, Normal: 3 }

export function isUrgentCase(c: VetCase) {
  return c.priority === 'STAT' || c.priority === 'Acil'
}

function studyLine(c: VetCase, t: TranslateFn) {
  if (c.anatomicalRegion) return studyLabel(t, null, c.anatomicalRegion)
  return c.clinical.complaint || t('common.dash')
}

function waitLabel(c: VetCase, t: TranslateFn) {
  if (c.reviewDueAt) return formatSlaRemaining(c.reviewDueAt, Date.now(), slaLabelsFromT(t))
  return t('dashboard.queueSlaShort', { hours: String(slaHoursForPriority(c.priority)) })
}

/** When the case arrived: the due time minus its SLA window, else the creation date. */
function arrivedAt(c: VetCase): number {
  if (c.reviewDueAt) {
    const due = Date.parse(c.reviewDueAt)
    if (!Number.isNaN(due)) return due - slaHoursForPriority(c.priority) * 3_600_000
  }
  const created = Date.parse(c.createdAt)
  return Number.isNaN(created) ? 0 : created
}

export function sortWorklist(items: VetCase[], order: WorklistOrder = 'newest') {
  return [...items].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 9
    const pb = PRIORITY_RANK[b.priority] ?? 9
    if (pa !== pb) return pa - pb
    if (order === 'urgent') return compareBySlaUrgency(a.reviewDueAt, b.reviewDueAt)
    return arrivedAt(b) - arrivedAt(a)
  })
}

function waitClass(c: VetCase) {
  const tone = slaTone(c.reviewDueAt)
  if (tone === 'overdue' || tone === 'critical') return 'text-rose-700'
  if (tone === 'warn' || isSlaAttention(c.reviewDueAt)) return 'text-amber-700'
  return 'text-slate-600'
}

export function ExpertWorklistTable({
  items,
  loading = false,
  emptyTitle,
  emptyText,
  emptyAction,
  showClaim = false,
  onClaim,
  secondaryActions,
  compact = false,
  order = 'newest',
}: {
  items: VetCase[]
  loading?: boolean
  emptyTitle?: string
  emptyText?: string
  emptyAction?: ReactNode
  showClaim?: boolean
  onClaim?: (c: VetCase) => void
  secondaryActions?: (c: VetCase) => ReactNode
  compact?: boolean
  order?: WorklistOrder
}) {
  const { t } = useLocale()
  const nav = useLocalizedNavigate()
  const sorted = useMemo(() => sortWorklist(items, order), [items, order])
  const cell = compact ? 'px-4 py-3' : 'px-5 py-3.5'
  const head = compact ? 'px-4 py-2.5' : 'px-5 py-3'

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-5 py-10 text-sm text-slate-500" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('review.loadingWorklist')}
      </p>
    )
  }

  if (!sorted.length) {
    return (
      <EmptyState
        compact
        icon={<Clock className="h-5 w-5" />}
        title={emptyTitle ?? t('dashboard.queueEmptyTitle')}
        text={emptyText ?? t('dashboard.queueEmptyText')}
        action={emptyAction}
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
            <th scope="col" className={`${head} font-medium`}>
              {t('dashboard.expertColPatient')}
            </th>
            <th scope="col" className={`${head} font-medium`}>
              {t('dashboard.expertColStudy')}
            </th>
            <th scope="col" className={`${head} font-medium`}>
              {t('dashboard.expertColPriority')}
            </th>
            <th scope="col" className={`${head} font-medium`}>
              {t('dashboard.expertColWait')}
            </th>
            <th scope="col" className={`${head} font-medium`}>
              {t('dashboard.expertColStatus')}
            </th>
            <th scope="col" className={`${head} text-right font-medium`}>
              <span className="sr-only">{t('dashboard.expertColAction')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((c) => {
            const urgent = isUrgentCase(c)
            const openCase = () => nav(`/vakalar/${c.id}/calisma`)
            const meta = [c.patient.species, c.patient.breed, c.no].filter((v) => v && v.trim() !== '—' && v.trim() !== '-').join(' · ')
            return (
              <tr
                key={c.id}
                tabIndex={0}
                aria-label={`${c.patient.name} — ${t('dashboard.expertOpen')}`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button, a, input, [data-stop-row-nav]')) return
                  openCase()
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  if ((e.target as HTMLElement).closest('button, a, input, [data-stop-row-nav]')) return
                  e.preventDefault()
                  openCase()
                }}
                className={`group cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600 ${
                  urgent ? 'bg-rose-50/70 hover:bg-rose-50' : 'bg-white hover:bg-slate-50'
                }`}
              >
                <td className={`${cell} align-middle`}>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className={`h-9 w-1 shrink-0 rounded-full ${urgent ? 'bg-rose-500' : 'bg-transparent'}`}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{c.patient.name}</p>
                      <p className="truncate text-xs text-slate-500">{meta}</p>
                    </div>
                  </div>
                </td>
                <td className={`${cell} align-middle`}>
                  <p className="text-slate-800">{studyLine(c, t)}</p>
                  <p className="text-xs text-slate-500">{c.modality || t('common.dash')}</p>
                </td>
                <td className={`${cell} align-middle`}>
                  <PriorityBadge priority={c.priority} />
                </td>
                <td className={`${cell} align-middle`}>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${waitClass(c)}`}>
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {waitLabel(c, t)}
                  </span>
                </td>
                <td className={`${cell} align-middle`}>
                  <StatusBadge status={c.status} />
                </td>
                <td className={`${cell} align-middle`} data-stop-row-nav onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-3">
                    {showClaim && onClaim && !c.assignedReviewerId ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-slate-900"
                        onClick={() => onClaim(c)}
                      >
                        <UserPlus className="h-3.5 w-3.5" aria-hidden /> {t('review.claimCase')}
                      </button>
                    ) : null}
                    {secondaryActions?.(c)}
                    <button
                      type="button"
                      onClick={openCase}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:border-teal-600 hover:text-teal-700"
                    >
                      {t('dashboard.expertOpen')}
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
