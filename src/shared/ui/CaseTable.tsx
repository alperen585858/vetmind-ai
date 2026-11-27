import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import { ChevronRight } from 'lucide-react'
import type { VetCase } from '../types'
import { PriorityBadge, StatusBadge } from './StatusBadge'
import { fmtDate } from '../lib/format'
import { useLocale } from '../shell/LocaleContext'
import type { TranslateFn } from '../../i18n'
import { studyLabel } from '../lib/displayClean'
import { reviewerDisplay } from '../lib/reviewer'
import { SpeciesIcon3D } from './SpeciesIcon3D'

const SPECIES_EMOJI: Record<string, string> = { Kedi: '🐱', Köpek: '🐶' }

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

function regionLabel(c: VetCase, t: TranslateFn): string {
  if (c.anatomicalRegion) return studyLabel(t, null, c.anatomicalRegion)
  return c.clinical.complaint || t('common.dash')
}

/** Case list table, same look as the radiologist worklist (ExpertWorklistTable). */
export function CaseTable({
  cases,
  showPriority = false,
}: {
  cases: VetCase[]
  showPriority?: boolean
}) {
  const nav = useLocalizedNavigate()
  const { t, locale } = useLocale()
  const head = 'px-5 py-3 font-medium'
  const cell = 'px-5 py-3.5 align-middle'
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="bg-[color:var(--vm-sidebar,#102a43)] text-xs text-slate-200">
            <th scope="col" className={head}>{t('cases.patient')}</th>
            <th scope="col" className={head}>{t('dashboard.expertColStudy')}</th>
            <th scope="col" className={head}>{t('cases.expert')}</th>
            <th scope="col" className={head}>{t('common.status')}</th>
            <th scope="col" className={head}>{t('common.date')}</th>
            <th scope="col" className={`${head} text-right`}>
              <span className="sr-only">{t('common.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/70">
          {cases.map((c, idx) => {
            const open = () => nav(caseOpenPath(c))
            const urgent = showPriority && (c.priority === 'STAT' || c.priority === 'Acil')
            const breed = c.patient.breed && !['—', '-'].includes(c.patient.breed.trim()) ? c.patient.breed : ''
            const rowBg = urgent
              ? 'bg-rose-50 hover:bg-rose-100/70'
              : idx % 2
                ? 'bg-slate-50/70 hover:bg-teal-50/70'
                : 'bg-white hover:bg-teal-50/70'
            return (
              <tr
                key={c.id}
                tabIndex={0}
                aria-label={`${c.patient.name} — ${c.no}`}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  if ((e.target as HTMLElement).closest('button, a, input')) return
                  e.preventDefault()
                  open()
                }}
                className={`cursor-pointer border-l-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600 ${
                  urgent ? 'border-l-rose-500' : 'border-l-transparent hover:border-l-teal-500'
                } ${rowBg}`}
              >
                <td className={cell}>
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-sky-50 to-slate-100 ring-1 ring-slate-200/80"
                    >
                      <SpeciesIcon3D species={c.patient.species} size={42} />
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
                  <span className="inline-flex items-center gap-2">
                    <span className="rounded-md bg-[color:var(--vm-sidebar,#102a43)] px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">
                      {c.modality || t('common.dash')}
                    </span>
                    <span className="font-medium text-slate-800">{regionLabel(c, t)}</span>
                  </span>
                </td>
                <td className={`${cell} text-slate-700`}>{reviewerDisplay(c, t)}</td>
                <td className={cell}>
                  <StatusBadge status={c.status} />
                </td>
                <td className={`${cell} whitespace-nowrap text-slate-600`}>{fmtDate(c.createdAt, locale)}</td>
                <td className={cell} onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={open}
                      className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-700"
                    >
                      {t('cases.open')}
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
