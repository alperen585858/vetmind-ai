import { useMemo, type ReactNode } from 'react'
import { Cat, ChevronRight, Clock, Dog, Loader2, PawPrint } from 'lucide-react'
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
  if (tone === 'overdue' || tone === 'critical') return 'bg-rose-100 text-rose-800 ring-rose-200'
  if (tone === 'warn' || isSlaAttention(c.reviewDueAt)) return 'bg-amber-100 text-amber-800 ring-amber-200'
  return 'bg-emerald-50 text-emerald-800 ring-emerald-200'
}

const SPECIES_AVATAR: Record<string, { icon: typeof Dog; cls: string }> = {
  Köpek: { icon: Dog, cls: 'bg-teal-100 text-teal-700' },
  Kedi: { icon: Cat, cls: 'bg-amber-100 text-amber-700' },
  Diğer: { icon: PawPrint, cls: 'bg-sky-100 text-sky-700' },
}

export function ExpertWorklistTable({
  items,
  loading = false,
  emptyTitle,
  emptyText,
  emptyAction,
  secondaryActions,
  compact = false,
  order = 'newest',
}: {
  items: VetCase[]
  loading?: boolean
  emptyTitle?: string
  emptyText?: string
  emptyAction?: ReactNode
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
          <tr className="bg-[color:var(--vm-sidebar,#102a43)] text-xs font-medium text-slate-200">
            <th scope="col" className={`${head} font-medium`}>
              {t('dashboard.expertColPatient')}
            </th>
            <th scope="col" className={`${head} font-medium`}>
              {t('dashboard.expertColStudy')}
            </th>
            <th scope="col" className={`${head} font-medium`}>
              {t('dashboard.expertColWait')}
            </th>
            <th scope="col" className={`${head} text-right font-medium`}>
              <span className="sr-only">{t('dashboard.expertColAction')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/70">
          {sorted.map((c, idx) => {
            const urgent = isUrgentCase(c)
            const openCase = () => nav(`/vakalar/${c.id}/calisma`)
            const breed = c.patient.breed && !['—', '-'].includes(c.patient.breed.trim()) ? c.patient.breed : ''
            const avatar = SPECIES_AVATAR[c.patient.species] ?? SPECIES_AVATAR.Diğer
            const AvatarIcon = avatar.icon
            const rowBg = urgent
              ? 'bg-rose-50 hover:bg-rose-100/70'
              : idx % 2
                ? 'bg-slate-50/70 hover:bg-teal-50/70'
                : 'bg-white hover:bg-teal-50/70'
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
                className={`cursor-pointer border-l-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600 ${
                  urgent ? 'border-l-rose-500' : 'border-l-transparent hover:border-l-teal-500'
                } ${rowBg}`}
              >
                <td className={`${cell} align-middle`}>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${avatar.cls}`}
                    >
                      <AvatarIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[15px] font-semibold text-slate-900">{c.patient.name}</span>
                        {c.priority !== 'Normal' ? <PriorityBadge priority={c.priority} /> : null}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {[c.patient.species, breed].filter(Boolean).join(' · ')}
                        <span className="ml-2 font-mono text-[11px] text-slate-400">{c.no}</span>
                      </p>
                    </div>
                  </div>
                </td>
                <td className={`${cell} align-middle`}>
                  <span className="inline-flex items-center gap-2">
                    <span className="rounded-md bg-[color:var(--vm-sidebar,#102a43)] px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">
                      {c.modality || t('common.dash')}
                    </span>
                    <span className="font-medium text-slate-800">{studyLine(c, t)}</span>
                  </span>
                  {c.status !== 'uzman_incelemesinde' ? (
                    <span className="mt-1 block">
                      <StatusBadge status={c.status} />
                    </span>
                  ) : null}
                </td>
                <td className={`${cell} align-middle`}>
                  <span
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${waitClass(c)}`}
                  >
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {waitLabel(c, t)}
                  </span>
                </td>
                <td className={`${cell} align-middle`} data-stop-row-nav onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-2">
                    {secondaryActions?.(c)}
                    <button
                      type="button"
                      onClick={openCase}
                      className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-700"
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
