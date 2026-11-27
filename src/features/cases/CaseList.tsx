import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import {
  AlertCircle,
  AlertTriangle,
  FilePlus2,
  FolderOpen,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { Button } from '../../shared/ui/Button'
import { CaseTable } from '../../shared/ui/CaseTable'
import { CardWave } from '../../shared/ui/CardWave'
import { EmptyState } from '../../shared/ui/EmptyState'
import { STATUS_META, STATUS_ORDER } from '../../shared/ui/StatusBadge'
import type { CaseStatus, VetCase } from '../../shared/types'
import { AWAITING_REPORT_FILTER, isAwaitingReport } from './lib/caseStatusMap'
import { reviewerDisplay } from '../../shared/lib/reviewer'

type ModalityFilter = '' | 'MR' | 'CT' | 'XR'
const MODALITIES: ModalityFilter[] = ['', 'MR', 'CT', 'XR']

/** Light pastel cards with a soft wave, same as the radiologist worklist (ReviewQueue). */
const CARD_STYLE = {
  teal: {
    card: 'from-teal-50/90 via-white to-white ring-teal-100',
    active: 'ring-2 ring-teal-400 shadow-[0_14px_34px_-14px_rgba(13,148,136,0.55)]',
    wave: '#5eead4',
  },
  amber: {
    card: 'from-amber-50 via-amber-50/40 to-white ring-amber-100',
    active: 'ring-2 ring-amber-400 shadow-[0_14px_34px_-14px_rgba(217,119,6,0.5)]',
    wave: '#fcd34d',
  },
  emerald: {
    card: 'from-emerald-50 via-white to-white ring-emerald-100',
    active: 'ring-2 ring-emerald-400 shadow-[0_14px_34px_-14px_rgba(5,150,105,0.5)]',
    wave: '#6ee7b7',
  },
  rose: {
    card: 'from-rose-50 via-white to-white ring-rose-100',
    active: 'ring-2 ring-rose-400 shadow-[0_14px_34px_-14px_rgba(225,29,72,0.5)]',
    wave: '#fda4af',
  },
} as const

type StatusFilter = CaseStatus | '' | 'failed' | typeof AWAITING_REPORT_FILTER

function TableSkeleton({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div className="animate-pulse space-y-3 p-4" aria-busy="true" aria-label={loadingLabel}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="h-10 w-10 rounded bg-slate-100" />
          <div className="h-10 w-24 rounded bg-slate-100" />
          <div className="h-10 flex-1 rounded bg-slate-100" />
          <div className="h-10 w-28 rounded bg-slate-100" />
          <div className="h-10 w-20 rounded bg-slate-100" />
          <div className="h-10 w-24 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

/** Urgent (STAT / Acil) and not finished: what the dashboard's Acil / STAT card counts. */
export function isOpenUrgent(c: VetCase): boolean {
  return (c.priority === 'STAT' || c.priority === 'Acil') && !['onaylandi', 'reddedildi', 'iptal'].includes(c.status)
}

function expertKey(c: VetCase): string {
  return c.assignedReviewerId?.trim() || ''
}

export default function CaseList() {
  const { cases, role, refreshBackendCases, backendSyncing, pushToast } = useApp()
  const { t, intlLocale } = useLocale()
  const nav = useLocalizedNavigate()
  const [q, setQ] = useState('')
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<StatusFilter>(() => {
    const d = searchParams.get('durum')
    if (d === AWAITING_REPORT_FILTER || d === 'onaylandi' || d === 'iptal') return d
    return ''
  })
  const [species, setSpecies] = useState('')
  const [modality, setModality] = useState<ModalityFilter>('')
  const [expert, setExpert] = useState('')
  // Dashboard "Acil / STAT" card links here with ?acil=1 (same rule as its count).
  const [urgentOnly, setUrgentOnly] = useState(() => searchParams.get('acil') === '1')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [initialLoad, setInitialLoad] = useState(true)

  useEffect(() => {
    let cancelled = false
    void refreshBackendCases().then((r) => {
      if (cancelled) return
      if (!r.ok && r.error) setSyncError(r.error)
      else setSyncError(null)
      setInitialLoad(false)
    })
    return () => {
      cancelled = true
    }
  }, [refreshBackendCases])

  const experts = useMemo(() => {
    const byId = new Map<string, string>()
    for (const c of cases) {
      const k = expertKey(c)
      if (k && !byId.has(k)) byId.set(k, reviewerDisplay(c, t))
    }
    return Array.from(byId, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, intlLocale))
  }, [cases, intlLocale, t])

  const counts = useMemo(() => {
    const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<CaseStatus, number>
    for (const c of cases) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1
    const total = cases.length
    const review = byStatus.uzman_incelemesinde ?? 0
    const approved = byStatus.onaylandi ?? 0
    const failed = (byStatus.analiz_basarisiz ?? 0) + (byStatus.reddedildi ?? 0)
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
    const inProgress = cases.filter((c) => isAwaitingReport(c.status) && c.status !== 'iptal').length
    return { byStatus, total, review, approved, failed, pct, inProgress }
  }, [cases])

  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase(intlLocale)
    return cases.filter(
      (c) =>
        // Cancelled drafts are kept but only shown when the "İptal edilenler" filter is on.
        (status === 'iptal' || c.status !== 'iptal') &&
        (!status ||
          (status === 'failed'
            ? c.status === 'analiz_basarisiz' || c.status === 'reddedildi'
            : status === AWAITING_REPORT_FILTER
              ? isAwaitingReport(c.status)
              : c.status === status)) &&
        (!species || c.patient.species === species) &&
        (!modality || c.modality === modality) &&
        (!expert || expertKey(c) === expert) &&
        (!urgentOnly || isOpenUrgent(c)) &&
        (!s ||
          [c.no, c.patient.name, c.patient.breed, c.modality, c.anatomicalRegion, c.assignedReviewerId ? reviewerDisplay(c, t) : '']
            .filter(Boolean)
            .some((f) => String(f).toLocaleLowerCase(intlLocale).includes(s))),
    )
  }, [cases, q, status, species, modality, expert, urgentOnly, intlLocale, t])

  const onSync = async () => {
    const r = await refreshBackendCases()
    if (r.ok) {
      setSyncError(null)
      pushToast({
        tone: 'success',
        title: t('cases.syncOk'),
        body: t('cases.syncOkBody', { count: String(r.count) }),
      })
    } else {
      const err = r.error ?? t('cases.syncFailBody')
      setSyncError(err)
      pushToast({ tone: 'error', title: t('cases.syncFail'), body: err })
    }
  }

  const clearFilters = () => {
    setQ('')
    setStatus('')
    setSpecies('')
    setModality('')
    setExpert('')
    setUrgentOnly(false)
  }

  const showSkeleton = initialLoad && backendSyncing && cases.length === 0
  const hasFilters = Boolean(q.trim() || status || species || modality || expert || urgentOnly)
  const selectClass =
    'rounded-xl bg-white px-3 py-2.5 text-sm text-slate-800 shadow-sm outline-none ring-1 ring-slate-200 transition focus:ring-2 focus:ring-teal-500/50'

  const cards: { id: StatusFilter; label: string; n: number; hint: string; tone: keyof typeof CARD_STYLE }[] = [
    { id: '', label: t('common.all'), n: counts.total - (counts.byStatus.iptal ?? 0), hint: t('cases.cardAllHint'), tone: 'teal' },
    { id: AWAITING_REPORT_FILTER, label: t('cases.viewInProgress'), n: counts.inProgress, hint: t('cases.cardInProgressHint'), tone: 'amber' },
    { id: 'onaylandi', label: t('cases.viewApprovedReports'), n: counts.approved, hint: t('cases.cardApprovedHint'), tone: 'emerald' },
    {
      id: 'failed',
      label: t(STATUS_META.analiz_basarisiz.labelKey),
      n: counts.failed,
      hint: counts.failed ? t('cases.cardFailedHint') : t('cases.cardFailedNone'),
      tone: 'rose',
    },
  ]

  return (
    <>
      <div className="vm-fade-up space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-[#102a43] sm:text-4xl">{t('nav.cases')}</h1>
            <p className="mt-1.5 text-sm text-slate-500">{t('cases.subtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onSync()}
              disabled={backendSyncing}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${backendSyncing ? 'animate-spin' : ''}`} aria-hidden />
              {t('common.refresh')}
            </button>
            {role === 'vet' && (
              <button
                type="button"
                onClick={() => nav('/vakalar/yeni')}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_6px_16px_-6px_rgba(13,148,136,0.7)] transition hover:bg-teal-700"
              >
                <FilePlus2 className="h-4 w-4" aria-hidden />
                {t('nav.newCase')}
              </button>
            )}
          </div>
        </header>

        {syncError && (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <strong>{t('cases.syncFail')}.</strong> {syncError}
              </span>
            </p>
            <Button size="sm" variant="secondary" onClick={() => void onSync()} disabled={backendSyncing}>
              {t('common.retry')}
            </Button>
          </div>
        )}

        {/* #81: approved reports are a view of the case list, not a separate page. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="tablist" aria-label={t('cases.viewTabs')}>
          {cards.map((card) => {
            const active = status === card.id
            const st = CARD_STYLE[card.tone]
            return (
              <button
                key={card.id || 'all'}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatus(active && card.id ? '' : card.id)}
                className={`relative flex min-h-[128px] items-start overflow-hidden rounded-3xl bg-gradient-to-br px-4 pb-5 pt-4 text-left shadow-[0_4px_18px_-8px_rgba(15,23,42,0.15)] ring-1 transition duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${st.card} ${
                  active ? st.active : ''
                }`}
              >
                <CardWave color={st.wave} />
                <span className="relative min-w-0">
                  <span className="block text-sm font-semibold leading-snug text-slate-700">{card.label}</span>
                  <span className="mt-1 block font-display text-4xl font-bold leading-none tabular-nums text-[#102a43]">{card.n}</span>
                  <span className="mt-2.5 block text-xs font-medium leading-snug text-slate-500">{card.hint}</span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <label className="relative block min-w-0 flex-1">
              <span className="sr-only">{t('cases.searchCasesAria')}</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                className="w-full rounded-xl bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:ring-2 focus:ring-teal-500/50"
                placeholder={t('cases.listSearchPlaceholder')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <div role="radiogroup" aria-label={t('review.filterModalityLabel')} className="inline-flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
                {MODALITIES.map((m) => {
                  const active = modality === m
                  return (
                    <button
                      key={m || 'all'}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setModality(m)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        active
                          ? 'bg-teal-600 text-white shadow-[0_4px_12px_-4px_rgba(13,148,136,0.7)]'
                          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      {m ? t(`review.modality${m}`) : t('review.allModalities')}
                    </button>
                  )
                })}
              </div>
              {urgentOnly ? (
                <button
                  type="button"
                  onClick={() => setUrgentOnly(false)}
                  aria-label={`${t('dashboard.metricUrgentStat')} — ${t('common.clear')}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700"
                >
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  {t('dashboard.metricUrgentStat')}
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
              <select aria-label={t('common.status')} className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                <option value="">{t('cases.filterAllStatuses')}</option>
                <option value={AWAITING_REPORT_FILTER}>{t('cases.filterAwaitingReport')}</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {t(STATUS_META[s].labelKey)}
                  </option>
                ))}
              </select>
              <select aria-label={t('cases.species')} className={selectClass} value={species} onChange={(e) => setSpecies(e.target.value)}>
                <option value="">{t('cases.filterAllSpecies')}</option>
                <option value="Köpek">{t('species.dog')}</option>
                <option value="Kedi">{t('species.cat')}</option>
              </select>
              <select aria-label={t('cases.expert')} className={selectClass} value={expert} onChange={(e) => setExpert(e.target.value)}>
                <option value="">{t('cases.filterAllExperts')}</option>
                {experts.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  <X className="h-4 w-4" aria-hidden />
                  {t('common.clear')}
                </button>
              ) : null}
            </div>
          </div>


        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-end px-5 py-2.5 text-xs text-slate-500">
            <span className="tabular-nums">{t('cases.showingCount', { shown: filtered.length, total: cases.length })}</span>
          </div>

          {showSkeleton ? (
            <TableSkeleton loadingLabel={t('cases.loadingCasesAria')} />
          ) : filtered.length ? (
            <CaseTable
              cases={filtered}
              showPriority={role === 'expert'}
            />
          ) : cases.length === 0 ? (
            <EmptyState
              icon={<FolderOpen className="h-6 w-6" />}
              title={t('cases.empty')}
              text={t('cases.emptyHint')}
              action={
                role === 'vet' ? (
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <Button size="sm" onClick={() => nav('/vakalar/yeni')}>
                      {t('nav.newCase')}
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              icon={<FolderOpen className="h-6 w-6" />}
              title={t('cases.empty')}
              text={t('cases.emptyHint')}
              action={
                <Button size="sm" variant="secondary" className="mt-3" onClick={clearFilters}>
                  {t('common.clear')}
                </Button>
              }
            />
          )}
        </section>
      </div>

    </>
  )
}
