import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Circle,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, CardHeader } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { StatusBadge } from '../components/StatusBadge'
import { EmptyState } from '../components/EmptyState'
import {
  BackendUnavailableError,
  analyzeCaseAsyncAndWait,
  getAnalysisJob,
  getBackendCase,
  type BackendAnalysisJob,
} from '../lib/backend'
import type { BackendPipelineResult } from '../types'

function analysisModeBanner(mode: string | undefined, sourceKind: string | undefined): {
  label: string
  cls: string
} {
  const resolved = mode || (sourceKind === 'real' ? 'real' : sourceKind === 'mixed' ? 'mixed' : 'mock')
  if (resolved === 'real') {
    return {
      label: 'REAL MODEL ANALYSIS',
      cls: 'border-emerald-300 bg-emerald-50 text-emerald-950',
    }
  }
  if (resolved === 'mixed') {
    return {
      label: 'MIXED MOCK + REAL ANALYSIS',
      cls: 'border-amber-300 bg-amber-50 text-amber-950',
    }
  }
  return {
    label: 'DEMO / MOCK ANALYSIS',
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

export default function Processing() {
  const { id = '' } = useParams()
  const { getCase, updateCase, hydrateBackendCase, pushToast } = useApp()
  const nav = useNavigate()
  const c = getCase(id)
  const isBackend = Boolean(c?.backendCaseId || id.startsWith('case-'))
  const [job, setJob] = useState<BackendAnalysisJob | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)

  const caseId = c?.backendCaseId || c?.id || id

  const refresh = useCallback(async () => {
    if (!isBackend || !caseId.startsWith('case-')) return
    setLoadError(null)
    try {
      const record = await getBackendCase(caseId)
      await hydrateBackendCase(caseId)
      if (record.latest_job_id) {
        setJob(await getAnalysisJob(record.latest_job_id))
      } else {
        setJob(null)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Job durumu alınamadı')
    }
  }, [caseId, hydrateBackendCase, isBackend])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const mode = analysisModeBanner(
    job?.analysis_mode,
    c?.backendFindings?.source_kind,
  )

  const studyLabel = useMemo(() => {
    if (!c) return '—'
    const parts = [
      c.modality,
      c.anatomicalRegion,
      c.studyInstanceUid ? `UID …${c.studyInstanceUid.slice(-10)}` : null,
      c.instanceCount != null ? `${c.instanceCount} görüntü` : null,
    ].filter(Boolean)
    return parts.join(' · ') || 'Study metadata'
  }, [c])

  const onRetry = async () => {
    if (!c || !caseId.startsWith('case-')) return
    setRetrying(true)
    setLoadError(null)
    try {
      const result: BackendPipelineResult = await analyzeCaseAsyncAndWait(caseId)
      setJob(await getAnalysisJob(result.job.job_id))
      updateCase(c.id, {
        backendOutcome: result.outcome,
        backendJobId: result.job.job_id,
        backendFindings: result.findings ?? undefined,
        backendDraft: result.report ?? undefined,
        status:
          result.outcome === 'failed'
            ? 'analiz_basarisiz'
            : result.outcome === 'unsupported'
              ? 'manuel_inceleme'
              : 'uzman_incelemesinde',
      })
      pushToast({
        tone: result.outcome === 'failed' ? 'error' : 'success',
        title: 'Analiz yenilendi',
        body: `outcome=${result.outcome}`,
      })
      await hydrateBackendCase(caseId)
    } catch (err) {
      const message =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Yeniden deneme başarısız'
      setLoadError(message)
      pushToast({ tone: 'error', title: 'Yeniden deneme başarısız', body: message })
    } finally {
      setRetrying(false)
    }
  }

  if (!c) {
    return (
      <Card>
        <EmptyState icon={<FileText className="h-6 w-6" />} title="Vaka bulunamadı" />
      </Card>
    )
  }

  if (!isBackend) {
    return (
      <>
        <PageHeader
          title={`AI İşleme — ${c.patient.name}`}
          subtitle={`${c.no} · yerel prototip`}
          breadcrumb="Vakalar / AI İşleme"
          actions={<StatusBadge status={c.status} />}
        />
        <Card>
          <EmptyState
            icon={<AlertCircle className="h-6 w-6" />}
            title="Yerel prototip — backend job yok"
            text="Bu vaka FastAPI async analyze ile oluşturulmadı. GPU/progress tahminleri gösterilmez. DICOM veya backend Yeni Vaka kullanın."
            action={
              <Link to={`/vakalar/${c.id}`} className="text-sm font-medium text-teal-700">
                Vaka detayına dön
              </Link>
            }
          />
        </Card>
      </>
    )
  }

  const jobStatus = job?.status ?? (c.backendOutcome ? 'completed' : 'unknown')
  const outcome = job?.outcome ?? c.backendOutcome
  const failed = outcome === 'failed' || jobStatus === 'failed' || jobStatus === 'timed_out'
  const unsupported = outcome === 'unsupported'
  const cancelled = jobStatus === 'cancelled' || jobStatus === 'cancel_requested'

  return (
    <>
      <PageHeader
        title={`AI İşleme — ${c.patient.name}`}
        subtitle={`${c.no} · ${c.patient.species}, ${c.patient.breed}`}
        breadcrumb="Vakalar / AI İşleme"
        actions={<StatusBadge status={c.status} />}
      />

      <div className={`mb-4 rounded-lg border px-4 py-2 text-sm font-semibold tracking-wide ${mode.cls}`}>
        {mode.label}
        <span className="mt-0.5 block text-xs font-normal opacity-90">
          Klinik doğrulanmış AI değildir. Uzman incelemesi zorunludur. İstemci poll iptali backend işini iptal etmez.
        </span>
      </div>

      {loadError && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {loadError}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            Tekrar dene
          </Button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              {statusIcon(jobStatus)}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-navy-900">
                  Job durumu: <span className="font-mono">{jobStatus}</span>
                  {outcome ? ` · outcome=${outcome}` : ''}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  İlerleme yüzdesi / GPU metrikleri uydurulmaz. Yalnızca backend job alanları gösterilir.
                </p>
                {job?.error_message && (
                  <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{job.error_message}</p>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Pipeline özeti" icon={<Brain className="h-5 w-5" />} />
            <dl className="divide-y divide-slate-50 px-5 py-2 text-sm">
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">Case ID</dt>
                <dd className="col-span-3 font-mono text-xs">{caseId}</dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">Study</dt>
                <dd className="col-span-3">{studyLabel}</dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">Job ID</dt>
                <dd className="col-span-3 font-mono text-xs">{job?.job_id ?? c.backendJobId ?? '—'}</dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">Modeller</dt>
                <dd className="col-span-3 text-xs">
                  {(
                    (job?.routed_model_ids?.length
                      ? job.routed_model_ids
                      : c.backendFindings?.contributing_model_ids) ?? []
                  ).join(', ') || '—'}
                  {job?.routed_model_versions?.length
                    ? ` · v${job.routed_model_versions.join(', ')}`
                    : ''}
                </dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">Route</dt>
                <dd className="col-span-3 text-xs">{job?.route_reason ?? '—'}</dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">source_kind</dt>
                <dd className="col-span-3 font-mono text-xs">
                  {c.backendFindings?.source_kind ?? job?.analysis_mode ?? 'mock'}
                </dd>
              </div>
              <div className="grid grid-cols-5 gap-2 py-2">
                <dt className="col-span-2 text-slate-500">Timeout (declared)</dt>
                <dd className="col-span-3 text-xs">
                  {job?.timeout_s != null ? `${job.timeout_s}s` : '—'}
                </dd>
              </div>
            </dl>
          </Card>

          {(failed || unsupported || cancelled) && (
            <Card className="border-rose-100 p-5">
              <p className="flex items-start gap-2 text-sm text-rose-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                {failed && 'Analiz başarısız veya zaman aşımı — onaylanabilir AI taslak yok.'}
                {unsupported && 'Desteklenmeyen modalite/bölge — manuel inceleme; AI draft onayı kapalı.'}
                {cancelled && 'Job iptal edildi (cooperative). İstemci poll abort ile aynı değildir.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />}
                  disabled={retrying}
                  onClick={() => void onRetry()}
                >
                  Yeniden dene (async)
                </Button>
                <Button size="sm" variant="ghost" onClick={() => nav(`/vakalar/${c.id}`)}>
                  Vaka detayı
                </Button>
              </div>
            </Card>
          )}

          {!failed && !unsupported && !cancelled && (
            <Card className="p-5">
              <p className="text-sm text-navy-800">
                Demo/mock pipeline tamamlandıysa uzman incelemesine geçebilirsiniz. Gerçek model yalnızca
                yapılandırılmış ve yetkilendirilmiş bir adapter ile çalışır.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => nav(`/vakalar/${c.id}?tab=ai`)}>
                  AI taslağı gör
                </Button>
                <Button size="sm" variant="secondary" onClick={() => nav(`/vakalar/${c.id}/inceleme`)}>
                  Uzman inceleme
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void refresh()}>
                  Job yenile
                </Button>
              </div>
            </Card>
          )}
        </div>

        <Card className="h-fit p-5">
          <h3 className="text-sm font-semibold text-navy-900">Güvenlik / sınırlar</h3>
          <ul className="mt-3 space-y-2 text-xs text-slate-600">
            <li>Piksel erişimi varsayılan kapalı (default-deny).</li>
            <li>RAG atıfları klinik doğrulama değildir.</li>
            <li>Gerçek provider hata verirse mock’a sessiz düşülmez.</li>
            <li>Ödeme / checkout bu fazda yoktur.</li>
          </ul>
        </Card>
      </div>
    </>
  )
}
