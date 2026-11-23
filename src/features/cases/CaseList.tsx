import { useEffect, useMemo, useState } from 'react'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  UploadCloud,
  Users,
} from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { Button } from '../../shared/ui/Button'
import { CaseTable } from '../../shared/ui/CaseTable'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Modal } from '../../shared/ui/Modal'
import { STATUS_META, STATUS_ORDER } from '../../shared/ui/StatusBadge'
import { deleteBackendCase } from '../../shared/api'
import type { BackendModality, CaseStatus, VetCase } from '../../shared/types'

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

function expertKey(c: VetCase): string {
  return c.assignedReviewerId?.trim() || ''
}

export default function CaseList() {
  const { cases, role, refreshBackendCases, backendSyncing, pushToast, removeCase } = useApp()
  const { t, intlLocale } = useLocale()
  const nav = useLocalizedNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<CaseStatus | '' | 'failed'>('')
  const [species, setSpecies] = useState('')
  const [modality, setModality] = useState<BackendModality | ''>('')
  const [expert, setExpert] = useState('')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [initialLoad, setInitialLoad] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<VetCase | null>(null)
  const [deleting, setDeleting] = useState(false)
  const canDeleteCases = role === 'expert' || role === 'vet' || role === 'admin'

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
    const set = new Set<string>()
    for (const c of cases) {
      const k = expertKey(c)
      if (k) set.add(k)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, intlLocale))
  }, [cases, intlLocale])

  const counts = useMemo(() => {
    const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<CaseStatus, number>
    for (const c of cases) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1
    const total = cases.length
    const review = byStatus.uzman_incelemesinde ?? 0
    const approved = byStatus.onaylandi ?? 0
    const failed = (byStatus.analiz_basarisiz ?? 0) + (byStatus.reddedildi ?? 0)
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
    return { byStatus, total, review, approved, failed, pct }
  }, [cases])

  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase(intlLocale)
    return cases.filter(
      (c) =>
        (!status ||
          (status === 'failed'
            ? c.status === 'analiz_basarisiz' || c.status === 'reddedildi'
            : c.status === status)) &&
        (!species || c.patient.species === species) &&
        (!modality || c.modality === modality) &&
        (!expert || expertKey(c) === expert) &&
        (!s ||
          [c.no, c.patient.name, c.patient.breed, c.modality, c.anatomicalRegion, c.studyInstanceUid, c.assignedReviewerId]
            .filter(Boolean)
            .some((f) => String(f).toLocaleLowerCase(intlLocale).includes(s))),
    )
  }, [cases, q, status, species, modality, expert, intlLocale])

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
  }

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return
    const target = pendingDelete
    setDeleting(true)
    try {
      await deleteBackendCase(target.backendCaseId || target.id)
      removeCase(target.id)
      setPendingDelete(null)
      pushToast({
        tone: 'success',
        title: t('cases.deleted'),
        body: `${target.patient.name} · ${target.no}`,
      })
    } catch (err) {
      pushToast({
        tone: 'error',
        title: t('cases.deleteFailed'),
        body: err instanceof Error ? err.message : t('cases.serverError'),
      })
    } finally {
      setDeleting(false)
    }
  }

  const showSkeleton = initialLoad && backendSyncing && cases.length === 0
  const hasFilters = Boolean(q.trim() || status || species || modality || expert)
  const filterClass =
    'rounded-xl border-0 bg-white/90 px-3 py-2.5 text-xs font-medium text-navy-900 outline-none ring-1 ring-white/50 focus:ring-2 focus:ring-white'

  return (
    <>
      <div className="vm-fade-up relative -mx-1 space-y-4">
        <section className="relative overflow-hidden rounded-[1.5rem] bg-[color:var(--vm-midnight,#0b1728)] px-5 py-6 text-white shadow-[0_20px_50px_-28px_rgba(11,23,40,0.55)] sm:px-7">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(45,212,191,0.35),transparent_50%),radial-gradient(ellipse_at_100%_80%,rgba(20,184,166,0.18),transparent_45%)]"
          />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-300/90">
                {t('cases.showingCount', { shown: filtered.length, total: cases.length })}
              </p>
              <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">
                {t('nav.cases')}
              </h1>
              <p className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-300">{t('cases.subtitle')}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setStatus('')}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    !status ? 'bg-teal-400 text-navy-950' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  }`}
                >
                  {t('common.all')} {counts.total}
                </button>
                <button
                  type="button"
                  onClick={() => setStatus(status === 'uzman_incelemesinde' ? '' : 'uzman_incelemesinde')}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    status === 'uzman_incelemesinde' ? 'bg-amber-400 text-amber-950' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  }`}
                >
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  {t(STATUS_META.uzman_incelemesinde.labelKey)} {counts.review}
                </button>
                <button
                  type="button"
                  onClick={() => setStatus(status === 'onaylandi' ? '' : 'onaylandi')}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    status === 'onaylandi' ? 'bg-emerald-400 text-emerald-950' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  {t(STATUS_META.onaylandi.labelKey)} {counts.approved}
                </button>
                <button
                  type="button"
                  onClick={() => setStatus(status === 'failed' ? '' : 'failed')}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                    status === 'failed' ? 'bg-rose-400 text-rose-950' : 'bg-white/10 text-slate-200 hover:bg-white/15'
                  }`}
                >
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  {t(STATUS_META.analiz_basarisiz.labelKey)} {counts.failed}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void onSync()}
                disabled={backendSyncing}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/15 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${backendSyncing ? 'animate-spin' : ''}`} aria-hidden />
                {t('common.refresh')}
              </button>
              {role === 'vet' && (
                <>
                  <Button variant="secondary" icon={<UploadCloud className="h-4 w-4" />} onClick={() => nav('/dicom-yukle')}>
                    {t('nav.dicomUpload')}
                  </Button>
                  <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => nav('/vakalar/yeni')}>
                    {t('nav.newCase')}
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="relative mt-5 flex flex-col gap-2 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{t('cases.searchCasesAria')}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-teal-200/70" aria-hidden />
              <input
                className="w-full rounded-xl border-0 bg-white/10 py-2.5 pl-9 pr-3 text-sm text-white outline-none ring-1 ring-white/20 placeholder:text-slate-400 focus:bg-white/15 focus:ring-2 focus:ring-teal-300/50"
                placeholder={t('cases.listSearchPlaceholder')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <select
                aria-label={t('common.status')}
                className={filterClass}
                value={status}
                onChange={(e) => setStatus(e.target.value as CaseStatus | '' | 'failed')}
              >
                <option value="">{t('cases.filterAllStatuses')}</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {t(STATUS_META[s].labelKey)}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('cases.species')}
                className={filterClass}
                value={species}
                onChange={(e) => setSpecies(e.target.value)}
              >
                <option value="">{t('cases.filterAllSpecies')}</option>
                <option value="Köpek">{t('species.dog')}</option>
                <option value="Kedi">{t('species.cat')}</option>
              </select>
              <select
                aria-label={t('cases.modality')}
                className={filterClass}
                value={modality}
                onChange={(e) => setModality(e.target.value as BackendModality | '')}
              >
                <option value="">{t('common.all')}</option>
                <option value="MR">MR</option>
                <option value="CT">CT</option>
                <option value="XR">XR</option>
              </select>
              <select
                aria-label={t('cases.expert')}
                className={filterClass}
                value={expert}
                onChange={(e) => setExpert(e.target.value)}
              >
                <option value="">{t('cases.filterAllExperts')}</option>
                {experts.map((e) => (
                  <option key={e} value={e}>
                    {e.includes('@') ? e.split('@')[0] : e}
                  </option>
                ))}
              </select>
              {hasFilters ? (
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

        {syncError && (
          <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
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

        <div className="relative overflow-hidden rounded-[1.5rem] bg-white ring-1 ring-slate-200/70">
          {showSkeleton ? (
            <TableSkeleton loadingLabel={t('cases.loadingCasesAria')} />
          ) : filtered.length ? (
            <CaseTable
              cases={filtered}
              showPriority={role === 'expert'}
              onDelete={canDeleteCases ? (c) => setPendingDelete(c) : undefined}
            />
          ) : cases.length === 0 ? (
            <EmptyState
              icon={<FolderOpen className="h-6 w-6" />}
              title={t('cases.empty')}
              text={t('cases.emptyHint')}
              action={
                role === 'vet' ? (
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => nav('/dicom-yukle')}>
                      {t('nav.dicomUpload')}
                    </Button>
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
        </div>
      </div>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => {
          if (!deleting) setPendingDelete(null)
        }}
        title={t('cases.deleteConfirmTitle')}
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
              onClick={() => void confirmDelete()}
            >
              {deleting ? t('cases.deleting') : t('cases.deleteConfirmYes')}
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              {t('cases.deleteConfirmBody', {
                name: pendingDelete.patient.name,
                no: pendingDelete.no,
              })}
            </p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">{pendingDelete.id}</p>
            <p className="text-xs text-rose-700">{t('cases.deleteIrreversible')}</p>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
