import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clock, Info, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ExpertWorklistTable } from '../components/ExpertWorklistTable'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { currentActorId } from '../lib/auth'
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

  const baseDisplay = rows.length
    ? rows.map(summaryToVetCase)
    : error
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
          body: err instanceof Error ? err.message : undefined,
        }),
      )
  }

  return (
    <>
      <PageHeader
        title={t('review.worklistTitle')}
        subtitle={t('review.worklistSubtitle')}
        crumbs={[{ label: t('nav.expertOverview'), to: '/' }, { label: t('nav.expertWorklist') }]}
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={load} disabled={loading}>
            {t('common.refresh')}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('dashboard.expertFilterAria')}>
        <button
          type="button"
          onClick={() => setSlaFilter(false)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            !slaOnly ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {t('review.allQueue')}
          <span className={`ml-1.5 tabular-nums ${!slaOnly ? 'text-white/70' : 'text-slate-400'}`}>{baseDisplay.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setSlaFilter(true)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
            slaOnly
              ? 'bg-[color:var(--vm-danger)] text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {t('review.slaFilter')}
          <span className={`tabular-nums ${slaOnly ? 'text-white/80' : 'text-slate-400'}`}>{slaCount}</span>
        </button>
      </div>

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="label" htmlFor="wl-q">
            {t('common.search')}
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                id="wl-q"
                className="input pl-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load()}
                placeholder={t('review.searchPlaceholder')}
              />
            </div>
          </label>
          <label className="label" htmlFor="wl-status">
            {t('common.status')}
            <select id="wl-status" className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('common.all')}</option>
              <option value="awaiting_review">{t('review.statusAwaitingReview')}</option>
              <option value="revision_requested">{t('review.statusRevision')}</option>
              <option value="manual_review">{t('review.statusManual')}</option>
              <option value="analyzing">{t('review.statusAnalyzing')}</option>
            </select>
          </label>
          <label className="label" htmlFor="wl-modality">
            {t('cases.modality')}
            <select id="wl-modality" className="input mt-1" value={modality} onChange={(e) => setModality(e.target.value)}>
              <option value="">{t('common.all')}</option>
              <option value="MR">MR</option>
              <option value="CT">CT</option>
              <option value="XR">XR</option>
            </select>
          </label>
          <label className="label" htmlFor="wl-priority">
            {t('common.priority')}
            <select id="wl-priority" className="input mt-1" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">{t('common.all')}</option>
              <option value="stat">{t('priority.STAT')}</option>
              <option value="urgent">{t('priority.Acil')}</option>
              <option value="high">{t('priority.Yüksek')}</option>
              <option value="normal">{t('priority.Normal')}</option>
            </select>
          </label>
          <label className="label" htmlFor="wl-assigned">
            {t('review.assignment')}
            <select id="wl-assigned" className="input mt-1" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
              <option value="">{t('common.all')}</option>
              <option value="unassigned">{t('cases.unassigned')}</option>
              <option value={currentActorId()}>{t('review.assignedToMe')}</option>
            </select>
          </label>
        </div>
        <div className="mt-3">
          <Button size="sm" onClick={load}>
            {t('review.filterApply')}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-navy-900">{t('review.caseCountTitle', { count: display.length })}</h2>
          <p className="text-xs text-slate-500">
            {error
              ? t('review.apiFallbackSubtitle', { error })
              : slaOnly
                ? t('review.slaListSubtitle')
                : t('review.defaultListSubtitle')}
          </p>
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
      </Card>
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <Info className="h-3.5 w-3.5" /> {t('review.footerNote')}
      </p>

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
                      body: err instanceof Error ? err.message : undefined,
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
