import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { LocalizedLink } from '../../shared/shell/LocalizedLink'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import {
  ArrowLeft,
  AlertCircle,
  BookOpen,
  Brain,
  Clock,
  FileSearch,
  FileText,
  History,
  Image as ImageIcon,
  Loader2,
  Microscope,
  Paperclip,
  Sparkles,
  Stethoscope,
  XCircle,
} from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { Card } from '../../shared/ui/Card'
import { Button } from '../../shared/ui/Button'
import { PriorityBadge, StatusBadge } from '../../shared/ui/StatusBadge'
import { EmptyState } from '../../shared/ui/EmptyState'
import { CaseWorkflowStepper } from '../../shared/ui/CaseWorkflowStepper'
import { toastErrorBody } from '../../shared/lib/apiErrors'
import { fmtDate } from '../../shared/lib/format'
import { displayClinic } from '../../shared/lib/displayClean'
import { PollingCancelledError, requestCancelAnalysisJob, resendCaseToAI } from '../../shared/api'
import {
  formatSlaRemaining,
  slaBadgeClass,
  slaHoursForPriority,
  slaLabelsFromT,
  slaTone,
} from '../../shared/lib/reviewSla'

import { Overview } from './tabs/ClinicalTab'
import { CaseCancelActions } from './CaseCancelActions'
import { Imaging } from './tabs/DicomTab'
import { AssessmentView } from './tabs/FindingsTab'
import { SourcesView } from './tabs/RagTab'
import { ReportWorkspace } from './tabs/ReportsTab'
import { Documents } from './tabs/DocumentsTab'
import { CaseHistoryPanel } from './tabs/HistoryTab'
import { PriorStudiesPanel } from '../patients/PriorStudiesPanel'
import { OwnerSummaryCard } from './OwnerSummaryCard'
export { AssessmentView }

// #73: one tab row; each tab has its own ?tab= address.
const TAB_DEFS = [
  { key: 'genel', labelKey: 'cases.detail.tabOverview', icon: <Stethoscope className="h-4 w-4" /> },
  { key: 'goruntu', labelKey: 'cases.detail.tabImaging', icon: <ImageIcon className="h-4 w-4" /> },
  { key: 'bulgular', labelKey: 'cases.detail.tabAiFindings', icon: <Brain className="h-4 w-4" /> },
  { key: 'rapor', labelKey: 'cases.detail.tabReport', icon: <FileText className="h-4 w-4" /> },
  { key: 'kaynaklar', labelKey: 'cases.detail.tabSources', icon: <BookOpen className="h-4 w-4" /> },
  { key: 'belgeler', labelKey: 'cases.detail.tabDocuments', icon: <Paperclip className="h-4 w-4" /> },
  { key: 'gecmis', labelKey: 'cases.detail.tabHistory', icon: <History className="h-4 w-4" /> },
] as const

export type CaseDetailTab = (typeof TAB_DEFS)[number]['key']

const TAB_ALIASES: Record<string, CaseDetailTab> = { imaging: 'goruntu', ai: 'bulgular', sources: 'kaynaklar' }

/** Known tabs and their aliases; anything else (e.g. the removed ?tab=mesajlar) opens the overview. */
export function normalizeCaseDetailTab(value: string | null): CaseDetailTab {
  if (!value) return 'genel'
  if (TAB_DEFS.some((d) => d.key === value)) return value as CaseDetailTab
  return TAB_ALIASES[value] ?? 'genel'
}

function DetailSkeleton({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label={loadingLabel}>
      <div className="h-10 w-2/3 rounded-lg bg-slate-100" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-48 rounded-xl bg-slate-100" />
        <div className="h-48 rounded-xl bg-slate-100" />
      </div>
      <div className="h-40 rounded-xl bg-slate-100" />
    </div>
  )
}

export default function CaseDetail() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { getCase, role, user, session, hydrateBackendCase, pushToast } = useApp()
  const { t, locale } = useLocale()
  const canControlAnalysis = role === 'vet' || role === 'expert'
  const tabs = useMemo(
    () => TAB_DEFS.map((tab) => ({ ...tab, label: t(tab.labelKey) })),
    [t],
  )
  const nav = useLocalizedNavigate()
  const c = getCase(id)
  const [loading, setLoading] = useState(() => Boolean(id.startsWith('case-') && !c))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stoppingAnalysis, setStoppingAnalysis] = useState(false)
  const [resendingAi, setResendingAi] = useState(false)
  const routeTab = params.get('tab')
  const tab = normalizeCaseDetailTab(routeTab)

  useEffect(() => {
    // Unknown or removed tab addresses (e.g. ?tab=mesajlar) are rewritten to the overview.
    if (routeTab && normalizeCaseDetailTab(routeTab) === 'genel' && routeTab !== 'genel') {
      const nextParams = new URLSearchParams(params)
      nextParams.set('tab', 'genel')
      setParams(nextParams, { replace: true })
    }
  }, [routeTab, params, setParams])

  // A new history entry per tab, so the browser back button returns to the previous tab.
  const selectTab = (nextTab: CaseDetailTab) => {
    if (nextTab === tab) return
    const nextParams = new URLSearchParams(params)
    nextParams.set('tab', nextTab)
    setParams(nextParams)
  }

  const reload = () => {
    if (!id.startsWith('case-')) return
    setLoading(true)
    setLoadError(null)
    void hydrateBackendCase(id).then((mapped) => {
      if (!mapped) {
        setLoadError(t('cases.detail.loadFailedHint'))
      }
      setLoading(false)
    })
  }

  useEffect(() => {
    if (!id.startsWith('case-')) {
      setLoading(false)
      setLoadError(null)
      return
    }
    // A list/worklist summary also has modality but no findings: only skip the fetch when the
    // detail data is already here (otherwise the AI tab stayed on "AI çalışıyor…" forever).
    // A full record loaded at the current status counts too (#116): drafts used to be skipped
    // outright to avoid refetching a record without AI output, so their history never loaded.
    // A status change (e.g. analysis finished) still fetches again.
    if (c?.fromBackend && (c.ai || c.backendFindings || c.detailLoadedStatus === c.status)) {
      setLoading(false)
      setLoadError(null)
      return
    }
    setLoading(true)
    setLoadError(null)
    let cancelled = false
    void hydrateBackendCase(id).then((mapped) => {
      if (cancelled) return
      if (!mapped && !getCase(id)) {
        setLoadError(t('cases.detail.loadFailed'))
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id, c?.fromBackend, c?.ai, c?.backendFindings, c?.status, c?.modality, hydrateBackendCase, getCase])

  if (!c && loading) {
    return (
      <Card className="p-6">
        <DetailSkeleton loadingLabel={t('cases.detail.loadingAria')} />
      </Card>
    )
  }

  if (!c) {
    return (
      <Card>
        <EmptyState
          icon={<FileSearch className="h-6 w-6" />}
          title={t('cases.detail.notFound')}
          text={loadError ?? t('cases.detail.notFoundHint')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {id.startsWith('case-') && (
                <Button size="sm" variant="secondary" onClick={reload}>
                  {t('common.retry')}
                </Button>
              )}
              <LocalizedLink className="text-sm font-medium text-teal-700" to="/vakalar">
                {t('cases.detail.backToCases')}
              </LocalizedLink>
            </div>
          }
        />
      </Card>
    )
  }

  const workflowStep =
    c.status === 'onaylandi'
      ? 4
      : c.status === 'uzman_incelemesinde' || c.status === 'revizyon' || c.status === 'manuel_inceleme' || c.status === 'reddedildi'
        ? 3
        : c.status === 'isleniyor' || c.status === 'ai_analizi' || c.status === 'analiz_basarisiz'
          ? 2
          : 1
  const workflowStatus =
    c.status === 'analiz_basarisiz' ? 'error' : c.status === 'reddedildi' ? 'reject' : undefined

  return (
    <>
      <section
        className="relative mb-5 overflow-hidden rounded-[1.5rem] bg-[color:var(--vm-midnight,#0b1728)] p-5 text-white shadow-[0_20px_50px_-28px_rgba(11,23,40,0.55)] sm:p-6"
        aria-label={t('cases.detail.patientBannerAria')}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(45,212,191,0.35),transparent_50%),radial-gradient(ellipse_at_100%_80%,rgba(20,184,166,0.18),transparent_45%)]"
        />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <LocalizedLink
              to={role === 'expert' ? '/kuyruk' : '/vakalar'}
              aria-label={role === 'expert' ? t('cases.detail.backToQueue') : t('cases.detail.backToCases')}
              title={role === 'expert' ? t('cases.detail.backToQueue') : t('cases.detail.backToCases')}
              className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden />
            </LocalizedLink>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-300/90">{t('cases.detail.patientCaseHeader')}</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-[2rem]">{c.patient.name}</h1>
            <p className="mt-1.5 text-sm text-slate-300">
              {c.patient.species} · {c.patient.breed} · {t('cases.detail.ageWeight', { age: c.patient.age, weight: c.patient.weight })} · {c.patient.sex}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              {[c.no, displayClinic(c.clinic) || null, c.module, fmtDate(c.createdAt, locale)].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} />
            <PriorityBadge priority={c.priority} />
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4 empty:hidden">
          {canControlAnalysis && (c.status === 'isleniyor' || c.status === 'ai_analizi') && (
            <>
              <Button variant="secondary" icon={<Loader2 className="h-4 w-4 animate-spin" />} onClick={() => nav(`/vakalar/${c.id}/isleme`)}>
                {t('cases.detail.watchPipeline')}
              </Button>
              {(c.backendJobId || c.backendCaseId) && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={stoppingAnalysis}
                  icon={
                    stoppingAnalysis ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )
                  }
                  onClick={() => {
                    const jobId = c.backendJobId
                    if (!jobId || stoppingAnalysis) {
                      nav(`/vakalar/${c.id}/isleme`)
                      return
                    }
                    setStoppingAnalysis(true)
                    void requestCancelAnalysisJob(jobId)
                      .then(async () => {
                        pushToast({
                          tone: 'info',
                          title: t('cases.detail.toastStoppingAnalysis'),
                          body: t('cases.detail.toastCancelSent'),
                        })
                        if (c.backendCaseId) await hydrateBackendCase(c.backendCaseId)
                        nav(`/vakalar/${c.id}/isleme`)
                      })
                      .catch((err) => {
                        pushToast({
                          tone: 'error',
                          title: t('cases.detail.toastStopFailed'),
                          body: toastErrorBody(err, t),
                        })
                      })
                      .finally(() => setStoppingAnalysis(false))
                  }}
                >
                  {stoppingAnalysis ? t('cases.detail.stopping') : t('cases.detail.stopAnalysis')}
                </Button>
              )}
            </>
          )}
          {role === 'expert' &&
            (c.status === 'uzman_incelemesinde' ||
              c.status === 'revizyon' ||
              c.status === 'manuel_inceleme' ||
              c.status === 'analiz_basarisiz') && (
            <Button icon={<Microscope className="h-4 w-4" />} onClick={() => nav(`/vakalar/${c.id}/calisma`)}>
              {c.status === 'manuel_inceleme' || c.status === 'analiz_basarisiz'
                ? t('cases.detail.manualWorkspace')
                : t('cases.detail.workspace')}
            </Button>
          )}
          {c.status === 'onaylandi' && (
            <Button variant="success" icon={<FileText className="h-4 w-4" />} onClick={() => nav(`/raporlar/${c.id}`)}>
              {t('cases.detail.viewApprovedReport')}
            </Button>
          )}
          <CaseCancelActions c={c} />
          {role === 'expert' && c.status === 'onaylandi' && (
            <Button
              variant="secondary"
              icon={<Microscope className="h-4 w-4" />}
              onClick={() => nav(`/vakalar/${c.id}/calisma`)}
            >
              {t('cases.detail.reviseWorkspace')}
            </Button>
          )}
          {role === 'expert' &&
            Boolean(c.backendCaseId || c.id.startsWith('case-')) &&
            !['isleniyor', 'ai_analizi', 'taslak'].includes(c.status) && (
              <Button
                variant="secondary"
                size="sm"
                disabled={resendingAi}
                icon={
                  resendingAi ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )
                }
                onClick={() => {
                  const caseKey = c.backendCaseId || c.id
                  if (!caseKey.startsWith('case-') || resendingAi) return
                  const openRevisionFirst = c.status === 'onaylandi'
                  setResendingAi(true)
                  void resendCaseToAI(caseKey, { openRevisionFirst, cancelBackendOnAbort: true })
                    .then(async (result) => {
                      await hydrateBackendCase(caseKey)
                      pushToast({
                        tone: result.outcome === 'failed' ? 'error' : 'success',
                        title:
                          result.outcome === 'failed'
                            ? t('cases.detail.toastResendFailed')
                            : t('cases.detail.toastResendOk'),
                        body:
                          result.outcome === 'failed'
                            ? result.job.error_message || undefined
                            : openRevisionFirst
                              ? t('cases.detail.toastResendBodyRevision')
                              : t('cases.detail.toastResendBodyDraft'),
                      })
                      nav(`/vakalar/${c.id}/isleme`)
                    })
                    .catch((err) => {
                      if (err instanceof PollingCancelledError) {
                        pushToast({ tone: 'info', title: t('cases.detail.toastAnalysisStopped') })
                        return
                      }
                      pushToast({
                        tone: 'error',
                        title: t('cases.detail.toastResendSendFailed'),
                        body: toastErrorBody(err, t),
                      })
                    })
                    .finally(() => setResendingAi(false))
                }}
              >
                {resendingAi
                  ? t('cases.detail.aiRunning')
                  : c.status === 'onaylandi'
                    ? t('cases.detail.reviseAndResendAi')
                    : t('cases.detail.resendAi')}
              </Button>
            )}
        </div>
      </section>

      <div className="mb-5">
        <CaseWorkflowStepper currentStep={workflowStep} status={workflowStatus} />
      </div>

      {c.reviewDueAt &&
        (c.status === 'uzman_incelemesinde' || c.status === 'manuel_inceleme') && (
          <div
            className={`mb-5 flex items-start gap-3 rounded-xl border p-4 text-sm ${
              slaTone(c.reviewDueAt) === 'overdue' || slaTone(c.reviewDueAt) === 'critical'
                ? 'border-rose-300 bg-rose-50 text-rose-950'
                : slaTone(c.reviewDueAt) === 'warn'
                  ? 'border-amber-300 bg-amber-50 text-amber-950'
                  : 'border-sky-200 bg-sky-50 text-sky-950'
            }`}
          >
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {t('cases.detail.slaTitle', { hours: String(slaHoursForPriority(c.priority)) })}
                {(c.priority === 'STAT' || c.priority === 'Acil') ? t('cases.detail.slaUrgent') : ''}
              </p>
              <p className="mt-1">
                {t('cases.detail.slaBody', {
                  remaining: formatSlaRemaining(c.reviewDueAt, Date.now(), slaLabelsFromT(t)),
                })}
              </p>
            </div>
            <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${slaBadgeClass(slaTone(c.reviewDueAt))}`}>
              {formatSlaRemaining(c.reviewDueAt, Date.now(), slaLabelsFromT(t))}
            </span>
          </div>
        )}
      {c.status === 'revizyon' && c.statusNote && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>{t('cases.detail.revisionRequest')}</strong> {c.statusNote}</p>
        </div>
      )}
      {c.status === 'analiz_basarisiz' && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>
              <strong>{t('cases.detail.analysisFailedTitle')}</strong>{' '}
              {c.statusNote ?? t('cases.detail.analysisFailedDefault')}
            </p>
            {role === 'expert' && (
              <Button className="mt-2" size="sm" onClick={() => nav(`/vakalar/${c.id}/calisma`)}>
                {t('cases.detail.startManualDraft')}
              </Button>
            )}
          </div>
        </div>
      )}
      {c.status === 'iptal' && (
        <div className="mb-5 rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700" role="status">
          <strong>{t('cases.cancel.bannerTitle')}</strong>{' '}
          {c.cancelReason ? `${t('cases.cancel.reason')}: ${c.cancelReason}` : ''}
          {c.cancelledBy ? ` · ${c.cancelledBy}` : ''}
          {c.cancelledAt ? ` · ${fmtDate(c.cancelledAt, locale)}` : ''}
        </div>
      )}
      {c.status === 'manuel_inceleme' && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm text-slate-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>
              <strong>{t('cases.detail.manualReviewTitle')}</strong>{' '}
              {c.statusNote ?? t('cases.detail.manualReviewDefault')}
            </p>
            {role === 'expert' && (
              <Button className="mt-2" size="sm" onClick={() => nav(`/vakalar/${c.id}/calisma`)}>
                {t('cases.detail.manualWorkspace')}
              </Button>
            )}
          </div>
        </div>
      )}
      {c.status === 'reddedildi' && c.statusNote && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>{t('cases.detail.rejectReason')}</strong> {c.statusNote}</p>
        </div>
      )}

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label={t('cases.detail.tabsAria')}>
        {tabs.map((tabItem) => (
          <button
            key={tabItem.key}
            id={`case-tab-${tabItem.key}`}
            type="button"
            role="tab"
            aria-selected={tab === tabItem.key}
            aria-controls={`case-panel-${tabItem.key}`}
            onClick={() => selectTab(tabItem.key)}
            className={`-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === tabItem.key ? 'border-b-2 border-vet-turquoise text-vet-turquoise' : 'border-transparent text-slate-500 hover:text-navy-800'
            }`}
          >
            {tabItem.icon} {tabItem.label}
          </button>
        ))}
      </div>

      <div
        id={`case-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`case-tab-${tab}`}
        className="space-y-5"
      >
        {tab === 'genel' && (
          <>
            <Overview c={c} />
            {(c.backendCaseId || c.id.startsWith('case-')) && (
              <PriorStudiesPanel caseId={c.backendCaseId || c.id} canLink={role === 'vet' || role === 'admin'} />
            )}
            {(c.backendCaseId || c.id.startsWith('case-')) && (
              // Issue #113: plain-language note for the owner (vet writes, radiologist reads).
              <OwnerSummaryCard caseId={c.backendCaseId || c.id} canWrite={role === 'vet' || role === 'admin'} />
            )}
          </>
        )}
        {tab === 'goruntu' && <Imaging c={c} />}
        {tab === 'bulgular' && <AssessmentView c={c} />}
        {tab === 'rapor' && <ReportWorkspace c={c} />}
        {tab === 'kaynaklar' && <SourcesView c={c} />}
        {tab === 'belgeler' && <Documents c={c} />}
        {tab === 'gecmis' && <CaseHistoryPanel c={c} />}
      </div>
    </>
  )
}
