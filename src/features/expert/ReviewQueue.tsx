import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Bone, Brain, ChevronRight, Clock, EyeOff, Info, Layers, Loader2, PawPrint, RefreshCw, ScanLine, Search, User, X } from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { Button } from '../../shared/ui/Button'
import { isUrgentCase, sortWorklist, waitLabel } from './ExpertWorklistTable'
import { HoloOrgan } from './HoloOrgan'
import { SpeciesIcon3D } from '../../shared/ui/SpeciesIcon3D'
import { PriorityBadge } from '../../shared/ui/StatusBadge'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import { modalityLabel, regionLabel } from '../../shared/lib/displayClean'
import { Modal } from '../../shared/ui/Modal'
import { currentActorId } from '../../shared/auth/session'
import { toastErrorBody } from '../../shared/lib/apiErrors'
import { hideBackendCase, listBackendWorklist } from '../../shared/api'
import { summaryToVetCase } from '../../shared/lib/caseMapper'
import { isSlaAttention, slaTone } from '../../shared/lib/reviewSla'
import type { BackendCaseSummary, VetCase } from '../../shared/types'

type QueueView = 'all' | 'urgent' | 'sla' | 'mine'
type ModalityFilter = '' | 'MR' | 'CT' | 'XR'

const MODALITIES: ModalityFilter[] = ['', 'MR', 'CT', 'XR']

/** Dark "glass" stat cards: a tinted gradient per queue tab, glowing when selected. */
const TAB_STYLE: Record<QueueView, { card: string; active: string; tile: string; line: string }> = {
  all: {
    card: 'from-teal-50 ring-teal-200',
    active: 'ring-2 ring-teal-400 shadow-[0_10px_30px_-10px_rgba(13,148,136,0.55)]',
    tile: 'from-teal-400 to-teal-700 shadow-[0_6px_16px_-4px_rgba(13,148,136,0.6)]',
    line: '#14b8a6',
  },
  urgent: {
    card: 'from-rose-50 ring-rose-200',
    active: 'ring-2 ring-rose-400 shadow-[0_10px_30px_-10px_rgba(225,29,72,0.55)]',
    tile: 'from-rose-400 to-rose-700 shadow-[0_6px_16px_-4px_rgba(225,29,72,0.6)]',
    line: '#f43f5e',
  },
  sla: {
    card: 'from-amber-50 ring-amber-200',
    active: 'ring-2 ring-amber-400 shadow-[0_10px_30px_-10px_rgba(217,119,6,0.55)]',
    tile: 'from-amber-300 to-amber-600 shadow-[0_6px_16px_-4px_rgba(217,119,6,0.6)]',
    line: '#f59e0b',
  },
  mine: {
    card: 'from-sky-50 ring-sky-200',
    active: 'ring-2 ring-sky-400 shadow-[0_10px_30px_-10px_rgba(2,132,199,0.55)]',
    tile: 'from-sky-400 to-sky-700 shadow-[0_6px_16px_-4px_rgba(2,132,199,0.6)]',
    line: '#0ea5e9',
  },
}

const MODALITY_COLORS: Record<string, string> = { MR: '#06b6d4', CT: '#3b82f6', XR: '#14b8a6' }

function waitPillClass(c: VetCase) {
  const tone = slaTone(c.reviewDueAt)
  if (tone === 'overdue' || tone === 'critical') return 'bg-rose-50 text-rose-700 ring-rose-200'
  if (tone === 'warn' || isSlaAttention(c.reviewDueAt)) return 'bg-amber-50 text-amber-800 ring-amber-200'
  return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
}

function Sparkline({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 80 28" className="pointer-events-none absolute bottom-2 right-3 h-7 w-20 opacity-70" aria-hidden>
      <path d="M2 22 C12 20 16 12 26 15 C36 18 40 8 50 10 C60 12 64 4 78 3" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** Ring chart of the queue by modality. */
function ModalityDonut({ counts, total, label }: { counts: { key: string; name: string; value: number }[]; total: number; label: string }) {
  const r = 42
  const len = 2 * Math.PI * r
  let offset = 0
  return (
    <svg viewBox="0 0 110 110" className="h-32 w-32 shrink-0" aria-hidden>
      <circle cx="55" cy="55" r={r} fill="none" stroke="#eef2f6" strokeWidth="11" />
      {total > 0
        ? counts
            .filter((c) => c.value > 0)
            .map((c) => {
              const dash = (c.value / total) * len
              const el = (
                <circle
                  key={c.key}
                  cx="55"
                  cy="55"
                  r={r}
                  fill="none"
                  stroke={MODALITY_COLORS[c.key] ?? '#94a3b8'}
                  strokeWidth="11"
                  strokeDasharray={`${Math.max(dash - 2, 0)} ${len}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 55 55)"
                />
              )
              offset += dash
              return el
            })
        : null}
      <text x="55" y="54" textAnchor="middle" className="fill-[#102a43] font-display" fontSize="22" fontWeight="700">
        {total}
      </text>
      <text x="55" y="70" textAnchor="middle" fill="#94a3b8" fontSize="10">
        {label}
      </text>
    </svg>
  )
}

function matchesSearch(c: VetCase, needle: string) {
  if (!needle) return true
  return [c.patient.name, c.no, c.id, c.clinic, c.patient.breed, c.patient.species, c.modality, c.anatomicalRegion]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('tr')
    .includes(needle)
}

function viewFromParams(params: URLSearchParams): QueueView {
  if (params.get('sla') === 'az') return 'sla'
  if (params.get('acil') === '1') return 'urgent'
  if (params.get('bana') === '1') return 'mine'
  return 'all'
}

function safeActorId(): string {
  try {
    return currentActorId()
  } catch {
    return ''
  }
}

export default function ReviewQueue() {
  const { cases, pushToast, removeCase } = useApp()
  const { t } = useLocale()
  const nav = useLocalizedNavigate()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<BackendCaseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [modality, setModality] = useState<ModalityFilter>('')
  const [pendingDelete, setPendingDelete] = useState<VetCase | null>(null)
  const [deleting, setDeleting] = useState(false)
  const view = viewFromParams(params)
  const me = safeActorId()

  // One request for the whole queue; every filter below is instant and client-side,
  // so the counts on the tabs always match what the table shows.
  const load = () => {
    setLoading(true)
    setError(null)
    void listBackendWorklist({ status: 'awaiting_review' })
      .then(setRows)
      .catch((err) => {
        setError(err instanceof Error ? err.message : t('review.loadFailed'))
        setRows([])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const localFallback = useMemo(() => cases.filter((c) => c.status === 'uzman_incelemesinde'), [cases])

  const usingStaleFallback = Boolean(error && rows.length === 0 && localFallback.length > 0)
  const baseDisplay = useMemo(
    () => (rows.length ? rows.map(summaryToVetCase) : usingStaleFallback ? localFallback : []),
    [rows, usingStaleFallback, localFallback],
  )

  const needle = q.trim().toLocaleLowerCase('tr')
  const narrowed = useMemo(
    () =>
      baseDisplay.filter(
        (c) => matchesSearch(c, needle) && (!modality || (c.modality || '').toUpperCase() === modality),
      ),
    [baseDisplay, needle, modality],
  )

  const inView = (c: VetCase, v: QueueView) => {
    if (v === 'urgent') return isUrgentCase(c)
    if (v === 'sla') return isSlaAttention(c.reviewDueAt)
    if (v === 'mine') return Boolean(me) && c.assignedReviewerId === me
    return true
  }
  const display = narrowed.filter((c) => inView(c, view))
  const countFor = (v: QueueView) => narrowed.filter((c) => inView(c, v)).length

  const setView = (next: QueueView) => {
    const p = new URLSearchParams(params)
    p.delete('sla')
    p.delete('acil')
    p.delete('bana')
    if (next === 'sla') p.set('sla', 'az')
    if (next === 'urgent') p.set('acil', '1')
    if (next === 'mine') p.set('bana', '1')
    setParams(p, { replace: true })
  }

  const hasFilters = Boolean(needle || modality || view !== 'all')

  const clearFilters = () => {
    setQ('')
    setModality('')
    setView('all')
  }

  const tabs: { id: QueueView; label: string; icon: ReactNode }[] = [
    { id: 'all', label: t('review.totalCases'), icon: <Layers className="h-5 w-5" aria-hidden /> },
    { id: 'urgent', label: t('review.urgentFilter'), icon: <AlertTriangle className="h-5 w-5" aria-hidden /> },
    { id: 'sla', label: t('review.slaFilter'), icon: <Clock className="h-5 w-5" aria-hidden /> },
    { id: 'mine', label: t('review.assignedToMe'), icon: <User className="h-5 w-5" aria-hidden /> },
  ]

  const modalityIcons: Record<string, ReactNode> = {
    '': <Layers className="h-4 w-4" aria-hidden />,
    MR: <Brain className="h-4 w-4" aria-hidden />,
    CT: <ScanLine className="h-4 w-4" aria-hidden />,
    XR: <Bone className="h-4 w-4" aria-hidden />,
  }

  const modalityCounts = (['MR', 'CT', 'XR'] as const).map((key) => ({
    key,
    name: t(`review.modality${key}`),
    value: baseDisplay.filter((c) => (c.modality || '').toUpperCase() === key).length,
  }))

  const regionCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of baseDisplay) {
      const key = (c.anatomicalRegion || 'OTHER').toUpperCase()
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [baseDisplay])

  const sorted = useMemo(() => sortWorklist(display, view === 'sla' ? 'urgent' : 'newest'), [display, view])

  const emptyTitle =
    view === 'sla'
      ? t('review.emptySlaTitle')
      : view === 'urgent'
        ? t('review.emptyUrgentTitle')
        : view === 'mine'
          ? t('review.emptyMineTitle')
          : t('review.emptyNoMatch')
  const emptyText =
    view === 'sla'
      ? t('review.emptySlaText')
      : view === 'urgent'
        ? t('review.emptyUrgentText')
        : view === 'mine'
          ? t('review.emptyMineText')
          : error
            ? t('review.emptyApiText', { error })
            : t('review.emptyExpandFilters')

  const panel = 'rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200'

  return (
    <>
      <div className="vm-fade-up text-slate-800">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-5">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="font-display text-3xl font-bold tracking-tight text-[#102a43] sm:text-4xl">{t('review.worklistTitle')}</h1>
                <p className="mt-1.5 text-sm text-slate-500">{t('review.worklistSubtitle')}</p>
              </div>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="inline-flex items-center gap-2 self-start rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
                {t('common.refresh')}
              </button>
            </header>

            {usingStaleFallback || error ? (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
                {usingStaleFallback ? t('review.staleFallbackBanner') : t('review.apiFallbackSubtitle', { error: error ?? '' })}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="tablist" aria-label={t('dashboard.expertFilterAria')}>
              {tabs.map((tab) => {
                const active = view === tab.id
                const st = TAB_STYLE[tab.id]
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setView(tab.id)}
                    className={`relative flex items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-br to-white px-4 py-4 text-left shadow-sm ring-1 transition duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${st.card} ${
                      active ? st.active : ''
                    }`}
                  >
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white ${st.tile}`}>
                      {tab.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-600">{tab.label}</span>
                      <span className="block font-display text-3xl font-bold leading-tight tabular-nums text-[#102a43]">{countFor(tab.id)}</span>
                    </span>
                    <Sparkline color={st.line} />
                  </button>
                )
              })}
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <label htmlFor="wl-q" className="relative block min-w-0 flex-1">
                <span className="sr-only">{t('common.search')}</span>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  id="wl-q"
                  type="search"
                  className="w-full rounded-xl bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm outline-none ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:ring-2 focus:ring-teal-500/50"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('review.searchPlaceholder')}
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
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                          active
                            ? 'bg-teal-600 text-white shadow-[0_4px_12px_-4px_rgba(13,148,136,0.7)]'
                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                      >
                        {modalityIcons[m]}
                        {m ? t(`review.modality${m}`) : t('review.allModalities')}
                      </button>
                    )
                  })}
                </div>
                {hasFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                  >
                    <X className="h-4 w-4" aria-hidden />
                    {t('review.clearFilters')}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              {loading ? (
                <p className="flex items-center gap-2 px-5 py-10 text-sm text-slate-500" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('review.loadingWorklist')}
                </p>
              ) : sorted.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
                  <HoloOrgan region="OTHER" size={56} />
                  <p className="font-semibold text-slate-900">{emptyTitle}</p>
                  <p className="max-w-sm text-sm text-slate-500">{emptyText}</p>
                  {hasFilters ? (
                    <button type="button" onClick={clearFilters} className="mt-2 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700">
                      {t('review.clearFilters')}
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs font-medium text-slate-500">
                        <th scope="col" className="px-5 py-3.5 font-medium">{t('dashboard.expertColPatient')}</th>
                        <th scope="col" className="hidden px-4 py-3.5 font-medium xl:table-cell">{t('review.colSpeciesBreed')}</th>
                        <th scope="col" className="px-4 py-3.5 font-medium">{t('dashboard.expertColStudy')}</th>
                        <th scope="col" className="px-4 py-3.5 font-medium">{t('review.colRegion')}</th>
                        <th scope="col" className="px-4 py-3.5 font-medium">{t('dashboard.expertColStatus')}</th>
                        <th scope="col" className="hidden px-4 py-3.5 font-medium 2xl:table-cell">{t('review.colCaseNo')}</th>
                        <th scope="col" className="px-4 py-3.5"><span className="sr-only">{t('dashboard.expertColAction')}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((c) => {
                        const urgent = isUrgentCase(c)
                        const breed = c.patient.breed && !['—', '-'].includes(c.patient.breed.trim()) ? c.patient.breed : ''
                        const openCase = () => nav(`/vakalar/${c.id}/calisma`)
                        return (
                          <tr
                            key={c.id}
                            tabIndex={0}
                            aria-label={`${c.patient.name} — ${t('dashboard.expertOpen')}`}
                            onClick={(e) => {
                              if ((e.target as HTMLElement).closest('button')) return
                              openCase()
                            }}
                            onKeyDown={(e) => {
                              if ((e.key === 'Enter' || e.key === ' ') && !(e.target as HTMLElement).closest('button')) {
                                e.preventDefault()
                                openCase()
                              }
                            }}
                            className={`cursor-pointer border-t border-slate-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600 ${
                              urgent ? 'bg-rose-50/70 hover:bg-rose-50' : 'hover:bg-teal-50/60'
                            }`}
                          >
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-3">
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-sky-50 to-slate-100 ring-1 ring-slate-200">
                                  <SpeciesIcon3D species={c.patient.species} size={36} />
                                </span>
                                <span className="min-w-0">
                                  <span className="flex items-center gap-2">
                                    <span className="truncate text-[15px] font-semibold text-slate-900">{c.patient.name}</span>
                                    {c.priority !== 'Normal' ? <PriorityBadge priority={c.priority} /> : null}
                                  </span>
                                  <span className="block truncate text-xs text-slate-500 xl:hidden">{[c.patient.species, breed].filter(Boolean).join(' · ')}</span>
                                </span>
                              </div>
                            </td>
                            <td className="hidden px-4 py-3 text-slate-600 xl:table-cell">
                              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                <PawPrint className="h-4 w-4 text-slate-400" aria-hidden />
                                {[c.patient.species, breed].filter(Boolean).join(' · ')}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="rounded-md bg-sky-50 px-2 py-0.5 text-xs font-bold tracking-wide text-sky-800 ring-1 ring-sky-200">
                                {(c.modality || '').toUpperCase() === 'CT' ? modalityLabel(t, 'CT') : c.modality || t('common.dash')}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                                <HoloOrgan region={c.anatomicalRegion} size={34} />
                                {regionLabel(t, c.anatomicalRegion) || t('common.dash')}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${waitPillClass(c)}`}>
                                <Clock className="h-3.5 w-3.5" aria-hidden />
                                {waitLabel(c, t)}
                              </span>
                            </td>
                            <td className="hidden whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500 2xl:table-cell">{c.no}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setPendingDelete(c)}
                                  aria-label={t('review.hideFromMyList')}
                                  title={t('review.hideFromMyList')}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                                >
                                  <EyeOff className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={openCase}
                                  aria-label={t('dashboard.expertOpen')}
                                  title={t('dashboard.expertOpen')}
                                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-white shadow-[0_4px_12px_-4px_rgba(13,148,136,0.7)] transition hover:bg-teal-700"
                                >
                                  <ChevronRight className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <p className="flex items-center gap-2 px-1 text-xs text-slate-500">
              <Info className="h-3.5 w-3.5" aria-hidden /> {t('review.footerNote')}
            </p>
          </div>

          <aside className="space-y-4">
            <section className={panel} aria-labelledby="wl-modality-title">
              <h2 id="wl-modality-title" className="font-display text-base font-semibold text-[#102a43]">{t('review.modalityBreakdown')}</h2>
              <div className="mt-4 flex items-center gap-5">
                <ModalityDonut counts={modalityCounts} total={baseDisplay.length} label={t('review.casesUnit')} />
                <ul className="min-w-0 flex-1 space-y-3 text-sm">
                  {modalityCounts.map((m) => (
                    <li key={m.key} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-slate-600">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: MODALITY_COLORS[m.key] }} />
                        {m.name}
                      </span>
                      <span className="font-semibold tabular-nums text-slate-900">{m.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className={panel} aria-labelledby="wl-region-title">
              <h2 id="wl-region-title" className="font-display text-base font-semibold text-[#102a43]">{t('review.regionBreakdown')}</h2>
              <ul className="mt-4 space-y-4">
                {regionCounts.length === 0 ? (
                  <li className="text-sm text-slate-500">{t('dashboard.queueEmptyTitle')}</li>
                ) : (
                  regionCounts.map(([region, n]) => {
                    const pct = Math.round((n / Math.max(baseDisplay.length, 1)) * 100)
                    return (
                      <li key={region} className="flex items-center gap-3">
                        <HoloOrgan region={region} size={40} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-slate-700">{regionLabel(t, region) || region}</span>
                            <span className="tabular-nums text-slate-500">{pct}%</span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-teal-500 to-cyan-400"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </li>
                    )
                  })
                )}
              </ul>
            </section>
          </aside>
        </div>
      </div>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => {
          if (!deleting) setPendingDelete(null)
        }}
        title={t('review.deleteCaseTitle')}
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={deleting} onClick={() => setPendingDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={deleting}
              icon={deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
              onClick={() => {
                if (!pendingDelete || deleting) return
                const target = pendingDelete
                setDeleting(true)
                void hideBackendCase(target.backendCaseId || target.id)
                  .then(() => {
                    removeCase(target.id)
                    setPendingDelete(null)
                    pushToast({ tone: 'success', title: t('review.caseDeleted'), body: `${target.patient.name} · ${target.no}` })
                    load()
                  })
                  .catch((err) =>
                    pushToast({
                      tone: 'error',
                      title: t('review.deleteFailed'),
                      body: toastErrorBody(err, t),
                    }),
                  )
                  .finally(() => setDeleting(false))
              }}
            >
              {deleting ? t('review.deleting') : t('review.confirmDelete')}
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>{t('review.deleteCaseConfirm', { name: pendingDelete.patient.name })}</p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
              {pendingDelete.no} · {pendingDelete.id}
            </p>
            <p className="text-xs text-[color:var(--vm-danger)]">{t('review.irreversible')}</p>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
