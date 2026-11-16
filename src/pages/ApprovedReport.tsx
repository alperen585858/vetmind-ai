import { useEffect, useMemo, useRef, useState } from 'react'
import { modalityLabel, regionLabel } from '../lib/displayClean'
import { toastErrorBody } from '../lib/apiErrors'
import { useParams, useSearchParams } from 'react-router-dom'
import { LocalizedLink } from '../components/LocalizedLink'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  Phone,
  Send,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { Logo } from '../components/Logo'
import { ApprovedReportFigures } from '../components/ApprovedReportFigures'
import { ReportRevisionSimple } from '../components/ReportRevisionSimple'
import {
  createCaseInfoRequest,
  downloadApprovedReportPdf,
  getBackendCase,
  getReportVersion,
  listReportVersions,
  markReportDelivered,
  markReportViewed,
  replyCaseInfoRequest,
  submitBackendReview,
} from '../lib/backend'
import { fmtDate } from '../lib/format'
import {
  canExportApprovedReport,
  caseWithDraftVersion,
  printSectionsForCase,
} from '../lib/reportPrint'
import type {
  BackendDraftReport,
  BackendInfoRequest,
  BackendReportVersionSummary,
  VetCase,
} from '../types'

export default function ApprovedReport() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const versionParam = params.get('version')
  const selectedVersion = versionParam ? Number(versionParam) : null
  const { getCase, role, user, hydrateBackendCase, pushToast, updateCase } = useApp()
  const { t, locale } = useLocale()
  const nav = useLocalizedNavigate()
  const base = getCase(id)
  const [loading, setLoading] = useState(() => id.startsWith('case-') && !canExportApprovedReport(base))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [versionDraft, setVersionDraft] = useState<BackendDraftReport | null>(null)
  const [versionList, setVersionList] = useState<BackendReportVersionSummary[]>([])
  const [pdfBusy, setPdfBusy] = useState(false)
  const [reviseOpen, setReviseOpen] = useState(false)
  const [reviseNote, setReviseNote] = useState('')
  const [revising, setRevising] = useState(false)
  const [versionSwitching, setVersionSwitching] = useState(false)
  const [deliverBusy, setDeliverBusy] = useState(false)
  const [expertAsk, setExpertAsk] = useState('')
  const [expertAskBusy, setExpertAskBusy] = useState(false)
  const [infoRequests, setInfoRequests] = useState<BackendInfoRequest[]>([])
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({})
  const viewedRef = useRef<string | null>(null)

  const isVetStaff = role === 'vet' || role === 'clinic_owner'
  const canAskExpert = isVetStaff && id.startsWith('case-')
  const canReplyAsExpert = role === 'expert' && id.startsWith('case-')

  const refreshInfoRequests = async () => {
    if (!id.startsWith('case-')) return
    try {
      const rec = await getBackendCase(id)
      setInfoRequests(rec.info_requests || [])
    } catch {
      /* keep prior */
    }
  }

  // Load case + version list once per case id (do NOT depend on hydrate fields — that caused a flash loop).
  useEffect(() => {
    if (!id.startsWith('case-')) {
      setLoading(false)
      setLoadError(null)
      setVersionDraft(null)
      setVersionList([])
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void (async () => {
      // Always re-fetch after approve navigation so we don't flash "not approved yet"
      // from a stale in-memory case row.
      const mapped = await hydrateBackendCase(id)
      if (cancelled) return
      if (!mapped) {
        setLoadError(t('reports.loadFailedHint'))
        setLoading(false)
        return
      }
      try {
        const versions = await listReportVersions(id)
        if (!cancelled) setVersionList(versions)
      } catch {
        if (!cancelled) setVersionList(mapped.reportVersions ?? [])
      }
      if (!cancelled) setLoading(false)
      if (mapped.status === 'onaylandi' && mapped.fromBackend && viewedRef.current !== id) {
        viewedRef.current = id
        void markReportViewed(id).catch(() => undefined)
      }
      if (!cancelled) {
        void getBackendCase(id)
          .then((rec) => {
            if (!cancelled) setInfoRequests(rec.info_requests || [])
          })
          .catch(() => {
            if (!cancelled) setInfoRequests([])
          })
      }
    })()
    return () => {
      cancelled = true
    }
    // intentionally only re-run when navigating to another case
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hydrateBackendCase])

  // Soft-switch printable body when ?version= changes — keep old text until new arrives (no flash).
  useEffect(() => {
    if (!id.startsWith('case-')) {
      setVersionDraft(null)
      return
    }
    if (selectedVersion == null || Number.isNaN(selectedVersion)) {
      setVersionDraft(null)
      setVersionSwitching(false)
      return
    }
    let cancelled = false
    setVersionSwitching(true)
    void getReportVersion(id, selectedVersion)
      .then((snap) => {
        if (!cancelled) setVersionDraft(snap.content)
      })
      .catch((err) => {
        if (cancelled) return
        pushToast({
          tone: 'error',
          title: t('reports.versionLoadFailed'),
          body: toastErrorBody(err, t),
        })
      })
      .finally(() => {
        if (!cancelled) setVersionSwitching(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, selectedVersion, pushToast])

  const c: VetCase | undefined = useMemo(() => {
    if (!base) return undefined
    if (versionDraft) return caseWithDraftVersion(base, versionDraft)
    return base
  }, [base, versionDraft])

  const downloadServerPdf = async () => {
    const caseKey = c?.backendCaseId || c?.id || id
    if (!caseKey.startsWith('case-')) {
      window.print()
      return
    }
    setPdfBusy(true)
    try {
      const blob = await downloadApprovedReportPdf(
        caseKey,
        selectedVersion && Number.isFinite(selectedVersion) ? selectedVersion : undefined,
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vetmind-${caseKey}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      pushToast({
        tone: 'error',
        title: t('reports.pdfFailed'),
        body: toastErrorBody(e, t),
      })
    } finally {
      setPdfBusy(false)
    }
  }

  const openRevision = async () => {
    const caseKey = c?.backendCaseId || c?.id || id
    if (!caseKey.startsWith('case-') || revising) return
    const note = reviseNote.trim()
    if (note.length < 10) {
      pushToast({ tone: 'warning', title: t('reports.reasonRequired'), body: t('reports.reasonMinTen') })
      return
    }
    setRevising(true)
    try {
      await submitBackendReview(caseKey, {
        action: 'request_revision',
        comment: note,
        reason_codes: ['report_quality'],
      })
      await hydrateBackendCase(caseKey)
      setReviseOpen(false)
      setReviseNote('')
      pushToast({
        tone: 'success',
        title: t('reports.revisionOpened'),
        body: t('reports.revisionOpenedBody'),
      })
      nav(`/vakalar/${caseKey}/calisma`)
    } catch (e) {
      pushToast({
        tone: 'error',
        title: t('reports.revisionFailed'),
        body: toastErrorBody(e, t),
      })
    } finally {
      setRevising(false)
    }
  }

  if (loading) {
    return (
      <Card className="flex items-center gap-3 p-6 text-sm text-slate-600">
        <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
        {t('reports.loadingApproved')}
      </Card>
    )
  }

  if (loadError && !c) {
    return (
      <Card>
        <EmptyState
          icon={<AlertCircle className="h-6 w-6" />}
          title={t('reports.loadFailed')}
          text={loadError}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setLoading(true)
                void hydrateBackendCase(id).then((mapped) => {
                  if (!mapped) {
                    setLoadError(
                      t('reports.doc.loadFailed'),
                    )
                  } else {
                    setLoadError(null)
                  }
                  setLoading(false)
                })
              }}
            >
              {t('common.retry')}
            </Button>
          }
        />
      </Card>
    )
  }

  // Seed owner gate: match owner name. Backend cases rely on route Gate roles.
  if (
    !c ||
    (role === 'owner' &&
      !c.fromBackend &&
      c.patient.ownerName !== user?.name &&
      c.petOwnerSubject !== user?.email)
  ) {
    return <Card><EmptyState icon={<FileText className="h-6 w-6" />} title={t('reports.empty')} /></Card>
  }

  if (c.status !== 'onaylandi' || !canExportApprovedReport(c)) {
    return (
      <Card>
        <EmptyState
          icon={<Clock className="h-6 w-6" />}
          title={t('reports.notApprovedYet')}
          text={loadError || t('reports.notApprovedHint')}
          action={<LocalizedLink to="/" className="text-sm font-medium text-teal-700">{t('reports.backHome')}</LocalizedLink>}
        />
      </Card>
    )
  }

  const p = c.patient
  const sections = printSectionsForCase(c)
  const showDemoPatientExtras = !c.fromBackend
  const versions =
    versionList.length > 0
      ? versionList
      : c.reportVersions ?? []
  const sortedVersions = [...versions].sort((a, b) => a.version - b.version)
  const hasRevisionHistory = sortedVersions.length > 1
  const currentVer =
    selectedVersion && Number.isFinite(selectedVersion)
      ? selectedVersion
      : c.currentReportVersion ?? sortedVersions[sortedVersions.length - 1]?.version ?? 1
  const reviewStatus =
    c.status === 'onaylandi'
      ? `${t('reports.statusApproved')}${c.approvedBy ? ` · ${c.approvedBy}` : ''}`
      : c.status === 'reddedildi'
        ? t('reports.statusRejected')
        : c.status === 'revizyon'
          ? t('reports.statusRevision')
          : c.backendDraft?.status || c.status

  const selectVersion = (v: number) => {
    const next = new URLSearchParams(params)
    next.set('version', String(v))
    setParams(next, { replace: true })
  }

  const canMarkDelivered =
    c.fromBackend &&
    id.startsWith('case-') &&
    !c.reportDeliveredAt &&
    (role === 'expert' || role === 'vet' || role === 'clinic_owner' || role === 'admin')

  const onMarkDelivered = () => {
    if (!canMarkDelivered || deliverBusy) return
    setDeliverBusy(true)
    void markReportDelivered(id)
      .then(async () => {
        const mapped = await hydrateBackendCase(id)
        if (mapped) updateCase(mapped.id, mapped)
        pushToast({
          tone: 'success',
          title: t('reports.deliveredToastTitle'),
          body: t('reports.deliveredToastBody'),
        })
      })
      .catch((err) => {
        pushToast({
          tone: 'error',
          title: t('reports.deliverFailed'),
          body: toastErrorBody(err, t),
        })
      })
      .finally(() => setDeliverBusy(false))
  }

  const sendExpertQuestion = () => {
    if (!canAskExpert || !expertAsk.trim() || expertAskBusy) return
    setExpertAskBusy(true)
    void createCaseInfoRequest(id, { body: expertAsk.trim(), to_role: 'expert' })
      .then(async () => {
        setExpertAsk('')
        pushToast({ tone: 'info', title: t('cases.detail.toastExpertQuestionSent') })
        await refreshInfoRequests()
      })
      .catch((err) => {
        pushToast({
          tone: 'error',
          title: t('cases.detail.toastRequestFailed'),
          body: toastErrorBody(err, t),
        })
      })
      .finally(() => setExpertAskBusy(false))
  }

  const replyExpertQuestion = (requestId: string) => {
    const reply = (replyDraft[requestId] || '').trim()
    if (!reply || expertAskBusy) return
    setExpertAskBusy(true)
    void replyCaseInfoRequest(id, requestId, reply)
      .then(async () => {
        setReplyDraft((prev) => {
          const next = { ...prev }
          delete next[requestId]
          return next
        })
        pushToast({ tone: 'success', title: t('cases.detail.toastReplySaved') })
        await refreshInfoRequests()
      })
      .catch((err) => {
        pushToast({
          tone: 'error',
          title: t('cases.detail.toastReplyFailed'),
          body: toastErrorBody(err, t),
        })
      })
      .finally(() => setExpertAskBusy(false))
  }

  const statusLabel = (status: string) => {
    if (status === 'OPEN') return t('cases.detail.statusOpen')
    if (status === 'ANSWERED') return t('cases.detail.statusAnswered')
    if (status === 'CLOSED') return t('cases.detail.statusClosed')
    return status
  }
  const roleLabel = (r: string) => {
    if (r === 'expert') return t('cases.detail.roleExpert')
    if (r === 'vet' || r === 'clinic_owner') return t('cases.detail.roleVet')
    if (r === 'owner') return t('cases.detail.roleOwner')
    return r
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print">
        <PageHeader
          title={t('reports.approvedTitle')}
          subtitle={`${c.patient.name} · ${c.no}`}
          crumbs={[
            { label: role === 'owner' ? t('nav.myReports') : t('nav.cases'), to: role === 'owner' ? '/raporlar' : '/vakalar' },
            { label: c.no, to: `/vakalar/${c.id}` },
            { label: t('reports.crumbReport') },
          ]}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => nav(-1)}>
                {t('common.back')}
              </Button>
              {role === 'expert' && id.startsWith('case-') && (
                <Button variant="secondary" icon={<Send className="h-4 w-4" />} onClick={() => setReviseOpen(true)}>
                  {t('reports.reviseApproved')}
                </Button>
              )}
              {canMarkDelivered ? (
                <Button
                  variant="secondary"
                  icon={<BadgeCheck className="h-4 w-4" />}
                  onClick={onMarkDelivered}
                  disabled={deliverBusy}
                >
                  {deliverBusy ? t('common.loading') : t('reports.markDelivered')}
                </Button>
              ) : null}
              {import.meta.env.MODE !== 'share' && (
                <>
                  <Button
                    icon={<Download className="h-4 w-4" />}
                    onClick={() => void downloadServerPdf()}
                    disabled={!sections.length || pdfBusy}
                  >
                    {pdfBusy ? t('reports.preparingPdf') : t('reports.downloadPdf')}
                  </Button>
                  <Button variant="secondary" onClick={() => window.print()} disabled={!sections.length}>
                    {t('reports.print')}
                  </Button>
                </>
              )}
            </div>
          }
        />
      </div>

      {loadError && (
        <div className="no-print mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {loadError}
        </div>
      )}

      {(canAskExpert || canReplyAsExpert) && (
        <Card className="no-print mb-5">
          <div className="space-y-3 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-navy-900">{t('reports.askExpertTitle')}</p>
              <p className="mt-0.5 text-xs text-slate-500">{t('reports.askExpertHint')}</p>
            </div>
            {canAskExpert && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="block flex-1 text-xs text-slate-600">
                  {t('cases.detail.askExpert')}
                  <textarea
                    className="input mt-1 min-h-[72px] text-sm"
                    value={expertAsk}
                    onChange={(e) => setExpertAsk(e.target.value)}
                    placeholder={t('reports.askExpertPlaceholder')}
                    data-testid="ask-expert-input"
                  />
                </label>
                <Button
                  size="sm"
                  disabled={expertAskBusy || !expertAsk.trim()}
                  icon={<Send className="h-4 w-4" />}
                  onClick={sendExpertQuestion}
                  data-testid="ask-expert-send"
                >
                  {t('reports.sendExpertQuestion')}
                </Button>
              </div>
            )}
            {infoRequests.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {t('reports.expertThreadTitle')}
                </p>
                <ul className="space-y-2 text-xs">
                  {infoRequests.map((r) => (
                    <li
                      key={r.request_id}
                      className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                      data-testid={`info-request-${r.request_id}`}
                    >
                      <p className="font-medium text-navy-900">
                        {t('cases.detail.requestMeta', {
                          status: statusLabel(r.status),
                          role: roleLabel(r.to_role),
                        })}
                      </p>
                      <p className="mt-0.5 text-navy-900">{r.body}</p>
                      {r.reply ? (
                        <p className="mt-1 text-teal-800" data-testid="info-request-reply">
                          {t('cases.detail.replyLabel')} {r.reply}
                        </p>
                      ) : null}
                      {r.status === 'OPEN' && canReplyAsExpert && r.to_role === 'expert' && (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <input
                            className="input flex-1 text-sm"
                            placeholder={t('cases.detail.replyPlaceholder')}
                            value={replyDraft[r.request_id] || ''}
                            onChange={(e) =>
                              setReplyDraft((prev) => ({ ...prev, [r.request_id]: e.target.value }))
                            }
                            data-testid="ask-expert-reply-input"
                          />
                          <Button
                            size="sm"
                            disabled={expertAskBusy || !(replyDraft[r.request_id] || '').trim()}
                            onClick={() => replyExpertQuestion(r.request_id)}
                            data-testid="ask-expert-reply-send"
                          >
                            {t('cases.detail.reply')}
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      {hasRevisionHistory && (
        <div className="no-print mb-5 space-y-3">
          <div className="inline-flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {sortedVersions.map((v) => {
                const active = v.version === currentVer
                const isLatest = v.version === sortedVersions[sortedVersions.length - 1]?.version
                return (
                  <button
                    key={v.version}
                    type="button"
                    onClick={() => selectVersion(v.version)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                      active ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600 hover:text-navy-900'
                    }`}
                  >
                    {isLatest ? t('reports.versionCurrent', { version: String(v.version) }) : t('reports.versionPrevious', { version: String(v.version) })}
                  </button>
                )
              })}
            </div>
            {versionSwitching ? (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </span>
            ) : null}
          </div>
          <ReportRevisionSimple caseId={id} versions={sortedVersions} />
        </div>
      )}

      {role === 'owner' && (
        <div className="no-print mb-6 rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-navy-50 p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-7 w-7 text-sky-600" />
            <h2 className="text-xl font-semibold text-navy-900">{t('reports.ownerReadyTitle')}</h2>
          </div>
          <p className="mt-3 text-[15px] leading-relaxed text-navy-800">
            {t('reports.ownerReadyBody', { name: p.name })}
            {c.approvedBy ? (
              <>
                {t('reports.ownerApprovedBy', { expert: c.approvedBy, date: fmtDate(c.approvedAt, locale) })}
              </>
            ) : (
              <>{t('reports.ownerApprovedShort')}</>
            )}
          </p>
          {c.clinic && (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <Phone className="h-4 w-4" /> {c.clinic}
            </p>
          )}
        </div>
      )}

      <article
        className={`rounded-xl border border-slate-200 bg-white shadow-soft print:border-0 print:shadow-none ${
          versionSwitching ? 'opacity-70 transition-opacity' : ''
        }`}
      >
        <header
          className={`flex flex-col gap-4 border-b-4 px-8 py-6 sm:flex-row sm:items-start sm:justify-between ${
            role === 'owner' ? 'border-sky-500' : 'border-teal-600'
          }`}
        >
          <div>
            <Logo accent={role === 'owner' ? 'sky' : 'teal'} />
          </div>
          <div className="text-left text-sm sm:text-right">
            <p className="text-lg font-semibold text-navy-900">{t('reports.reportDocTitle')}</p>
            <p className="text-slate-500">
              {t('reports.reportNo')} <span className="font-mono font-medium text-navy-800">{c.reportNo ?? t('common.dash')}</span>
            </p>
            <p className="text-slate-500">
              {t('reports.caseNo')} <span className="font-mono">{c.no}</span>
              {hasRevisionHistory ? (
                <>
                  {' '}
                  · <span className="font-semibold text-navy-800">v{currentVer}</span>
                </>
              ) : null}
            </p>
          </div>
        </header>

        <section className="grid gap-6 border-b border-slate-100 px-8 py-5 text-sm sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t('reports.doc.patientInfo')}</p>
            <dl className="space-y-1">
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">{t('reports.doc.name')}</dt>
                <dd className="font-medium text-navy-900">{p.name}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">{t('reports.doc.speciesBreed')}</dt>
                <dd className="text-navy-900">
                  {p.species} · {p.breed}
                </dd>
              </div>
              {showDemoPatientExtras && (
                <>
                  <div className="flex gap-2">
                    <dt className="w-28 text-slate-500">{t('reports.doc.sex')}</dt>
                    <dd className="text-navy-900">
                      {p.sex}, {p.neutered ? t('reports.doc.neutered') : t('reports.doc.intact')}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 text-slate-500">{t('reports.doc.ageWeight')}</dt>
                    <dd className="text-navy-900">
                      {t('reports.doc.ageWeightValue', { age: p.age, weight: p.weight })}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 text-slate-500">{t('reports.doc.owner')}</dt>
                    <dd className="text-navy-900">{p.ownerName}</dd>
                  </div>
                </>
              )}
            </dl>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t('reports.doc.studyClinic')}</p>
            <dl className="space-y-1">
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">{t('reports.doc.clinic')}</dt>
                <dd className="text-navy-900">{c.clinic || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">{t('reports.doc.modality')}</dt>
                <dd className="text-navy-900">{modalityLabel(t, c.modality) || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">{t('reports.doc.region')}</dt>
                <dd className="text-navy-900">{regionLabel(t, c.anatomicalRegion) || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">{t('reports.doc.submitted')}</dt>
                <dd className="text-navy-900">{fmtDate(c.createdAt, locale)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">{t('reports.doc.review')}</dt>
                <dd className="text-navy-900">{reviewStatus}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">{t('reports.doc.radiologist')}</dt>
                <dd className="text-navy-900">{c.approvedBy || c.backendDraft?.reviewed_by || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">{t('reports.doc.approvedAt')}</dt>
                <dd className="text-navy-900">
                  {c.approvedAt
                    ? fmtDate(c.approvedAt, locale)
                    : c.reportAvailableAt
                      ? fmtDate(c.reportAvailableAt, locale)
                      : c.backendDraft?.updated_at
                        ? fmtDate(c.backendDraft.updated_at, locale)
                        : '—'}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">{t('reports.doc.delivery')}</dt>
                <dd className="text-navy-900">
                  {c.reportViewedAt
                    ? `${t('reports.doc.viewed')} · ${fmtDate(c.reportViewedAt, locale)}`
                    : c.reportDeliveredAt
                      ? `${t('reports.doc.delivered')} · ${fmtDate(c.reportDeliveredAt, locale)}`
                      : c.reportAvailableAt
                        ? t('reports.doc.ready')
                        : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="space-y-6 px-8 py-6">
          {sections.length === 0 ? (
            <p className="text-sm text-rose-700">{t('reports.emptyBody')}</p>
          ) : (
            sections.map((s) => (
              <div key={s.key}>
                <h3
                  className={`mb-2 border-b border-slate-100 pb-1 text-sm font-semibold uppercase tracking-wide ${
                    role === 'owner' ? 'text-sky-700' : 'text-teal-700'
                  }`}
                >
                  {s.label}
                </h3>
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-navy-900">{s.text}</p>
              </div>
            ))
          )}
        </section>

        <ApprovedReportFigures
          caseId={c.backendCaseId || c.id}
          version={Number(c.backendDraft?.version ?? currentVer ?? 1)}
          figures={c.backendDraft?.evidence_figures}
          canAdd={
            Boolean(c.fromBackend) &&
            (role === 'expert' || role === 'admin') &&
            (selectedVersion == null ||
              selectedVersion === (base?.currentReportVersion ?? base?.backendDraft?.version))
          }
          onFiguresAdded={async () => {
            const mapped = await hydrateBackendCase(id)
            if (mapped) updateCase(mapped.id, mapped)
            if (selectedVersion != null && Number.isFinite(selectedVersion)) {
              try {
                const snap = await getReportVersion(id, selectedVersion)
                setVersionDraft(snap.content)
              } catch {
                /* keep prior draft */
              }
            }
            pushToast({
              tone: 'success',
              title: 'Fotoğraflar eklendi',
              body: 'Seçilen kanıt görselleri onaylı rapora eklendi. PDF’i yeniden indirin.',
            })
          }}
        />

        <footer className="border-t border-slate-200 bg-slate-50/70 px-8 py-5 print:bg-white">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-start gap-3">
              <BadgeCheck className="h-8 w-8 text-emerald-600" />
              <div className="text-sm">
                <p className="text-slate-500">{t('reports.approverLabel')}</p>
                <p className="font-semibold text-navy-900">{c.approvedBy ?? '—'}</p>
              </div>
            </div>
            <div className="text-sm sm:text-right">
              <p className="text-slate-500">{t('reports.approvalDate')}</p>
              <p className="font-semibold text-navy-900">{fmtDate(c.approvedAt, locale)}</p>
            </div>
          </div>
          <p className="mt-5 border-t border-slate-200/80 pt-4 text-[10px] font-medium text-slate-500">
            {t('reports.disclaimer')}
          </p>
          <p className="mt-2 text-[10px] text-slate-400">{t('reports.footerPartner')}</p>
        </footer>
      </article>

      <Modal
        open={reviseOpen}
        onClose={() => {
          if (!revising) setReviseOpen(false)
        }}
        title={t('reports.reviseModalTitle')}
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={revising} onClick={() => setReviseOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={revising || reviseNote.trim().length < 10}
              icon={revising ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              onClick={() => void openRevision()}
            >
              {revising ? t('reports.openingRevision') : t('reports.openNewVersion')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>{t('reports.reviseModalBody')}</p>
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
          <p className={`text-xs ${reviseNote.trim().length < 10 ? 'font-medium text-amber-700' : 'text-slate-500'}`}>
            {reviseNote.trim().length < 10
              ? t('reports.reviseMinChars', { current: String(reviseNote.trim().length) })
              : t('reports.reviseReady', { current: String(reviseNote.trim().length) })}
          </p>
        </div>
      </Modal>
    </div>
  )
}
