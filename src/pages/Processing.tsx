import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  ChevronDown,
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
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { StatusBadge } from '../components/StatusBadge'
import { EmptyState } from '../components/EmptyState'
import { CaseWorkflowStepper } from '../components/CaseWorkflowStepper'
import { CLINIC } from '../data/mock'
import { buildAssessment, makeDocument } from '../data/templates'
import { localize } from '../lib/neuroLocalization'
import { nowStamp, today } from '../lib/format'
import { studyLabel as formatStudyLabel } from '../lib/displayClean'
import {
  BackendUnavailableError,
  confirmDicomAndEnqueueAnalyze,
  enqueueAnalyzeCase,
  getAnalysisJob,
  getBackendCase,
  requestCancelAnalysisJob,
  uploadDicomDemo,
  uploadDicomFiles,
  type BackendAnalysisJob,
} from '../lib/backend'
import { displayAnalysisProgress, estimateAnalysisDurationMs } from '../lib/analysisProgress'
import { clearAnalyzeHandoff, getAnalyzeHandoff, type AnalyzeHandoff } from '../lib/analyzeHandoff'
import { cacheCaseDicomFiles } from '../lib/dicomCaseCache'
import { MAX_VIEWER_FRAMES } from '../lib/dicomFolder'
import type { TranslateFn } from '../i18n'
import type { ClinicalInfo, NeuroExam, Patient, Priority, VetCase } from '../types'

const EMPTY_NEURO: NeuroExam = {
  consciousness: 'Uyanık',
  gait: 'Normal',
  limbs: [],
  posturalThoracic: 'Normal',
  posturalPelvic: 'Normal',
  reflexThoracic: 'Normal',
  reflexPelvic: 'Normal',
  cranialNerves: [],
  deepPain: 'Değerlendirilmedi',
  hyperesthesia: 'Yok',
}

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

function friendlyJobStatus(status: string, t: TranslateFn): string {
  switch (status) {
    case 'completed':
      return t('cases.processing.statusCompleted')
    case 'failed':
      return t('cases.processing.statusFailed')
    case 'timed_out':
      return t('cases.processing.statusTimedOut')
    case 'cancelled':
      return t('cases.processing.statusCancelled')
    case 'queued':
      return t('cases.processing.statusQueued')
    case 'running':
      return t('cases.processing.statusRunning')
    case 'cancel_requested':
      return t('cases.processing.statusCancelling')
    default:
      return status
  }
}

function isInFlightStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'running' || status === 'cancel_requested'
}

type HandoffPhase = 'idle' | 'uploading' | 'queuing' | 'sent' | 'failed'

function buildCaseFromHandoff(
  handoff: AnalyzeHandoff,
  caseRecord: Awaited<ReturnType<typeof confirmDicomAndEnqueueAnalyze>>['case'],
  job: BackendAnalysisJob,
  uploadSnap: AnalyzeHandoff['uploadSnap'],
  locale: 'tr' | 'en',
  t: TranslateFn,
): VetCase {
  const parsedAge = handoff.ageYears.trim() === '' ? 0 : Number(handoff.ageYears)
  const patient: Patient = {
    name: handoff.patientName,
    species: handoff.species,
    breed: handoff.breed,
    sex: 'Erkek',
    neutered: true,
    age: Number.isFinite(parsedAge) ? parsedAge : 0,
    weight: 0,
    ownerName: 'Sahip',
    ownerPhone: '',
  }
  const clinical: ClinicalInfo = {
    complaint: handoff.history.split('\n')[0] || 'DICOM inceleme',
    onset: 'Akut',
    course: 'Progresif',
    history: handoff.history,
    medications: '',
  }
  const neuro = EMPTY_NEURO
  const stamp = nowStamp()
  const loc = localize(neuro, clinical, locale)
  const built = buildAssessment(loc?.template ?? 'ivdd', patient, neuro, stamp, locale)
  const id = caseRecord.case_id
  const instanceCount =
    uploadSnap?.study?.series.reduce((n, s) => n + s.instances.length, 0) ??
    caseRecord.dicom_study?.series?.reduce((n, s) => n + (s.instances?.length ?? 0), 0) ??
    handoff.files.length
  const priority: Priority = 'Normal'

  return {
    id,
    no: id.replace(/^case-/, 'VM-').toUpperCase(),
    patient,
    clinical,
    neuro,
    documents: [
      {
        ...makeDocument(
          `${id}-dicom`,
          `DICOM study ${uploadSnap?.study?.study_instance_uid ?? 'pending'}`,
          'MR Raporu',
          patient,
          clinical,
          built.imaging,
        ),
        size: `${instanceCount} görüntü`,
        rawText: 'Yalnızca DICOM dosya bilgileri okundu; görüntü pikselleri analiz edilmedi.',
        extracted: [
          {
            field: 'StudyInstanceUID',
            value: uploadSnap?.study?.study_instance_uid ?? '—',
            source: 'DICOM',
          },
          {
            field: 'Sınıflandırma',
            value: uploadSnap?.classification
              ? formatStudyLabel(
                  t,
                  uploadSnap.classification.suggested_modality,
                  uploadSnap.classification.suggested_anatomical_region,
                )
              : '—',
            source: 'DICOM sınıflandırıcı',
          },
        ],
      },
    ],
    status: 'ai_analizi',
    module: 'Nöroloji',
    priority,
    createdAt: today(),
    clinic: CLINIC,
    vetName: handoff.vetName,
    ai: built.ai,
    aiDraft: built.draft,
    report: { ...built.draft },
    corrections: [],
    timeline: [
      { date: stamp, label: 'Giriş sonrası DICOM metadata yüklendi', by: handoff.vetName },
      { date: stamp, label: `Analiz kuyruğa alındı (${job.job_id})`, by: 'Sistem' },
    ],
    processingStartedAt: Date.now(),
    processingMs: estimateAnalysisDurationMs(instanceCount),
    backendCaseId: id,
    backendJobId: job.job_id,
    fromBackend: true,
    dicomDemoKind: handoff.pendingDemo ?? undefined,
    modality: caseRecord.modality,
    anatomicalRegion: caseRecord.anatomical_region,
    studyInstanceUid: caseRecord.dicom_study?.study_instance_uid,
    instanceCount,
  }
}

export default function Processing() {
  const { id = '' } = useParams()
  const { getCase, addCase, updateCase, removeCase, hydrateBackendCase, pushToast } = useApp()
  const { t, locale } = useLocale()
  const stageLabel = (j: { pipeline_stage?: string | null; stage_label?: string | null } | null | undefined) => {
    if (!j) return ''
    const key = j.pipeline_stage ? `analysis.stages.${j.pipeline_stage}` : ''
    const translated = key ? t(key) : ''
    return translated && translated !== key ? translated : j.stage_label || j.pipeline_stage || ''
  }
  const nav = useLocalizedNavigate()
  const c = getCase(id)
  const isPending = id.startsWith('pending-')
  const isBackend = Boolean(c?.backendCaseId || id.startsWith('case-'))
  const [job, setJob] = useState<BackendAnalysisJob | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [handoffPhase, setHandoffPhase] = useState<HandoffPhase>(isPending ? 'uploading' : 'idle')
  const [nowTick, setNowTick] = useState(() => Date.now())
  const startedAtRef = useRef<number | null>(null)

  const caseId = c?.backendCaseId || c?.id || id

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

  // Run upload + enqueue after immediate navigation from DICOM upload.
  useEffect(() => {
    if (!isPending) return
    const handoff = getAnalyzeHandoff(id)
    if (!handoff) {
      setHandoffPhase('failed')
      setLoadError(t('cases.processing.handoffFailed'))
      return
    }
    const controller = new AbortController()
    let alive = true

    ;(async () => {
      try {
        let ingestId = handoff.ingestId
        let uploadSnap = handoff.uploadSnap
        if (!ingestId) {
          if (alive) setHandoffPhase('uploading')
          const upload = handoff.pendingDemo
            ? await uploadDicomDemo({
                kind: handoff.pendingDemo,
                patientName: handoff.patientName,
                species: handoff.species,
                breed: handoff.breed,
                clinicalHistory: handoff.history,
                signal: controller.signal,
              })
            : await uploadDicomFiles({
                files: handoff.files,
                patientName: handoff.patientName,
                species: handoff.species,
                breed: handoff.breed,
                clinicalHistory: handoff.history,
                signal: controller.signal,
              })
          if (!alive) return
          uploadSnap = upload
          if (upload.blocked) {
            throw new Error(upload.block_reason || t('dicom.uploadBlocked'))
          }
          ingestId = upload.ingest_id
        }

        if (alive) setHandoffPhase('queuing')
        const { case: caseRecord, job: enqueued } = await confirmDicomAndEnqueueAnalyze({
          ingestId,
          acceptSuggestion: handoff.acceptSuggestion,
          modality: handoff.acceptSuggestion ? undefined : handoff.overrideModality,
          anatomicalRegion: handoff.acceptSuggestion ? undefined : handoff.overrideRegion,
          patientName: handoff.patientName,
          clinicalHistory: handoff.history,
          imagingSourcePermissionVerified: handoff.consent,
          imagingAnalysisConsentVerified: handoff.consent,
          signal: controller.signal,
        })
        if (!alive) return

        setHandoffPhase('sent')
        setJob(enqueued)
        const newCase = buildCaseFromHandoff(handoff, caseRecord, enqueued, uploadSnap, locale, t)
        if (handoff.files.length > 0) {
          void cacheCaseDicomFiles(newCase.id, handoff.files.slice(0, MAX_VIEWER_FRAMES))
        }
        clearAnalyzeHandoff(handoff.pendingId)
        addCase(newCase)
        startedAtRef.current = newCase.processingStartedAt ?? Date.now()
        pushToast({
          tone: 'info',
          title: t('cases.processing.sentToAi'),
          body: `${handoff.patientName} · ${t('cases.processing.loadingTitle')}`,
        })
        // Navigate first so the pending id is not briefly "not found".
        nav(`/vakalar/${newCase.id}/isleme`, { replace: true })
        removeCase(handoff.pendingId)
        setHandoffPhase('idle')
      } catch (err) {
        if (!alive || (err instanceof DOMException && err.name === 'AbortError')) return
        clearAnalyzeHandoff(id)
        const message =
          err instanceof BackendUnavailableError
            ? err.message
            : err instanceof Error
              ? err.message
              : t('cases.processing.handoffFailed')
        setHandoffPhase('failed')
        setLoadError(message)
        pushToast({ tone: 'error', title: t('cases.processing.handoffFailed'), body: message })
      }
    })()

    return () => {
      alive = false
      controller.abort()
    }
  }, [addCase, id, isPending, locale, nav, pushToast, removeCase, t])

  const jobStatus = job?.status ?? (c?.backendOutcome ? 'completed' : handoffPhase !== 'idle' ? 'queued' : 'unknown')
  const preparing = handoffPhase === 'uploading' || handoffPhase === 'queuing' || handoffPhase === 'sent'
  const inFlight = isInFlightStatus(job?.status) || retrying || preparing

  useEffect(() => {
    if (!inFlight || !isBackend || !caseId.startsWith('case-')) return
    const timer = window.setInterval(() => {
      void refresh()
    }, 1200)
    return () => window.clearInterval(timer)
  }, [inFlight, isBackend, caseId, refresh])

  useEffect(() => {
    if (!inFlight && !preparing) return
    const timer = window.setInterval(() => setNowTick(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [inFlight, preparing])

  const progressPct = useMemo(() => {
    if (handoffPhase === 'uploading') {
      const started = startedAtRef.current ?? c?.processingStartedAt ?? Date.now()
      const elapsed = Math.max(0, nowTick - started)
      return Math.min(18, 4 + (elapsed / 8000) * 14)
    }
    if (handoffPhase === 'queuing') {
      const started = startedAtRef.current ?? c?.processingStartedAt ?? Date.now()
      const elapsed = Math.max(0, nowTick - started)
      return Math.min(28, 18 + (elapsed / 6000) * 10)
    }
    return displayAnalysisProgress({
      backendPct: job?.progress_pct,
      startedAtMs: startedAtRef.current ?? c?.processingStartedAt ?? null,
      estimatedMs: c?.processingMs ?? estimateAnalysisDurationMs(c?.instanceCount),
      instanceCount: c?.instanceCount,
      status: job?.status ?? (retrying || preparing ? 'running' : undefined),
      nowMs: nowTick,
    })
  }, [c?.instanceCount, c?.processingMs, c?.processingStartedAt, handoffPhase, job?.progress_pct, job?.status, nowTick, preparing, retrying])

  const mode = analysisModeBanner(job?.analysis_mode, c?.backendFindings?.source_kind, t)
  const sentToAi = handoffPhase === 'sent' || isInFlightStatus(job?.status) || jobStatus === 'completed'
  const showLoadingHero = preparing || inFlight || jobStatus === 'completed'

  const studyMeta = useMemo(() => {
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
  const failed = outcome === 'failed' || jobStatus === 'failed' || jobStatus === 'timed_out' || handoffPhase === 'failed'
  const unsupported = outcome === 'unsupported'
  const cancelled = jobStatus === 'cancelled'
  const cancelling = jobStatus === 'cancel_requested' || stopping
  const canStop =
    Boolean(job?.job_id ?? c.backendJobId) &&
    (isInFlightStatus(job?.status) || retrying) &&
    jobStatus !== 'cancel_requested'
  const roundedPct = Math.round(progressPct)
  const completedOk = jobStatus === 'completed' && !failed && !unsupported && !cancelled
  const stageText =
    handoffPhase === 'uploading'
      ? t('cases.processing.preparingUpload')
      : handoffPhase === 'queuing'
        ? t('cases.processing.preparingQueue')
        : completedOk
          ? t('cases.processing.statusCompleted')
          : stageLabel(job) || (inFlight ? t('analysis.analyzing') : t('cases.processing.loadingTitle'))
  const heroTitle = completedOk ? t('cases.processing.completedTitle') : t('cases.processing.loadingTitle')

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

      {loadError && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {loadError}
          </p>
          {!isPending && (
            <Button size="sm" variant="secondary" onClick={() => void refresh()}>
              {t('common.retry')}
            </Button>
          )}
          {isPending && (
            <Button size="sm" variant="secondary" onClick={() => nav('/dicom-yukle')}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      )}

      <div className="mx-auto max-w-2xl space-y-4">
        {showLoadingHero && (
          <Card className="overflow-hidden p-6 sm:p-8">
            <div className="flex flex-col items-center text-center">
              {completedOk ? (
                <CheckCircle2 className="h-12 w-12 text-teal-600" aria-hidden />
              ) : (
                <Loader2 className="h-12 w-12 animate-spin text-teal-600" aria-hidden />
              )}
              <h2 className="mt-4 text-xl font-semibold tracking-tight text-navy-900">{heroTitle}</h2>
              <p className="mt-1 text-sm text-slate-600">{stageText}</p>

              <div
                className={`mt-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${
                  sentToAi
                    ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
                    : 'bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-200'
                }`}
              >
                {sentToAi ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4" aria-hidden />
                )}
                {t('cases.processing.sentToAi')}
              </div>

              <div className="mt-6 w-full max-w-lg">
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-navy-800">{stageText}</span>
                  <span className="font-semibold tabular-nums text-teal-800">
                    {t('cases.processing.progressOf100', { pct: String(roundedPct) })}
                  </span>
                </div>
                <div
                  className="h-3.5 overflow-hidden rounded-full bg-slate-100"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={roundedPct}
                  aria-label={t('cases.processing.progressAria')}
                >
                  <div
                    className="h-full rounded-full bg-teal-600 transition-[width] duration-300 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            </div>
          </Card>
        )}

        {inFlight && !isPending && (
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
            {job?.error_message && (
              <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{job.error_message}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {!isPending && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />}
                  disabled={retrying}
                  onClick={() => void onRetry()}
                >
                  {t('cases.processing.retryAsync')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => nav(isPending ? '/dicom-yukle' : `/vakalar/${c.id}`)}>
                {isPending ? t('common.retry') : t('cases.processing.caseDetail')}
              </Button>
            </div>
          </Card>
        )}

        {!failed && !unsupported && !cancelled && !inFlight && !isPending && (
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

        {!isPending && (
          <details className="group rounded-vm border border-slate-200/80 bg-surface-elevated shadow-soft">
            <summary className="cursor-pointer list-none px-5 py-4 marker:hidden">
              <span className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-semibold text-navy-900">{t('common.details')}</span>
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">
                    {t('cases.processing.detailsHint')}
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-180" />
              </span>
            </summary>
            <div className="space-y-4 border-t border-slate-100 px-5 py-4">
              <div className={`rounded-lg border px-3 py-2 text-xs font-semibold tracking-wide ${mode.cls}`}>
                {mode.label}
              </div>

              <div className="flex items-start gap-3">
                {statusIcon(jobStatus)}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-navy-900">
                    {t('cases.processing.jobStatus')} {friendlyJobStatus(jobStatus, t)}
                    {outcome ? ` · ${outcome}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {cancelling
                      ? t('cases.processing.cancelPending')
                      : inFlight
                        ? t('cases.processing.inFlightHint')
                        : t('cases.processing.idleHint')}
                  </p>
                  {job?.error_message && (
                    <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{job.error_message}</p>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-900">
                  <Brain className="h-4 w-4 text-accent" />
                  {t('cases.processing.pipelineSummary')}
                </div>
                <dl className="divide-y divide-slate-50 text-sm">
                  <div className="grid grid-cols-5 gap-2 py-2">
                    <dt className="col-span-2 text-slate-500">Case ID</dt>
                    <dd className="col-span-3 font-mono text-xs">{caseId}</dd>
                  </div>
                  <div className="grid grid-cols-5 gap-2 py-2">
                    <dt className="col-span-2 text-slate-500">{t('cases.study')}</dt>
                    <dd className="col-span-3">{studyMeta}</dd>
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
                    <dt className="col-span-2 text-slate-500">Timeout</dt>
                    <dd className="col-span-3 text-xs">{job?.timeout_s != null ? `${job.timeout_s}s` : t('common.dash')}</dd>
                  </div>
                  <div className="grid grid-cols-5 gap-2 py-2">
                    <dt className="col-span-2 text-slate-500">{t('cases.processing.stage')}</dt>
                    <dd className="col-span-3 text-xs">
                      {stageLabel(job) || t('common.dash')}
                      {` · ${roundedPct}%`}
                    </dd>
                  </div>
                  {(job?.vision_frames_detected != null || job?.vision_batch_total != null) && (
                    <div className="grid grid-cols-5 gap-2 py-2">
                      <dt className="col-span-2 text-slate-500">{t('cases.processing.visionScope')}</dt>
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
              </div>

              <div>
                <h3 className="text-sm font-semibold text-navy-900">{t('cases.processing.securityTitle')}</h3>
                <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                  <li>{t('cases.processing.security1')}</li>
                  <li>{t('cases.processing.security2')}</li>
                  <li>{t('cases.processing.security3')}</li>
                </ul>
              </div>
            </div>
          </details>
        )}
      </div>
    </>
  )
}
