import { useMemo } from 'react'
import { AlertTriangle, ChevronRight, UsersRound } from 'lucide-react'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { useLocalizedNavigate } from '../../../shared/hooks/useLocalizedNavigate'
import type { VetCase } from '../../../shared/types'
import { OVERDUE_FILTER } from '../../cases/lib/caseStatusMap'
import { radiologistRows } from '../lib/clinicTeam'

/** Clinic dashboard: one-line team summary; the details live on the "Ekibim" page. */
export function ClinicRadiologistsCard({ cases }: { cases: VetCase[] }) {
  const { t, intlLocale } = useLocale()
  const nav = useLocalizedNavigate()
  const { rows, unassigned, overdue } = useMemo(() => radiologistRows(cases, t, intlLocale), [cases, t, intlLocale])
  const open = rows.reduce((n, r) => n + r.open, 0) + unassigned.length

  return (
    <section className="vm-fade-up flex flex-col gap-3 rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-center">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-teal-100">
        <UsersRound className="h-5 w-5" aria-hidden />
      </span>
      <p className="flex-1 text-sm text-slate-700">
        <span className="font-semibold text-[#102a43]">{t('dashboard.clinicTeamLine', { radiologists: rows.length, open })}</span>
        {unassigned.length ? <span className="text-slate-500"> · {t('dashboard.clinicRadUnassigned', { count: unassigned.length })}</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {overdue > 0 ? (
          <button
            type="button"
            onClick={() => nav(`/vakalar?durum=${OVERDUE_FILTER}`)}
            className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200 transition hover:bg-rose-100"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t('dashboard.clinicRadOverdueAll', { count: overdue })}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => nav('/ekibim')}
          className="inline-flex items-center gap-1 rounded-xl bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgba(13,148,136,0.7)] transition hover:bg-teal-700"
        >
          {t('nav.clinicTeam')}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  )
}
