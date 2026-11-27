import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import { ChevronRight, Clock } from 'lucide-react'
import { formatSlaRemaining, slaBadgeClass, slaLabelsFromT, slaTone } from '../lib/reviewSla'
import type { VetCase } from '../types'
import { PriorityBadge, StatusBadge } from './StatusBadge'
import { fmtDate } from '../lib/format'
import { useLocale } from '../shell/LocaleContext'
import type { TranslateFn } from '../../i18n'
import { modalityLabel, studyLabel } from '../lib/displayClean'
import { HoloOrgan } from './HoloOrgan'
import { reviewerDisplay, reviewerInitials } from '../lib/reviewer'
import { SpeciesIcon3D } from './SpeciesIcon3D'

const SPECIES_EMOJI: Record<string, string> = { Kedi: '🐱', Köpek: '🐶' }

/** Statuses with no report still to come; their deadline no longer matters. */
const CLOSED = new Set<VetCase['status']>(['onaylandi', 'reddedildi', 'iptal'])

/** #81: approved cases open straight on the approved report (PDF download there). */
export function caseOpenPath(c: Pick<VetCase, 'id' | 'status'>): string {
  return c.status === 'onaylandi' ? `/raporlar/${c.id}` : `/vakalar/${c.id}`
}

export function SpeciesIcon({ species }: { species: string }) {
  return (
    <span className="text-base leading-none" role="img" aria-label={species}>
      {SPECIES_EMOJI[species] ?? '🐾'}
    </span>
  )
}

function studyText(c: VetCase, t: TranslateFn): string {
  if (c.anatomicalRegion) return studyLabel(t, null, c.anatomicalRegion)
  return c.clinical.complaint || t('common.dash')
}

/** Case list table, same light look as the radiologist worklist (ReviewQueue). */
export function CaseTable({
  cases,
  showPriority = false,
  showDue = false,
}: {
  cases: VetCase[]
  showPriority?: boolean
  /** Clinic manager: a column with the time left until the radiologist's deadline. */
  showDue?: boolean
}) {
  const nav = useLocalizedNavigate()
  const { t, locale } = useLocale()
  const head = 'px-4 py-3.5 font-medium'
  const cell = 'px-4 py-3 align-middle'
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs font-medium text-slate-500">
            <th scope="col" className={`${head} pl-5`}>{t('cases.patient')}</th>
            <th scope="col" className={head}>{t('dashboard.expertColStudy')}</th>
            <th scope="col" className={head}>{t('review.colRegion')}</th>
            <th scope="col" className={`${head} hidden lg:table-cell`}>{t('cases.expert')}</th>
            <th scope="col" className={head}>{t('common.status')}</th>
            {showDue ? <th scope="col" className={head}>{t('cases.colDue')}</th> : null}
            <th scope="col" className={`${head} hidden ${showDue ? '2xl:table-cell' : 'md:table-cell'}`}>{t('common.date')}</th>
            <th scope="col" className={head}>
              <span className="sr-only">{t('common.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const open = () => nav(caseOpenPath(c))
            const urgent = showPriority && (c.priority === 'STAT' || c.priority === 'Acil')
            const breed = c.patient.breed && !['—', '-'].includes(c.patient.breed.trim()) ? c.patient.breed : ''
            const reviewer = c.assignedReviewerId ? reviewerDisplay(c, t) : ''
            return (
              <tr
                key={c.id}
                tabIndex={0}
                aria-label={`${c.patient.name} — ${c.no}`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button, a, input')) return
                  open()
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  if ((e.target as HTMLElement).closest('button, a, input')) return
                  e.preventDefault()
                  open()
                }}
                className={`cursor-pointer border-t border-slate-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600 ${
                  urgent ? 'bg-rose-50/70 hover:bg-rose-50' : 'hover:bg-teal-50/60'
                }`}
              >
                <td className={`${cell} pl-5`}>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-sky-50 to-slate-100 ring-1 ring-slate-200"
                    >
                      <SpeciesIcon3D species={c.patient.species} size={36} />
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[15px] font-semibold text-slate-900">{c.patient.name}</span>
                        {showPriority && c.priority !== 'Normal' ? <PriorityBadge priority={c.priority} /> : null}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {[c.patient.species, breed].filter(Boolean).join(' · ')}
                        <span className="ml-2 font-mono text-[11px] text-slate-400" title={c.id}>
                          {c.no}
                        </span>
                      </p>
                    </div>
                  </div>
                </td>
                <td className={cell}>
                  <span className="rounded-md bg-sky-50 px-2 py-0.5 text-xs font-bold tracking-wide text-sky-800 ring-1 ring-sky-200">
                    {(c.modality || '').toUpperCase() === 'CT' ? modalityLabel(t, 'CT') : c.modality || t('common.dash')}
                  </span>
                </td>
                <td className={cell}>
                  <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-slate-800">
                    <HoloOrgan region={c.anatomicalRegion} size={32} />
                    {studyText(c, t)}
                  </span>
                </td>
                <td className={`${cell} hidden lg:table-cell`}>
                  {reviewer ? (
                    <span className="inline-flex items-center gap-2 whitespace-nowrap text-slate-700">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-[11px] font-bold text-teal-700 ring-1 ring-teal-100">
                        {reviewerInitials(reviewer)}
                      </span>
                      {reviewer}
                    </span>
                  ) : (
                    <span className="text-slate-400">{reviewerDisplay(c, t)}</span>
                  )}
                </td>
                <td className={cell}>
                  <StatusBadge status={c.status} />
                </td>
                {showDue ? (
                  <td className={cell}>
                    {c.reviewDueAt && !CLOSED.has(c.status) ? (
                      <span
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${slaBadgeClass(slaTone(c.reviewDueAt))}`}
                      >
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                        {formatSlaRemaining(c.reviewDueAt, Date.now(), slaLabelsFromT(t))}
                      </span>
                    ) : (
                      <span className="text-slate-400">{t('common.dash')}</span>
                    )}
                  </td>
                ) : null}
                <td className={`${cell} hidden whitespace-nowrap text-slate-500 ${showDue ? '2xl:table-cell' : 'md:table-cell'}`}>{fmtDate(c.createdAt, locale)}</td>
                <td className={`${cell} pr-5`}>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={open}
                      aria-label={t('cases.open')}
                      title={t('cases.open')}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-white shadow-[0_4px_12px_-4px_rgba(13,148,136,0.7)] transition hover:bg-teal-700"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden />
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

