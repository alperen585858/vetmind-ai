import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  FilePlus2,
  FileText,
  FolderOpen,
  Inbox,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { Button } from '../../shared/ui/Button'
import { CaseTable } from '../../shared/ui/CaseTable'
import { EmptyState } from '../../shared/ui/EmptyState'
import { STATUS_META, STATUS_ORDER } from '../../shared/ui/StatusBadge'
import type { CaseStatus, VetCase } from '../../shared/types'
import { AWAITING_REPORT_FILTER, isAwaitingReport } from './lib/caseStatusMap'
import { reviewerDisplay } from '../../shared/lib/reviewer'

type ModalityFilter = '' | 'MR' | 'CT' | 'XR'
const MODALITIES: ModalityFilter[] = ['', 'MR', 'CT', 'XR']

/** Same flat colours as the radiologist worklist cards (ReviewQueue). */
const CARD_COLORS = {
  teal: { active: 'border-teal-700 bg-teal-600 shadow-md', idle: 'border-teal-200 bg-teal-50 hover:border-teal-400', icon: 'bg-teal-600 text-white', label: 'text-teal-800', value: 'text-teal-900' },
  amber: { active: 'border-amber-600 bg-amber-500 shadow-md', idle: 'border-amber-200 bg-amber-50 hover:border-amber-400', icon: 'bg-amber-500 text-white', label: 'text-amber-800', value: 'text-amber-900' },
  emerald: { active: 'border-emerald-700 bg-emerald-600 shadow-md', idle: 'border-emerald-200 bg-emerald-50 hover:border-emerald-400', icon: 'bg-emerald-600 text-white', label: 'text-emerald-800', value: 'text-emerald-900' },
  rose: { active: 'border-rose-700 bg-rose-600 shadow-md', idle: 'border-rose-200 bg-rose-50 hover:border-rose-400', icon: 'bg-rose-600 text-white', label: 'text-rose-800', value: 'text-rose-900' },
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
    'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20'

  const cards: { id: StatusFilter; label: string; n: number; icon: ReactNode; tone: keyof typeof CARD_COLORS }[] = [
    { id: '', label: t('common.all'), n: counts.total - (counts.byStatus.iptal ?? 0), icon: <Inbox className="h-5 w-5" aria-hidden />, tone: 'teal' },
    { id: AWAITING_REPORT_FILTER, label: t('cases.viewInProgress'), n: counts.inProgress, icon: <Clock className="h-5 w-5" aria-hidden />, tone: 'amber' },
    { id: 'onaylandi', label: t('cases.viewApprovedReports'), n: counts.approved, icon: <FileText className="h-5 w-5" aria-hidden />, tone: 'emerald' },
    { id: 'failed', label: t(STATUS_META.analiz_basarisiz.labelKey), n: counts.failed, icon: <AlertTriangle className="h-5 w-5" aria-hidden />, tone: 'rose' },
  ]

  return (
    <>
      <div className="vm-fade-up space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white shadow-sm">
              <FolderOpen className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-[color:var(--vm-sidebar,#102a43)] sm:text-3xl">
                {t('nav.cases')}
              </h1>
              <p className="mt-0.5 text-sm text-slate-600">{t('cases.subtitle')}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void onSync()}
              disabled={backendSyncing}
              icon={<RefreshCw className={`h-4 w-4 ${backendSyncing ? 'animate-spin' : ''}`} aria-hidden />}
            >
              {t('common.refresh')}
            </Button>
            {role === 'vet' && (
              <Button size="sm" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => nav('/vakalar/yeni')}>
                {t('nav.newCase')}
              </Button>
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
            const c = CARD_COLORS[card.tone]
            return (
              <button
                key={card.id || 'all'}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStatus(active && card.id ? '' : card.id)}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
                  active ? c.active : c.idle
                }`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-white/20 text-white' : c.icon}`}>
                  {card.icon}
                </span>
                <span className="min-w-0">
                  <span className={`block text-xs font-semibold ${active ? 'text-white/85' : c.label}`}>{card.label}</span>
                  <span className={`block font-display text-2xl font-bold tabular-nums leading-tight ${active ? 'text-white' : c.value}`}>
                    {card.n}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-teal-100 bg-teal-50/60 px-4 py-3 xl:flex-row xl:items-center">
            <label className="relative block min-w-0 flex-1">
              <span className="sr-only">{t('cases.searchCasesAria')}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
                placeholder={t('cases.listSearchPlaceholder')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <div role="radiogroup" aria-label={t('review.filterModalityLabel')} className="inline-flex rounded-lg border border-teal-200 bg-white p-0.5">
                {MODALITIES.map((m) => {
                  const active = modality === m
                  return (
                    <button
                      key={m || 'all'}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setModality(m)}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                        active ? 'bg-teal-600 text-white shadow-sm' : 'text-slate-600 hover:bg-teal-50 hover:text-teal-800'
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

          <div className="flex items-center justify-between gap-2 px-5 py-3 text-xs text-slate-500">
            <span>{t('cases.subtitle')}</span>
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
