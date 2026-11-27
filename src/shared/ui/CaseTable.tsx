import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import { ChevronRight } from 'lucide-react'
import type { VetCase } from '../types'
import { PriorityBadge, StatusBadge } from './StatusBadge'
import { fmtDate } from '../lib/format'
import { useLocale } from '../shell/LocaleContext'
import type { TranslateFn } from '../../i18n'
import { studyLabel } from '../lib/displayClean'
import { reviewerDisplay } from '../lib/reviewer'

const SPECIES_EMOJI: Record<string, string> = { Kedi: '🐱', Köpek: '🐶' }

const MODALITY_CLS: Record<string, string> = {
  MR: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  CT: 'bg-violet-50 text-violet-700 ring-violet-200',
  XR: 'bg-sky-50 text-sky-700 ring-sky-200',
  OTHER: 'bg-slate-100 text-slate-700 ring-slate-200',
}

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

function modalityLabel(c: VetCase, dash: string, t: TranslateFn): string {
  if (!c.modality) return dash
  return studyLabel(t, c.modality, c.anatomicalRegion)
}

export function CaseTable({
  cases,
  showPriority = false,
}: {
  cases: VetCase[]
  showPriority?: boolean
  /** When set, shows a delete control (caller must confirm). */
}) {
  const nav = useLocalizedNavigate()
  const { t, locale } = useLocale()
  const dash = t('common.dash')
  return (
    <div>
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-gradient-to-b from-slate-50 to-slate-50/40">
          <tr>
            <th className="th">{t('cases.caseNo')}</th>
            <th className="th">{t('cases.patient')}</th>
            <th className="th">{t('cases.speciesBreed')}</th>
            <th className="th">{t('cases.modality')}</th>
            <th className="th">{t('cases.expert')}</th>
            {showPriority && <th className="th">{t('common.priority')}</th>}
            <th className="th">{t('common.status')}</th>
            <th className="th">{t('common.date')}</th>
            <th className="th text-right">{t('common.actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {cases.map((c) => (
            <tr
              key={c.id}
              tabIndex={0}
              aria-label={`${c.patient.name} — ${c.no}`}
              onClick={() => nav(caseOpenPath(c))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                const target = e.target as HTMLElement
                if (target.closest('button, a, input')) return
                e.preventDefault()
                nav(caseOpenPath(c))
              }}
              className="cursor-pointer transition hover:bg-teal-50/40 focus-visible:bg-teal-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600"
            >
              <td className="td font-mono text-[11px] font-semibold text-slate-500" title={c.id}>
                {c.no}
              </td>
              <td className="td">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-50 to-sky-50 text-lg ring-1 ring-slate-200/80">
                    <SpeciesIcon species={c.patient.species} />
                  </span>
                  <span className="font-semibold text-navy-900">{c.patient.name}</span>
                </div>
              </td>
              <td className="td">
                <div className="text-sm text-navy-800">{c.patient.species}</div>
                <div className="text-xs text-slate-500">{c.patient.breed}</div>
              </td>
              <td className="td">
                <span
                  className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                    MODALITY_CLS[c.modality ?? 'OTHER'] ?? MODALITY_CLS.OTHER
                  }`}
                >
                  {modalityLabel(c, dash, t)}
                </span>
              </td>
              <td className="td text-xs text-slate-700">{reviewerDisplay(c, t)}</td>
              {showPriority && (
                <td className="td">
                  <PriorityBadge priority={c.priority} />
                </td>
              )}
              <td className="td">
                <StatusBadge status={c.status} />
              </td>
              <td className="td text-xs text-slate-500">{fmtDate(c.createdAt, locale)}</td>
              <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                    onClick={() => nav(caseOpenPath(c))}
                  >
                    {t('cases.open')} <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  )
}
