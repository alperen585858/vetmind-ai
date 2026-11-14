import { useEffect, useMemo, useState } from 'react'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import {
  AlertTriangle,
  FileCheck2,
  FileText,
  Loader2,
  Search,
  Send,
  Trash2,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { SpeciesIcon } from '../components/CaseTable'
import { deleteBackendCase, submitBackendReview } from '../lib/backend'
import { caseBelongsToOwner } from '../lib/caseMapper'
import { fmtDate } from '../lib/format'
import type { BackendModality, VetCase } from '../types'

type DeliveryFilter = '' | 'ready' | 'delivered' | 'viewed'

function reportCaseId(c: VetCase): string {
  return c.backendCaseId || c.id
}

function regionLabel(region: string): string {
  if (region === 'BRAIN') return 'Beyin'
  if (region === 'CERVICAL') return 'Servikal'
  if (region === 'THORAX') return 'Toraks'
  if (region === 'OTHER') return 'Diğer'
  if (region === 'UNKNOWN') return 'Bilinmiyor'
  return region
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

  const canBulkDelete = role === 'expert' || role === 'vet' || role === 'admin' || role === 'owner'

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
        body: err instanceof Error ? err.message : 'Sunucu hatası',
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
        body: err instanceof Error ? err.message : 'Sunucu hatası',
      })
    } finally {
      setRevising(false)
    }
  }

  return (
    <>
      <PageHeader
        title={role === 'owner' ? t('reports.myReports') : t('reports.approved')}
        subtitle={t('reports.listSubtitle')}
        crumbs={[
          { label: t('nav.dashboard'), to: '/' },
          { label: role === 'owner' ? t('reports.myReports') : t('reports.approved') },
        ]}
      />
      <Card>
        <div className="border-b border-slate-100 px-4 pb-1 pt-4 sm:px-5">
          <h2 className="text-sm font-semibold text-navy-900">{t('reports.listHeading')}</h2>
          <p className="text-xs text-slate-500">
            {t('reports.showingCount', { shown: filtered.length, total: reports.length })}
          </p>
        </div>

        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-end sm:px-5">
          <label className="relative block flex-1">
            <span className="sr-only">{t('reports.searchAria')}</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              className="input pl-9"
              placeholder={t('reports.searchPlaceholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <label className="block lg:w-36">
            <span className="label">{t('reports.filterCategory')}</span>
            <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">{t('reports.filterAllCategories')}</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {regionLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="block lg:w-28">
            <span className="label">{t('reports.filterModality')}</span>
            <select
              className="input"
              value={modality}
              onChange={(e) => setModality(e.target.value as BackendModality | '')}
            >
              <option value="">{t('common.all')}</option>
              <option value="MR">MR</option>
              <option value="CT">CT</option>
              <option value="XR">XR</option>
            </select>
          </label>
          <label className="block lg:w-32">
            <span className="label">{t('reports.filterSpecies')}</span>
            <select className="input" value={species} onChange={(e) => setSpecies(e.target.value)}>
              <option value="">{t('cases.filterAllSpecies')}</option>
              <option>Köpek</option>
              <option>Kedi</option>
            </select>
          </label>
          <label className="block lg:w-36">
            <span className="label">{t('reports.filterDelivery')}</span>
            <select
              className="input"
              value={delivery}
              onChange={(e) => setDelivery(e.target.value as DeliveryFilter)}
            >
              <option value="">{t('common.all')}</option>
              <option value="ready">{t('reports.doc.ready')}</option>
              <option value="delivered">{t('reports.doc.delivered')}</option>
              <option value="viewed">{t('reports.doc.viewed')}</option>
            </select>
          </label>
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              {t('common.clear')}
            </Button>
          ) : null}
        </div>

        {canBulkDelete && selectedCases.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-rose-50/60 px-4 py-2.5 sm:px-5">
            <p className="text-xs font-medium text-rose-900">
              {t('reports.bulkSelected', { count: selectedCases.length })}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
                onClick={() => setSelected(new Set())}
              >
                {t('common.clear')}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800"
                onClick={() => setPendingBulk(selectedCases)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {t('reports.deleteSelected')}
              </button>
            </div>
          </div>
        ) : null}

        {loading && !reports.length ? (
          <EmptyState icon={<Loader2 className="h-6 w-6 animate-spin" />} title={t('reports.loading')} />
        ) : loadError && !reports.length ? (
          <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title={t('reports.loadFailed')} text={loadError} />
        ) : filtered.length ? (
          <ul className="divide-y divide-slate-100">
            {canBulkDelete ? (
              <li className="flex items-center gap-3 bg-slate-50/80 px-5 py-2">
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
              return (
                <li key={c.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  {canBulkDelete ? (
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                      aria-label={t('reports.selectRowAria', { name: c.patient.name })}
                    />
                  ) : null}
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                      revised ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    <FileCheck2 className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-navy-900">
                      <SpeciesIcon species={c.patient.species} /> {c.patient.name} —{' '}
                      {t('reports.radiologyReportTitle')}
                      {revised ? (
                        <span className="inline-flex items-center rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 ring-1 ring-inset ring-violet-200">
                          {t('reports.revisedBadge', { version })}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
                          v{version}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {c.reportNo ?? c.no}
                      {c.modality || c.anatomicalRegion
                        ? ` · ${[c.modality, c.anatomicalRegion ? regionLabel(c.anatomicalRegion) : null]
                            .filter(Boolean)
                            .join(' · ')}`
                        : ''}
                      {c.approvedBy ? ` · ${t('reports.approvedBy', { name: c.approvedBy })}` : ''}
                      {c.approvedAt || c.reportAvailableAt
                        ? ` · ${fmtDate(c.approvedAt ?? c.reportAvailableAt, locale)}`
                        : ''}
                      {c.reportViewedAt
                        ? ` · ${t('reports.viewed')}`
                        : c.reportDeliveredAt
                          ? ` · ${t('reports.delivered')}`
                          : ''}
                      {revised ? ` · ${t('reports.priorVersionLocked')}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      icon={<FileText className="h-4 w-4" />}
                      onClick={() => nav(`/raporlar/${c.id}`)}
                    >
                      {t('reports.openReport')}
                    </Button>
                    {role === 'expert' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Send className="h-4 w-4" />}
                        onClick={() => {
                          setReviseNote('')
                          setPendingRevise(c)
                        }}
                      >
                        {t('reports.revise')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-700 hover:bg-rose-50"
                      icon={<Trash2 className="h-4 w-4" />}
                      onClick={() => setPendingDelete(c)}
                      aria-label={t('reports.deleteReportAria', { name: c.patient.name })}
                    >
                      {t('common.delete')}
                    </Button>
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
      </Card>

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
