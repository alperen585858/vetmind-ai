import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, Clock, Loader2, UserPlus } from 'lucide-react'
import { useLocale } from '../context/LocaleContext'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import { studyLabel } from '../lib/displayClean'
import {
  compareBySlaUrgency,
  formatSlaRemaining,
  isSlaAttention,
  slaBadgeClass,
  slaHoursForPriority,
  slaTone,
} from '../lib/reviewSla'
import type { TranslateFn } from '../i18n'
import type { VetCase } from '../types'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { PriorityBadge, StatusBadge } from './StatusBadge'

function studyLine(c: VetCase, t: TranslateFn) {
  if (c.anatomicalRegion) return studyLabel(t, null, c.anatomicalRegion)
  return c.clinical.complaint || t('common.dash')
}

function waitLabel(c: VetCase, t: TranslateFn) {
  if (c.reviewDueAt) return formatSlaRemaining(c.reviewDueAt)
  return t('dashboard.queueSlaShort', { hours: String(slaHoursForPriority(c.priority)) })
}

function sortWorklist(items: VetCase[]) {
  const order = { STAT: 0, Acil: 1, Yüksek: 2, Normal: 3 }
  return [...items].sort((a, b) => {
    const pa = order[a.priority] ?? 9
    const pb = order[b.priority] ?? 9
    if (pa !== pb) return pa - pb
    return compareBySlaUrgency(a.reviewDueAt, b.reviewDueAt)
  })
}

function accentClass(tone: ReturnType<typeof slaTone>) {
  switch (tone) {
    case 'overdue':
    case 'critical':
      return 'border-l-[var(--vm-danger)]'
    case 'warn':
      return 'border-l-[var(--vm-warning,#d99a32)]'
    default:
      return 'border-l-transparent'
  }
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
}) {
  const { t } = useLocale()
  const nav = useLocalizedNavigate()
  const [expanded, setExpanded] = useState<string | null>(null)
  const sorted = useMemo(() => sortWorklist(items), [items])
  const cell = compact ? 'px-3 py-2' : 'px-4 py-2.5'

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500" role="status">
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
          <tr className="border-b border-slate-200/80 bg-slate-50/50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            <th scope="col" className={`${cell} font-semibold`}>
              {t('dashboard.expertColPatient')}
            </th>
            <th scope="col" className={`${cell} font-semibold`}>
              {t('dashboard.expertColStudy')}
            </th>
            <th scope="col" className={`${cell} font-semibold`}>
              {t('dashboard.expertColModality')}
            </th>
            <th scope="col" className={`${cell} font-semibold`}>
              {t('dashboard.expertColPriority')}
            </th>
            <th scope="col" className={`${cell} font-semibold`}>
              {t('dashboard.expertColWait')}
            </th>
            <th scope="col" className={`${cell} font-semibold`}>
              {t('dashboard.expertColStatus')}
            </th>
            <th scope="col" className={`${cell} text-right font-semibold`}>
              {t('dashboard.expertColAction')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((c) => {
            const tone = slaTone(c.reviewDueAt)
            const attention = isSlaAttention(c.reviewDueAt)
            const displayTone = attention && (tone === 'ok' || tone === 'none') ? 'warn' : tone
            const open = expanded === c.id
            const workspaceHref = `/vakalar/${c.id}/calisma`
            const openCase = () => nav(workspaceHref)
            return (
              <tr
                key={c.id}
                role="link"
                tabIndex={0}
                aria-label={`${c.patient.name} — ${t('dashboard.expertOpen')}`}
                onClick={(e) => {
                  const target = e.target as HTMLElement
                  if (target.closest('button, a, input, [data-stop-row-nav]')) return
                  openCase()
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  const target = e.target as HTMLElement
                  if (target.closest('button, a, input, [data-stop-row-nav]')) return
                  e.preventDefault()
                  openCase()
                }}
                className={`cursor-pointer border-l-4 bg-white transition duration-150 hover:bg-teal-50/40 focus-visible:bg-teal-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600 ${accentClass(displayTone)}`}
              >
                <td className={`${cell} align-middle`}>
                  <button
                    type="button"
                    className="text-left font-semibold text-[color:var(--vm-text,#172b4d)] transition hover:text-teal-700 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      openCase()
                    }}
                  >
                    {c.patient.name}
                  </button>
                  <p className="text-[11px] text-slate-500">{c.patient.species}</p>
                  <button
                    type="button"
                    data-stop-row-nav
                    className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-400 transition hover:text-teal-700"
                    aria-expanded={open}
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpanded(open ? null : c.id)
                    }}
                  >
                    {t('common.details')}
                    <ChevronDown className={`h-3 w-3 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
                  </button>
                  {open ? (
                    <div data-stop-row-nav className="mt-1.5 space-y-0.5 text-[11px] text-slate-500" onClick={(e) => e.stopPropagation()}>
                      <p className="font-mono">{c.no}</p>
                      <p>
                        {c.patient.breed}
                        {c.patient.age != null ? ` · ${t('dashboard.ownerAgeYears', { age: c.patient.age })}` : ''}
                      </p>
                      {(c.clinic || c.vetName) && <p>{[c.clinic, c.vetName].filter(Boolean).join(' · ')}</p>}
                      <p title={t('review.slaHoursTitle', { hours: String(slaHoursForPriority(c.priority)) })}>
                        SLA {slaHoursForPriority(c.priority)}s · {waitLabel(c, t)}
                      </p>
                    </div>
                  ) : null}
                </td>
                <td className={`${cell} align-middle text-slate-700`}>{studyLine(c, t)}</td>
                <td className={`${cell} align-middle`}>
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                    {c.modality || t('common.dash')}
                  </span>
                </td>
                <td className={`${cell} align-middle`}>
                  <PriorityBadge priority={c.priority} />
                </td>
                <td className={`${cell} align-middle`}>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${slaBadgeClass(displayTone)}`}
                  >
                    <Clock className="h-3 w-3" aria-hidden />
                    {waitLabel(c, t)}
                  </span>
                </td>
                <td className={`${cell} align-middle`}>
                  <StatusBadge status={c.status} />
                </td>
                <td className={`${cell} align-middle`} data-stop-row-nav onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <Button size="sm" onClick={openCase}>
                      {t('dashboard.expertOpen')}
                    </Button>
                    {showClaim && onClaim ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-navy-900"
                        onClick={() => onClaim(c)}
                      >
                        <UserPlus className="h-3.5 w-3.5" /> {t('review.claimCase')}
                      </button>
                    ) : null}
                    {secondaryActions?.(c)}
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
