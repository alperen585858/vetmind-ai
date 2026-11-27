import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Clock, EyeOff, Info, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { Button } from '../../shared/ui/Button'
import { ExpertWorklistTable, isUrgentCase } from './ExpertWorklistTable'
import { Modal } from '../../shared/ui/Modal'
import { currentActorId } from '../../shared/auth/session'
import { toastErrorBody } from '../../shared/lib/apiErrors'
import { hideBackendCase, listBackendWorklist, updateCaseAssignment } from '../../shared/api'
import { summaryToVetCase } from '../../shared/lib/caseMapper'
import { isSlaAttention } from '../../shared/lib/reviewSla'
import type { BackendCaseSummary, VetCase } from '../../shared/types'

const FILTER_SELECT =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20'

type QueueView = 'all' | 'urgent' | 'sla'

function matchesSearch(c: VetCase, needle: string) {
  if (!needle) return true
  return [c.patient.name, c.no, c.id, c.clinic, c.patient.breed, c.patient.species, c.modality, c.anatomicalRegion]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('tr')
    .includes(needle)
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  children: ReactNode
}) {
  return (
    <label htmlFor={id} className="flex min-w-[9rem] flex-1 flex-col gap-1 sm:flex-none">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select id={id} className={FILTER_SELECT} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  )
}

export default function ReviewQueue() {
  const { cases, pushToast, hydrateBackendCase, removeCase } = useApp()
  const { t } = useLocale()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<BackendCaseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [modality, setModality] = useState('')
  const [priority, setPriority] = useState('')
  const [status, setStatus] = useState('awaiting_review')
  const [assigned, setAssigned] = useState('')
  const [pendingDelete, setPendingDelete] = useState<VetCase | null>(null)
  const [deleting, setDeleting] = useState(false)
  const view: QueueView = params.get('sla') === 'az' ? 'sla' : params.get('acil') === '1' ? 'urgent' : 'all'

  const load = () => {
    setLoading(true)
    setError(null)
    void listBackendWorklist({
      status: status || undefined,
      modality: modality || undefined,
      priority: priority || undefined,
      assigned_to: assigned || undefined,
    })
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
  }, [status, modality, priority, assigned])

  const localFallback = useMemo(() => cases.filter((c) => c.status === 'uzman_incelemesinde'), [cases])

  const usingStaleFallback = Boolean(error && rows.length === 0 && localFallback.length > 0)
  const baseDisplay = useMemo(
    () => (rows.length ? rows.map(summaryToVetCase) : usingStaleFallback ? localFallback : []),
    [rows, usingStaleFallback, localFallback],
  )

  const needle = q.trim().toLocaleLowerCase('tr')
  const searched = useMemo(() => baseDisplay.filter((c) => matchesSearch(c, needle)), [baseDisplay, needle])
  const urgentCount = searched.filter(isUrgentCase).length
  const slaCount = searched.filter((c) => isSlaAttention(c.reviewDueAt)).length

  const display = useMemo(() => {
    if (view === 'urgent') return searched.filter(isUrgentCase)
    if (view === 'sla') return searched.filter((c) => isSlaAttention(c.reviewDueAt))
    return searched
  }, [searched, view])

  const setView = (next: QueueView) => {
    const p = new URLSearchParams(params)
    p.delete('sla')
    p.delete('acil')
    if (next === 'sla') p.set('sla', 'az')
    if (next === 'urgent') p.set('acil', '1')
    setParams(p, { replace: true })
  }

  const claim = (c: VetCase) => {
    void updateCaseAssignment(c.backendCaseId || c.id, {
      assigned_reviewer_id: currentActorId(),
      priority:
        c.priority === 'STAT'
          ? 'stat'
          : c.priority === 'Acil'
            ? 'urgent'
            : c.priority === 'Yüksek'
              ? 'high'
              : 'normal',
    })
      .then(() => {
        pushToast({ tone: 'success', title: t('review.assignedToast') })
        void hydrateBackendCase(c.backendCaseId || c.id)
        load()
      })
      .catch((err) =>
        pushToast({
          tone: 'error',
          title: t('review.assignFailed'),
          body: toastErrorBody(err, t),
        }),
      )
  }

  const hasFilters = Boolean(needle || modality || priority || assigned || status !== 'awaiting_review' || view !== 'all')

  const clearFilters = () => {
    setQ('')
    setModality('')
    setPriority('')
    setAssigned('')
    setStatus('awaiting_review')
    setView('all')
  }

  const tabs: { id: QueueView; label: string; count: number; icon?: ReactNode }[] = [
    { id: 'all', label: t('review.allQueue'), count: searched.length },
    { id: 'urgent', label: t('review.urgentFilter'), count: urgentCount, icon: <AlertTriangle className="h-4 w-4" aria-hidden /> },
    { id: 'sla', label: t('review.slaFilter'), count: slaCount, icon: <Clock className="h-4 w-4" aria-hidden /> },
  ]

  const listSubtitle = view === 'sla' ? t('review.slaListSubtitle') : t('review.defaultListSubtitle')

  return (
    <>
      <div className="vm-fade-up space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {t('review.worklistTitle')}
            </h1>
            <p className="mt-1 text-sm text-slate-500">{t('review.worklistSubtitle')}</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={load}
            disabled={loading}
            icon={<RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />}
          >
            {t('common.refresh')}
          </Button>
        </header>

        {usingStaleFallback ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            {t('review.staleFallbackBanner')}
          </p>
        ) : error ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
            {t('review.apiFallbackSubtitle', { error })}
          </p>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap gap-1 border-b border-slate-200 px-3 pt-3" role="tablist" aria-label={t('dashboard.expertFilterAria')}>
            {tabs.map((tab) => {
              const active = view === tab.id
              const tone =
                tab.id === 'urgent' && tab.count > 0 && !active ? 'text-rose-700' : active ? 'text-slate-900' : 'text-slate-500'
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setView(tab.id)}
                  className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-sm font-semibold transition ${
                    active ? 'border-teal-600' : 'border-transparent hover:text-slate-800'
                  } ${tone}`}
                >
                  {tab.icon}
                  {tab.label}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
                      tab.id === 'urgent' && tab.count > 0
                        ? 'bg-rose-600 text-white'
                        : active
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-4 lg:flex-row lg:items-end">
            <label htmlFor="wl-q" className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">{t('common.search')}</span>
              <span className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  id="wl-q"
                  type="search"
                  className={`${FILTER_SELECT} pl-9`}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t('review.searchPlaceholder')}
                />
              </span>
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <FilterSelect id="wl-status" label={t('review.filterStatusLabel')} value={status} onChange={setStatus}>
                <option value="">{t('common.all')}</option>
                <option value="awaiting_review">{t('review.statusAwaitingReview')}</option>
                <option value="revision_requested">{t('review.statusRevision')}</option>
                <option value="manual_review">{t('review.statusManual')}</option>
                <option value="analyzing">{t('review.statusAnalyzing')}</option>
              </FilterSelect>
              <FilterSelect id="wl-modality" label={t('review.filterModalityLabel')} value={modality} onChange={setModality}>
                <option value="">{t('common.all')}</option>
                <option value="MR">MR</option>
                <option value="CT">CT</option>
                <option value="XR">XR</option>
              </FilterSelect>
              <FilterSelect id="wl-priority" label={t('review.filterPriorityLabel')} value={priority} onChange={setPriority}>
                <option value="">{t('common.all')}</option>
                <option value="stat">{t('priority.STAT')}</option>
                <option value="urgent">{t('priority.Acil')}</option>
                <option value="high">{t('priority.Yüksek')}</option>
                <option value="normal">{t('priority.Normal')}</option>
              </FilterSelect>
              <FilterSelect id="wl-assigned" label={t('review.filterAssignmentLabel')} value={assigned} onChange={setAssigned}>
                <option value="">{t('common.all')}</option>
                <option value="unassigned">{t('cases.unassigned')}</option>
                <option value={currentActorId()}>{t('review.assignedToMe')}</option>
              </FilterSelect>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-200/60 hover:text-slate-900"
                >
                  <X className="h-4 w-4" aria-hidden />
                  {t('common.clear')}
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-5 py-3 text-xs text-slate-500">
            <span>{listSubtitle}</span>
            <span className="tabular-nums">{t('review.filteredCount', { shown: display.length, total: baseDisplay.length })}</span>
          </div>

          <ExpertWorklistTable
            items={display}
            loading={loading}
            order={view === 'sla' ? 'urgent' : 'newest'}
            showClaim
            onClaim={claim}
            emptyTitle={
              view === 'sla' ? t('review.emptySlaTitle') : view === 'urgent' ? t('review.emptyUrgentTitle') : t('review.emptyNoMatch')
            }
            emptyText={
              view === 'sla'
                ? t('review.emptySlaText')
                : view === 'urgent'
                  ? t('review.emptyUrgentText')
                  : error
                    ? t('review.emptyApiText', { error })
                    : t('review.emptyExpandFilters')
            }
            emptyAction={
              hasFilters ? (
                <Button size="sm" variant="secondary" onClick={clearFilters}>
                  {t('common.clear')}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={load}>
                  {t('common.refresh')}
                </Button>
              )
            }
            secondaryActions={(c) => (
              <button
                type="button"
                className="inline-flex items-center text-slate-400 transition hover:text-slate-700"
                onClick={() => setPendingDelete(c)}
                aria-label={t('review.hideFromMyList')}
                title={t('review.hideFromMyList')}
              >
                <EyeOff className="h-4 w-4" />
              </button>
            )}
          />
        </section>

        <p className="flex items-center gap-2 px-1 text-xs text-slate-500">
          <Info className="h-3.5 w-3.5" aria-hidden /> {t('review.footerNote')}
        </p>
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
