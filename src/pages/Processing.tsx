import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Circle,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Square,
  XCircle,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { Card, CardHeader } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { StatusBadge } from '../components/StatusBadge'
import { EmptyState } from '../components/EmptyState'
import { SkeletonRows } from '../components/Skeleton'
import { CaseWorkflowStepper } from '../components/CaseWorkflowStepper'
import {
  BackendUnavailableError,
  enqueueAnalyzeCase,
  getAnalysisJob,
  getBackendCase,
  requestCancelAnalysisJob,
  type BackendAnalysisJob,
} from '../lib/backend'
import { displayAnalysisProgress, estimateAnalysisDurationMs } from '../lib/analysisProgress'
import type { TranslateFn } from '../i18n'

function analysisModeBanner(
  mode: string | undefined,
  sourceKind: string | undefined,
  t: TranslateFn,
): {
  label: string
  cls: string
} {
  const resolved = mode || (sourceKind === 'real' ? 'real' : sourceKind === 'mixed' ? 'mixed' : 'mock')
  if (resolved === 'real') {
    return {
      label: t('cases.processing.modeReal'),
      cls: 'border-emerald-300 bg-emerald-50 text-emerald-950',
    }
  }
  if (resolved === 'mixed') {
    return {
      label: t('cases.processing.modeMixed'),
      cls: 'border-amber-300 bg-amber-50 text-amber-950',
    }
  }
  return {
    label: t('cases.processing.modeMock'),
    cls: 'border-sky-300 bg-sky-50 text-sky-950',
  }
}

function statusIcon(status: string) {
  if (status === 'completed') return <CheckCircle2 className="h-5 w-5 text-teal-600" />
  if (status === 'failed' || status === 'timed_out' || status === 'cancelled') {
    return <XCircle className="h-5 w-5 text-rose-600" />
  }
  if (status === 'running' || status === 'queued' || status === 'cancel_requested') {
    return <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
  }
  return <Circle className="h-5 w-5 text-slate-400" />
}

function isInFlightStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'cancel_requested'
}

export default function Processing() {
  const { id = '' } = useParams()
  const { getCase, updateCase, hydrateBackendCase, pushToast } = useApp()
  const { t } = useLocale()
  // Backend stage_label is Turkish; translate the stage id, fall back to the backend text.
  const stageLabel = (j: { pipeline_stage?: string | null; stage_label?: string | null } | null | undefined) => {
    if (!j) return ''
    const key = j.pipeline_stage ? `analysis.stages.${j.pipeline_stage}` : ''
    const translated = key ? t(key) : ''
    return translated && translated !== key ? translated : j.stage_label || j.pipeline_stage || ''
  }
  const nav = useLocalizedNavigate()
  const c = getCase(id)
  const isBackend = Boolean(c?.backendCaseId || id.startsWith('case-'))
  const [job, setJob] = useState<BackendAnalysisJob | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const startedAtRef = useRef<number | null>(null)

  const caseId = c?.backendCaseId || c?.id || id

  // One refresh at a time: a slow response finishing after a newer one used to overwrite
  // the job and make the progress bar jump backwards.
  const refreshing = useRef(false)
  const refresh = useCallback(async () => {
    if (!isBackend || !caseId.startsWith('case-')) return
    if (refreshing.current) return
    refreshing.current = true
    setLoadError(null)
    try {
      const record = await getBackendCase(caseId)
      await hydrateBackendCase(caseId)
      if (record.latest_job_id) {
        const next = await getAnalysisJob(record.latest_job_id)
        setJob(next)
        if (isInFlightStatus(next.status) && startedAtRef.current == null) {
          startedAtRef.current = c?.processingStartedAt ?? Date.now()
        }
        if (next.status === 'completed' || next.status === 'failed' || next.status === 'cancelled' || next.status === 'timed_out') {
          // Keep ETA clock for failed bars; reset start on next retry.
          if (next.status === 'completed') startedAtRef.current = startedAtRef.current ?? Date.now()
        }
      } else {
        setJob(null)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('cases.processing.jobStatusFailed'))
    } finally {
      refreshing.current = false
    }
  }, [caseId, hydrateBackendCase, isBackend, t, c?.processingStartedAt])

  useEffect(() => {
    startedAtRef.current = c?.processingStartedAt ?? startedAtRef.current
    void refresh()
  }, [refresh, c?.processingStartedAt])

  const jobStatus = job?.status ?? (c?.backendOutcome ? 'completed' : 'unknown')
  const inFlight = isInFlightStatus(job?.status) || retrying

  useEffect(() => {
    if (!inFlight || !isBackend || !caseId.startsWith('case-')) return
    const timer = window.setInterval(() => {
      void refresh()
    }, 1200)
    return () => window.clearInterval(timer)
  }, [inFlight, isBackend, caseId, refresh])

  // Smooth ETA progress between job polls.
  useEffect(() => {
    if (!inFlight) return
    const timer = window.setInterval(() => setNowTick(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [inFlight])

  const progressPct = displayAnalysisProgress({
    backendPct: job?.progress_pct,
    startedAtMs: startedAtRef.current ?? c?.processingStartedAt ?? null,
    estimatedMs: c?.processingMs ?? estimateAnalysisDurationMs(c?.instanceCount),
    instanceCount: c?.instanceCount,
    status: job?.status ?? (retrying ? 'running' : undefined),
    nowMs: nowTick,
  })

  const mode = analysisModeBanner(job?.analysis_mode, c?.backendFindings?.source_kind, t)

  const studyLabel = useMemo(() => {
    if (!c) return t('common.dash')
    const parts = [
      c.modality,
      c.anatomicalRegion,
      c.studyInstanceUid ? `UID …${c.studyInstanceUid.slice(-10)}` : null,
      c.instanceCount != null ? t('cases.processing.imagesCount', { n: String(c.instanceCount) }) : null,
    ].filter(Boolean)
    return parts.join(' · ') || t('cases.processing.studyMetadata')
  }, [c, t])

  const onStop = async () => {
    const jobId = job?.job_id ?? c?.backendJobId
    if (!c || !jobId || stopping) return
    setStopping(true)
    setLoadError(null)
    try {
      const updated = await requestCancelAnalysisJob(jobId)
      setJob(updated)
      pushToast({
        tone: 'info',
        title: t('cases.processing.toastStopping'),
        body: t('cases.processing.toastCancelBody'),
      })
      await hydrateBackendCase(caseId)
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('cases.processing.cancelFailed')
      setLoadError(message)
      pushToast({ tone: 'error', title: t('cases.processing.toastStopFailed'), body: message })
    } finally {
      setStopping(false)
    }
  }

  const onRetry = async () => {
    if (!c || !caseId.startsWith('case-')) return
    setRetrying(true)
    setLoadError(null)
    try {
      const eta = estimateAnalysisDurationMs(c.instanceCount)
      startedAtRef.current = Date.now()
      updateCase(c.id, {
        status: 'ai_analizi',
        processingStartedAt: startedAtRef.current,
        processingMs: eta,
        backendOutcome: undefined,
      })
      const enqueued = await enqueueAnalyzeCase(caseId)
      setJob(enqueued)
      updateCase(c.id, { backendJobId: enqueued.job_id, status: 'ai_analizi' })
      pushToast({
        tone: 'info',
        title: t('cases.processing.toastRefreshed'),
        body: t('cases.processing.inFlightHint'),
      })
      await refresh()
    } catch (err) {
      const message =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('cases.processing.retryFailed')
      setLoadError(message)
      pushToast({ tone: 'error', title: t('cases.processing.retryFailed'), body: message })
    } finally {
      setRetrying(false)
    }
  }

  if (!c) {
    return (
      <Card>
        <EmptyState icon={<FileText className="h-6 w-6" />} title={t('cases.processing.notFound')} />
      </Card>
    )
  }

  const outcome = job?.outcome ?? c.backendOutcome
  const failed = outcome === 'failed' || jobStatus === 'failed' || jobStatus === 'timed_out'
  const unsupported = outcome === 'unsupported'
  const cancelled = jobStatus === 'cancelled'
  const cancelling = jobStatus === 'cancel_requested' || stopping
  const canStop =
    Boolean(job?.job_id ?? c.backendJobId) &&
    (isInFlightStatus(job?.status) || retrying) &&
    jobStatus !== 'cancel_requested'

  return (
    <>
      <PageHeader
        title={`${t('cases.processing.title')} — ${c.patient.name}`}
        subtitle={`${c.no} · ${c.patient.species}, ${c.patient.breed}`}
        breadcrumb={t('cases.processing.breadcrumb')}
        actions={<StatusBadge status={c.status} />}
      />
      <div className="mb-4">
        <CaseWorkflowStepper currentStep={2} status={failed || cancelled ? 'error' : undefined} />
      </div>

      <div className={`mb-4 rounded-lg border px-4 py-2 text-sm font-semibold tracking-wide ${mode.cls}`}>
        {mode.label}
      </div>

      {loadError && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {loadError}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {!job && !loadError && !c.backendOutcome ? (
            <Card>
              <SkeletonRows rows={4} />
            </Card>
          ) : (
            <Card className="p-5">
              <div className="flex items-start gap-3">
                {statusIcon(jobStatus)}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-navy-900">
                    {t('cases.processing.jobStatus')}{' '}
                    <span className="font-mono">{jobStatus}</span>
                    {outcome ? ` · outcome=${outcome}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {cancelling
                      ? t('cases.processing.cancelPending')
                      : inFlight
                        ? t('cases.processing.inFlightHint')
                        : t('cases.processing.idleHint')}
                  </p>
                  {(inFlight || progressPct > 0 || jobStatus === 'completed') && (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-navy-800">
                          {stageLabel(job) || (inFlight ? t('analysis.analyzing') : t('common.dash'))}
                          {job?.pipeline_stage === 'vision_adapters' &&
                          job.vision_adapter_total != null &&
                          job.vision_adapter_total > 0
                            ? ` · model ${(job.vision_adapter_index ?? 0) + 1}/${job.vision_adapter_total}`
                            : ''}
                          {job?.vision_frames_detected != null
                            ? ` · tespit ${job.vision_frames_detected} · decode ${job.vision_frames_decoded ?? '—'} · görsel ${job.vision_frames_analyzed ?? 0}`
                            : ''}
                        </span>
                        <span className="font-mono font-semibold tabular-nums text-teal-800">
                          {Math.round(progressPct)}%
                        </span>
                      </div>
                      <div
                        className="h-2.5 overflow-hidden rounded-full bg-slate-100"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progressPct)}
                        aria-label={t('cases.processing.progressAria')}
                      >
                        <div
                          className="h-full rounded-full bg-teal-600 transition-[width] duration-300 ease-out"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {job?.error_message && (
                    <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{job.error_message}</p>
                  )}
                </div>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title={t('cases.processing.pipelineSummary')} icon={<Brain className="h-5 w-5" />} />
            <dl className="divide-y divide-slate-50 px-5 py-2 text-sm">
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">Case ID</dt>
                <dd className="col-span-3 font-mono text-xs">{caseId}</dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">{t('cases.study')}</dt>
                <dd className="col-span-3">{studyLabel}</dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">Job ID</dt>
                <dd className="col-span-3 font-mono text-xs">{job?.job_id ?? c.backendJobId ?? t('common.dash')}</dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">{t('cases.processing.models')}</dt>
                <dd className="col-span-3 text-xs">
                  {(
                    (job?.routed_model_ids?.length
                      ? job.routed_model_ids
                      : c.backendFindings?.contributing_model_ids) ?? []
                  ).join(', ') || t('common.dash')}
                  {job?.routed_model_versions?.length ? ` · v${job.routed_model_versions.join(', ')}` : ''}
                </dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">Route</dt>
                <dd className="col-span-3 text-xs">{job?.route_reason ?? t('common.dash')}</dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">source_kind</dt>
                <dd className="col-span-3 font-mono text-xs">
                  {c.backendFindings?.source_kind ?? job?.analysis_mode ?? 'mock'}
                </dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">Timeout (declared)</dt>
                <dd className="col-span-3 text-xs">{job?.timeout_s != null ? `${job.timeout_s}s` : t('common.dash')}</dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">{t('cases.processing.stage')}</dt>
                <dd className="col-span-3 text-xs">
                  {stageLabel(job) || t('common.dash')}
                  {` · ${Math.round(progressPct)}%`}
                </dd>
              </div>
              {(job?.vision_frames_detected != null || job?.vision_batch_total != null) && (
                <div className="grid grid-cols-5 gap-2 py-2">
                  <dt className="col-span-2 text-slate-500">Görsel kapsam</dt>
                  <dd className="col-span-3 text-xs">
                    {job.vision_detail || (
                      <>
                        parti {(job.vision_batch_index ?? 0) + 1}/{job.vision_batch_total ?? '—'}
                        {' · '}
                        tespit {job.vision_frames_detected ?? '—'}
                        {' · '}decode {job.vision_frames_decoded ?? '—'}
                        {' · '}görsel {job.vision_frames_analyzed ?? 0}
                        {job.vision_series_total != null
                          ? ` · seri ${job.vision_series_done ?? 0}/${job.vision_series_total}`
                          : ''}
                        {job.vision_analysis_scope ? ` · ${job.vision_analysis_scope}` : ''}
                      </>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </Card>

          {inFlight && (
            <Card className="border-teal-100 p-5">
              <p className="flex items-start gap-2 text-sm text-navy-800">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-teal-600" />
                {cancelling ? t('cases.processing.stoppingCard') : t('cases.processing.inFlightCard')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={
                    cancelling ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )
                  }
                  disabled={!canStop || stopping}
                  onClick={() => void onStop()}
                >
                  {cancelling ? t('cases.detail.stopping') : t('cases.processing.stopAnalysis')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void refresh()}>
                  {t('cases.processing.refreshJob')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => nav(`/vakalar/${c.id}`)}>
                  {t('cases.processing.caseDetail')}
                </Button>
              </div>
            </Card>
          )}

          {(failed || unsupported || cancelled) && !inFlight && (
            <Card className="border-rose-100 p-5">
              <p className="flex items-start gap-2 text-sm text-rose-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                {failed && t('cases.processing.failedMsg')}
                {unsupported && t('cases.processing.unsupportedMsg')}
                {cancelled && t('cases.processing.cancelledMsg')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />}
                  disabled={retrying}
                  onClick={() => void onRetry()}
                >
                  {t('cases.processing.retryAsync')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => nav(`/vakalar/${c.id}`)}>
                  {t('cases.processing.caseDetail')}
                </Button>
              </div>
            </Card>
          )}

          {!failed && !unsupported && !cancelled && !inFlight && (
            <Card className="p-5">
              <p className="text-sm text-navy-800">{t('cases.processing.completedHint')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => nav(`/vakalar/${c.id}?tab=ai`)}>
                  {t('cases.processing.viewAiDraft')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => nav(`/vakalar/${c.id}/calisma`)}>
                  {t('cases.processing.expertReview')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void refresh()}>
                  {t('cases.processing.refreshJob')}
                </Button>
              </div>
            </Card>
          )}
        </div>

        <Card className="h-fit p-5">
          <h3 className="text-sm font-semibold text-navy-900">{t('cases.processing.securityTitle')}</h3>
          <ul className="mt-3 space-y-2 text-xs text-slate-600">
            <li>{t('cases.processing.security1')}</li>
            <li>{t('cases.processing.security2')}</li>
            <li>{t('cases.processing.security3')}</li>
          </ul>
        </Card>
      </div>
    </>
  )
}
