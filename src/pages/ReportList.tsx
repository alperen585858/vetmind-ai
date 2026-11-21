import { useEffect, useMemo, useState } from 'react'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import {
  AlertTriangle,
  Download,
  FileCheck2,
  FileText,
  Loader2,
  Search,
  Send,
  Trash2,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { SpeciesIcon } from '../components/CaseTable'
import { deleteBackendCase, downloadApprovedReportPdf, submitBackendReview } from '../lib/backend'
import { toastErrorBody } from '../lib/apiErrors'
import { caseBelongsToOwner } from '../lib/caseMapper'
import { regionLabel } from '../lib/displayClean'
import { fmtDate } from '../lib/format'
import type { BackendModality, VetCase } from '../types'

type DeliveryFilter = '' | 'ready' | 'delivered' | 'viewed'

function reportCaseId(c: VetCase): string {
  return c.backendCaseId || c.id
}


export default function ReportList() {
  const { cases, role, session, user, refreshBackendCases, removeCase, hydrateBackendCase, pushToast } =
    useApp()
  const { t, locale, intlLocale } = useLocale()
  const nav = useLocalizedNavigate()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [species, setSpecies] = useState('')
  const [modality, setModality] = useState<BackendModality | ''>('')
  const [region, setRegion] = useState('')
  const [delivery, setDelivery] = useState<DeliveryFilter>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<VetCase | null>(null)
  const [pendingBulk, setPendingBulk] = useState<VetCase[] | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingRevise, setPendingRevise] = useState<VetCase | null>(null)
  const [reviseNote, setReviseNote] = useState('')
  const [revising, setRevising] = useState(false)
  const [bulkPdfBusy, setBulkPdfBusy] = useState(false)

  const canBulkDelete = role === 'expert' || role === 'vet' || role === 'admin' || role === 'owner'
  const canSelect = canBulkDelete

  useEffect(() => {
    let cancelled = false
    void refreshBackendCases().then((r) => {
      if (cancelled) return
      setLoadError(r.ok ? null : t('reports.loadFailedHint'))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [refreshBackendCases, t])

  const reports = useMemo(
    () =>
      cases.filter(
        (c) =>
          c.status === 'onaylandi' &&
          (role !== 'owner' ||
            caseBelongsToOwner(c, { email: session?.email ?? user?.email, name: user?.name })),
      ),
    [cases, role, session?.email, user?.email, user?.name],
  )

  const regions = useMemo(() => {
    const set = new Set<string>()
    for (const c of reports) {
      const r = (c.anatomicalRegion || '').trim()
      if (r) set.add(r)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, intlLocale))
  }, [reports, intlLocale])

  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase(intlLocale)
    return reports.filter((c) => {
      if (species && c.patient.species !== species) return false
      if (modality && c.modality !== modality) return false
      if (region && (c.anatomicalRegion || '') !== region) return false
      if (delivery === 'viewed' && !c.reportViewedAt) return false
      if (delivery === 'delivered' && !c.reportDeliveredAt) return false
      if (delivery === 'ready' && (c.reportViewedAt || c.reportDeliveredAt)) return false
      if (!s) return true
      return [
        c.no,
        c.reportNo,
        c.patient.name,
        c.patient.breed,
        c.patient.species,
        c.modality,
        c.anatomicalRegion,
        c.clinic,
        c.approvedBy,
        c.module,
      ]
        .filter(Boolean)
        .some((f) => String(f).toLocaleLowerCase(intlLocale).includes(s))
    })
  }, [reports, q, species, modality, region, delivery, intlLocale])

  const filteredIds = useMemo(() => filtered.map((c) => c.id), [filtered])

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => filteredIds.includes(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filteredIds])

  const selectedCases = useMemo(
    () => filtered.filter((c) => selected.has(c.id)),
    [filtered, selected],
  )
  const allSelected = filtered.length > 0 && selectedCases.length === filtered.length

  const clearFilters = () => {
    setQ('')
    setSpecies('')
    setModality('')
    setRegion('')
    setDelivery('')
  }

  const hasFilters = Boolean(q.trim() || species || modality || region || delivery)

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(filteredIds))
  }

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return
    const target = pendingDelete
    setDeleting(true)
    try {
      await deleteBackendCase(reportCaseId(target))
      removeCase(target.id)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(target.id)
        return next
      })
      setPendingDelete(null)
      pushToast({
        tone: 'success',
        title: t('reports.deleted'),
        body: `${target.patient.name} · ${target.reportNo ?? target.no}`,
      })
    } catch (err) {
      pushToast({
        tone: 'error',
        title: t('review.deleteFailed'),
        body: toastErrorBody(err, t),
      })
    } finally {
      setDeleting(false)
    }
  }

  const confirmBulkDelete = async () => {
    if (!pendingBulk?.length || deleting) return
    const targets = pendingBulk
    setDeleting(true)
    let ok = 0
    const failures: string[] = []
    try {
      for (const target of targets) {
        try {
          await deleteBackendCase(reportCaseId(target))
          removeCase(target.id)
          ok += 1
        } catch (err) {
          failures.push(`${target.reportNo ?? target.no}: ${err instanceof Error ? err.message : 'hata'}`)
        }
      }
      setPendingBulk(null)
      setSelected(new Set())
      if (ok > 0) {
        pushToast({
          tone: failures.length ? 'warning' : 'success',
          title: t('reports.bulkDeleted', { count: ok }),
          body: failures.length ? t('reports.bulkDeletePartial', { count: failures.length }) : undefined,
        })
      } else {
        pushToast({
          tone: 'error',
          title: t('reports.bulkDeleteNone'),
          body: failures[0],
        })
      }
    } finally {
      setDeleting(false)
    }
  }

  const downloadSelectedPdfs = async () => {
    if (!selectedCases.length || bulkPdfBusy) return
    setBulkPdfBusy(true)
    let ok = 0
    const failures: string[] = []
    try {
      for (const target of selectedCases) {
        const caseKey = reportCaseId(target)
        try {
          if (!caseKey.startsWith('case-')) {
            failures.push(`${target.reportNo ?? target.no}: PDF yok`)
            continue
          }
          const version = target.currentReportVersion
          const blob = await downloadApprovedReportPdf(
            caseKey,
            version && Number.isFinite(version) ? version : undefined,
          )
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `vetmind-${target.reportNo ?? target.no ?? caseKey}.pdf`
          a.click()
          URL.revokeObjectURL(url)
          ok += 1
          // Browsers often block back-to-back downloads without a short gap.
          await new Promise((r) => setTimeout(r, 350))
        } catch (err) {
          failures.push(
            `${target.reportNo ?? target.no}: ${err instanceof Error ? err.message : 'hata'}`,
          )
        }
      }
      if (ok > 0) {
        pushToast({
          tone: failures.length ? 'warning' : 'success',
          title: t('reports.bulkPdfDone', { count: ok }),
          body: failures.length ? t('reports.bulkPdfPartial', { count: failures.length }) : undefined,
        })
      } else {
        pushToast({
          tone: 'error',
          title: t('reports.bulkPdfNone'),
          body: failures[0],
        })
      }
    } finally {
      setBulkPdfBusy(false)
    }
  }

  const confirmRevise = async () => {
    if (!pendingRevise || revising) return
    const note = reviseNote.trim()
    if (note.length < 10) {
      pushToast({ tone: 'warning', title: t('reports.reasonRequired'), body: t('reports.reasonMinBody') })
      return
    }
    const target = pendingRevise
    setRevising(true)
    try {
      await submitBackendReview(target.id, {
        action: 'request_revision',
        comment: note,
        reason_codes: ['report_quality'],
      })
      await hydrateBackendCase(target.id)
      setPendingRevise(null)
      setReviseNote('')
      pushToast({
        tone: 'success',
        title: t('reports.revisionOpened'),
        body: t('reports.revisionOpenedBody', { name: target.patient.name }),
      })
      nav(`/vakalar/${target.id}/calisma`)
    } catch (err) {
      pushToast({
        tone: 'error',
        title: t('reports.revisionFailed'),
        body: toastErrorBody(err, t),
      })
    } finally {
      setRevising(false)
    }
  }

  const pageTitle = role === 'owner' ? t('reports.myReports') : t('reports.approved')
  const filterClass =
    'rounded-xl border-0 bg-white/90 px-3 py-2.5 text-xs font-medium text-navy-900 outline-none ring-1 ring-white/50 focus:ring-2 focus:ring-white'

  return (
    <>
      <div className="vm-fade-up relative -mx-1 space-y-4">
        {/* Energetic hero band */}
        <section className="relative overflow-hidden rounded-[1.5rem] bg-[color:var(--vm-midnight,#0b1728)] px-5 py-6 text-white shadow-[0_20px_50px_-28px_rgba(11,23,40,0.55)] sm:px-7">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(52,211,153,0.35),transparent_50%),radial-gradient(ellipse_at_100%_80%,rgba(45,212,191,0.2),transparent_45%)]"
          />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/90">
                {t('reports.showingCount', { shown: filtered.length, total: reports.length })}
              </p>
              <h1 className="mt-1 font-[family-name:var(--vm-font-display)] text-3xl font-semibold tracking-tight sm:text-4xl">
                {pageTitle}
              </h1>
              <p className="mt-1.5 max-w-md text-sm text-slate-300">{t('reports.listSubtitle')}</p>
            </div>
            <div className="flex w-full max-w-xl flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">{t('reports.searchAria')}</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-200/70"
                  aria-hidden
                />
                <input
                  className="w-full rounded-xl border-0 bg-white/10 py-2.5 pl-9 pr-3 text-sm text-white outline-none ring-1 ring-white/20 placeholder:text-slate-400 focus:bg-white/15 focus:ring-2 focus:ring-emerald-300/50"
                  placeholder={t('reports.searchPlaceholder')}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="shrink-0 rounded-xl bg-white/10 px-3 py-2.5 text-xs font-semibold text-emerald-100 ring-1 ring-white/20 transition hover:bg-white/20"
                >
                  {t('common.clear')}
                </button>
              ) : null}
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap gap-2">
            <select
              aria-label={t('reports.filterCategory')}
              className={filterClass}
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              <option value="">{t('reports.filterAllCategories')}</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {regionLabel(t, r)}
                </option>
              ))}
            </select>
            <select
              aria-label={t('reports.filterModality')}
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
              aria-label={t('reports.filterSpecies')}
              className={filterClass}
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
            >
              <option value="">{t('cases.filterAllSpecies')}</option>
              <option value="Köpek">{t('species.dog')}</option>
              <option value="Kedi">{t('species.cat')}</option>
            </select>
            <select
              aria-label={t('reports.filterDelivery')}
              className={filterClass}
              value={delivery}
              onChange={(e) => setDelivery(e.target.value as DeliveryFilter)}
            >
              <option value="">{t('common.all')}</option>
              <option value="ready">{t('reports.doc.ready')}</option>
              <option value="delivered">{t('reports.doc.delivered')}</option>
              <option value="viewed">{t('reports.doc.viewed')}</option>
            </select>
          </div>
        </section>

        <div className="relative overflow-hidden rounded-[1.5rem] bg-white ring-1 ring-slate-200/70">
          {canSelect && selectedCases.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-100 bg-teal-50/80 px-4 py-2.5 sm:px-5">
              <p className="text-xs font-semibold text-teal-950">
                {t('reports.bulkSelected', { count: selectedCases.length })}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
                  onClick={() => setSelected(new Set())}
                  disabled={bulkPdfBusy}
                >
                  {t('common.clear')}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-800 disabled:opacity-60"
                  onClick={() => void downloadSelectedPdfs()}
                  disabled={bulkPdfBusy}
                >
                  {bulkPdfBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Download className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {bulkPdfBusy ? t('reports.bulkPdfBusy') : t('reports.downloadSelectedPdf')}
                </button>
                {canBulkDelete ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-60"
                    onClick={() => setPendingBulk(selectedCases)}
                    disabled={bulkPdfBusy}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    {t('reports.deleteSelected')}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {loading && !reports.length ? (
            <EmptyState icon={<Loader2 className="h-6 w-6 animate-spin" />} title={t('reports.loading')} />
          ) : loadError && !reports.length ? (
            <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title={t('reports.loadFailed')} text={loadError} />
          ) : filtered.length ? (
            <ul className="divide-y divide-slate-100">
              {canSelect ? (
                <li className="flex items-center gap-3 bg-slate-50/70 px-4 py-2.5 sm:px-5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t('reports.selectAllAria')}
                  />
                  <span className="text-xs font-medium text-slate-500">{t('reports.selectAll')}</span>
                </li>
              ) : null}
              {filtered.map((c) => {
                const version = c.currentReportVersion ?? c.reportVersionCount ?? 1
                const revised = version > 1 || (c.reportVersionCount ?? 0) > 1
                const deliveryLabel = c.reportViewedAt
                  ? t('reports.viewed')
                  : c.reportDeliveredAt
                    ? t('reports.delivered')
                    : null
                return (
                  <li key={c.id}>
                    <div className="flex items-stretch gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
                      {canSelect ? (
                        <div className="flex items-center pl-1">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                            checked={selected.has(c.id)}
                            onChange={() => toggleOne(c.id)}
                            aria-label={t('reports.selectRowAria', { name: c.patient.name })}
                          />
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => nav(`/raporlar/${c.id}`)}
                        className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-2 text-left transition hover:bg-emerald-50/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
                      >
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-md shadow-emerald-700/20">
                          <FileCheck2 className="h-5 w-5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-[family-name:var(--vm-font-display)] text-base font-semibold text-navy-950">
                              {c.patient.name}
                            </span>
                            <SpeciesIcon species={c.patient.species} />
                            {revised ? (
                              <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-800">
                                v{version}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {c.modality ? (
                              <span className="rounded-md bg-navy-950 px-2 py-0.5 text-[11px] font-bold text-white">
                                {c.modality}
                              </span>
                            ) : null}
                            {c.anatomicalRegion ? (
                              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
                                {regionLabel(t, c.anatomicalRegion)}
                              </span>
                            ) : null}
                            <span className="font-mono text-[11px] text-slate-400">{c.reportNo ?? c.no}</span>
                            {(c.approvedAt || c.reportAvailableAt) && (
                              <span className="text-[11px] text-slate-500">
                                {fmtDate(c.approvedAt ?? c.reportAvailableAt, locale)}
                              </span>
                            )}
                            {deliveryLabel ? (
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                {deliveryLabel}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-teal-700 sm:inline-flex">
                          {t('reports.openReport')}
                          <FileText className="h-3.5 w-3.5 opacity-70 transition group-hover:translate-x-0.5" aria-hidden />
                        </span>
                      </button>
                      <div className="flex shrink-0 items-center gap-1 pr-1">
                        {role === 'expert' && (
                          <button
                            type="button"
                            className="rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-navy-900"
                            onClick={() => {
                              setReviseNote('')
                              setPendingRevise(c)
                            }}
                          >
                            {t('reports.revise')}
                          </button>
                        )}
                        {canBulkDelete ? (
                          <button
                            type="button"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => setPendingDelete(c)}
                            aria-label={t('reports.deleteReportAria', { name: c.patient.name })}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : reports.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-6 w-6" />}
              title={t('reports.emptyApproved')}
              text={role === 'owner' ? t('reports.emptyOwnerHint') : t('reports.emptyStaffHint')}
              action={
                role === 'vet' ? (
                  <Button size="sm" onClick={() => nav('/vakalar/yeni')}>
                    {t('reports.createCase')}
                  </Button>
                ) : role === 'expert' ? (
                  <Button size="sm" onClick={() => nav('/kuyruk')}>
                    {t('dashboard.expertGoWorklist')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title={t('reports.emptyFiltered')}
              text={t('reports.emptyFilteredHint')}
              action={
                <Button size="sm" variant="secondary" onClick={clearFilters}>
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
        title={t('reports.deleteTitle')}
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
              {deleting ? t('review.deleting') : t('review.confirmDelete')}
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>{t('reports.deleteConfirm', { name: pendingDelete.patient.name })}</p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
              {pendingDelete.reportNo ?? pendingDelete.no} · {pendingDelete.id}
            </p>
            <p className="text-xs text-rose-700">{t('review.irreversible')}</p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(pendingBulk?.length)}
        onClose={() => {
          if (!deleting) setPendingBulk(null)
        }}
        title={t('reports.bulkDeleteTitle')}
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={deleting} onClick={() => setPendingBulk(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleting}
              icon={deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              onClick={() => void confirmBulkDelete()}
            >
              {deleting
                ? t('review.deleting')
                : t('reports.bulkDeleteConfirmBtn', { count: pendingBulk?.length ?? 0 })}
            </Button>
          </>
        }
      >
        {pendingBulk?.length ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>{t('reports.bulkDeleteConfirm', { count: pendingBulk.length })}</p>
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
              {pendingBulk.slice(0, 12).map((c) => (
                <li key={c.id}>
                  {c.reportNo ?? c.no} · {c.patient.name}
                </li>
              ))}
              {pendingBulk.length > 12 ? (
                <li>… +{pendingBulk.length - 12}</li>
              ) : null}
            </ul>
            <p className="text-xs text-rose-700">{t('review.irreversible')}</p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(pendingRevise)}
        onClose={() => {
          if (!revising) setPendingRevise(null)
        }}
        title={t('reports.reviseTitle')}
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={revising} onClick={() => setPendingRevise(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={revising || reviseNote.trim().length < 10}
              icon={revising ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              onClick={() => void confirmRevise()}
            >
              {revising ? t('reports.opening') : t('reports.openNewVersion')}
            </Button>
          </>
        }
      >
        {pendingRevise ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>{t('reports.reviseBody', { name: pendingRevise.patient.name })}</p>
            <label className="block">
              <span className="label">{t('reports.reviseReasonLabel')}</span>
              <textarea
                data-autofocus
                className="input mt-1 min-h-[96px]"
                placeholder={t('reports.reviseReasonPlaceholder')}
                value={reviseNote}
                onChange={(e) => setReviseNote(e.target.value)}
                disabled={revising}
              />
            </label>
            <p
              className={`text-xs ${reviseNote.trim().length < 10 ? 'font-medium text-amber-700' : 'text-slate-500'}`}
            >
              {reviseNote.trim().length < 10
                ? t('reports.reviseMinChars', { current: reviseNote.trim().length })
                : t('reports.reviseReady', { count: reviseNote.trim().length })}
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
