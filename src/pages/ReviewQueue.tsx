import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clock, Info, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { Button } from '../components/Button'
import { ExpertWorklistTable } from '../components/ExpertWorklistTable'
import { Modal } from '../components/Modal'
import { currentActorId } from '../lib/auth'
import { toastErrorBody } from '../lib/apiErrors'
import { deleteBackendCase, listBackendWorklist, updateCaseAssignment } from '../lib/backend'
import { summaryToVetCase } from '../lib/caseMapper'
import { compareBySlaUrgency, isSlaAttention } from '../lib/reviewSla'
import type { BackendCaseSummary, VetCase } from '../types'

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
  const slaOnly = params.get('sla') === 'az'

  const load = () => {
    setLoading(true)
    setError(null)
    void listBackendWorklist({
      status: status || undefined,
      modality: modality || undefined,
      priority: priority || undefined,
      assigned_to: assigned || undefined,
      q: q || undefined,
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

  const localFallback = useMemo(
    () => cases.filter((c) => c.status === 'uzman_incelemesinde').map((c) => c),
    [cases],
  )

  const usingStaleFallback = Boolean(error && rows.length === 0 && localFallback.length > 0)
  const baseDisplay = rows.length
    ? rows.map(summaryToVetCase)
    : usingStaleFallback
      ? localFallback
      : rows.map(summaryToVetCase)

  const display = useMemo(() => {
    const list = slaOnly ? baseDisplay.filter((c) => isSlaAttention(c.reviewDueAt)) : baseDisplay
    if (!slaOnly) return list
    return [...list].sort((a, b) => compareBySlaUrgency(a.reviewDueAt, b.reviewDueAt))
  }, [baseDisplay, slaOnly])

  const slaCount = baseDisplay.filter((c) => isSlaAttention(c.reviewDueAt)).length

  const setSlaFilter = (on: boolean) => {
    const next = new URLSearchParams(params)
    if (on) next.set('sla', 'az')
    else next.delete('sla')
    setParams(next, { replace: true })
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

  const hasFilters = Boolean(q.trim() || modality || priority || assigned || status !== 'awaiting_review')
  const filterClass =
    'rounded-xl border-0 bg-white/90 px-3 py-2.5 text-xs font-medium text-navy-900 outline-none ring-1 ring-white/50 focus:ring-2 focus:ring-white'

  const clearFilters = () => {
    setQ('')
    setModality('')
    setPriority('')
    setAssigned('')
    setStatus('awaiting_review')
    setSlaFilter(false)
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

  const listSubtitle = error
    ? t('review.apiFallbackSubtitle', { error })
    : slaOnly
      ? t('review.slaListSubtitle')
      : t('review.defaultListSubtitle')

  return (
    <>
      <div className="vm-fade-up relative -mx-1 space-y-4">
        <section className="relative overflow-hidden rounded-xl border border-slate-200 bg-navy-950 px-5 py-6 text-white shadow-soft sm:px-7">
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                {t('review.caseCountTitle', { count: display.length })}
              </p>
              <h1 className="mt-1 font-[family-name:var(--vm-font-display)] text-3xl font-semibold tracking-tight sm:text-4xl">
                {t('review.worklistTitle')}
              </h1>
              <p className="mt-1.5 max-w-md text-sm text-slate-300">{t('review.worklistSubtitle')}</p>
              {usingStaleFallback ? (
                <p className="mt-3 rounded-lg bg-amber-400/20 px-3 py-2 text-xs text-amber-100 ring-1 ring-amber-300/30" role="status">
                  {t('review.staleFallbackBanner')}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t('dashboard.expertFilterAria')}>
                <button
                  type="button"
                  onClick={() => setSlaFilter(false)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    !slaOnly ? 'bg-teal-400 text-navy-950' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  }`}
                >
                  {t('review.allQueue')}{' '}
                  <span className={!slaOnly ? 'opacity-80' : 'text-slate-400'}>{baseDisplay.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSlaFilter(true)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    slaOnly ? 'bg-rose-400 text-rose-950' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  }`}
                >
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  {t('review.slaFilter')}{' '}
                  <span className={slaOnly ? 'opacity-80' : 'text-slate-400'}>{slaCount}</span>
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 self-start rounded-xl bg-white/10 px-3.5 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/15 disabled:opacity-50 lg:self-end"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
              {t('common.refresh')}
            </button>
          </div>

          <div className="relative mt-5 flex flex-col gap-2 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{t('common.search')}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-teal-200/70" aria-hidden />
              <input
                id="wl-q"
                className="w-full rounded-xl border-0 bg-white/10 py-2.5 pl-9 pr-3 text-sm text-white outline-none ring-1 ring-white/20 placeholder:text-slate-400 focus:bg-white/15 focus:ring-2 focus:ring-teal-300/50"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load()}
                placeholder={t('review.searchPlaceholder')}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <select
                id="wl-status"
                aria-label={t('common.status')}
                className={filterClass}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">{t('common.all')}</option>
                <option value="awaiting_review">{t('review.statusAwaitingReview')}</option>
                <option value="revision_requested">{t('review.statusRevision')}</option>
                <option value="manual_review">{t('review.statusManual')}</option>
                <option value="analyzing">{t('review.statusAnalyzing')}</option>
              </select>
              <select
                id="wl-modality"
                aria-label={t('cases.modality')}
                className={filterClass}
                value={modality}
                onChange={(e) => setModality(e.target.value)}
              >
                <option value="">{t('common.all')}</option>
                <option value="MR">MR</option>
                <option value="CT">CT</option>
                <option value="XR">XR</option>
              </select>
              <select
                id="wl-priority"
                aria-label={t('common.priority')}
                className={filterClass}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="">{t('common.all')}</option>
                <option value="stat">{t('priority.STAT')}</option>
                <option value="urgent">{t('priority.Acil')}</option>
                <option value="high">{t('priority.Yüksek')}</option>
                <option value="normal">{t('priority.Normal')}</option>
              </select>
              <select
                id="wl-assigned"
                aria-label={t('review.assignment')}
                className={filterClass}
                value={assigned}
                onChange={(e) => setAssigned(e.target.value)}
              >
                <option value="">{t('common.all')}</option>
                <option value="unassigned">{t('cases.unassigned')}</option>
                <option value={currentActorId()}>{t('review.assignedToMe')}</option>
              </select>
              <button
                type="button"
                onClick={load}
                className="rounded-xl bg-teal-400 px-3.5 py-2.5 text-xs font-semibold text-navy-950 transition hover:bg-teal-300"
              >
                {t('review.filterApply')}
              </button>
              {hasFilters || slaOnly ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-xl bg-white/10 px-3 py-2.5 text-xs font-semibold text-teal-100 ring-1 ring-white/20 transition hover:bg-white/20"
                >
                  {t('common.clear')}
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">
            {t('review.apiFallbackSubtitle', { error })}
          </div>
        )}

        <div className="relative overflow-hidden rounded-[1.5rem] bg-white ring-1 ring-slate-200/70">
          <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-navy-900">{t('review.caseCountTitle', { count: display.length })}</h2>
            <p className="text-xs text-slate-500">{listSubtitle}</p>
          </div>
          <ExpertWorklistTable
            items={display}
            loading={loading}
            showClaim
            onClaim={claim}
            emptyTitle={slaOnly ? t('review.emptySlaTitle') : t('review.emptyNoMatch')}
            emptyText={
              slaOnly
                ? t('review.emptySlaText')
                : error
                  ? t('review.emptyApiText', { error })
                  : t('review.emptyExpandFilters')
            }
            emptyAction={
              slaOnly ? (
                <Button size="sm" variant="secondary" onClick={() => setSlaFilter(false)}>
                  {t('review.showAllQueue')}
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
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-[color:var(--vm-danger)]"
                onClick={() => setPendingDelete(c)}
                aria-label={t('common.delete')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          />
        </div>

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
              variant="danger"
              size="sm"
              disabled={deleting}
              icon={deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              onClick={() => {
                if (!pendingDelete || deleting) return
                const target = pendingDelete
                setDeleting(true)
                void deleteBackendCase(target.backendCaseId || target.id)
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
