import { useEffect, useState } from 'react'
import { CheckCircle2, Cpu, Gauge, Rocket, Timer, Zap, AlertTriangle, ListOrdered, Server, RefreshCw, BrainCircuit } from 'lucide-react'
import { Card, CardHeader, StatCard } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { SERVICES } from '../data/mock'
import { useLocale } from '../context/LocaleContext'
import {
  BackendUnavailableError,
  applyRetentionPlan,
  fetchBackendHealth,
  fetchModelReadiness,
  fetchRetentionPlan,
  type BackendHealth,
  type BackendModelReadiness,
  type RetentionPlanResponse,
} from '../lib/backend'
export default function SystemStatus() {
  const { t } = useLocale()
  const [health, setHealth] = useState<BackendHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [readiness, setReadiness] = useState<BackendModelReadiness | null>(null)
  const [readinessError, setReadinessError] = useState<string | null>(null)
  const [retentionPlan, setRetentionPlan] = useState<RetentionPlanResponse | null>(null)
  const [retentionError, setRetentionError] = useState<string | null>(null)
  const [retentionLoading, setRetentionLoading] = useState(false)
  const [applyOpen, setApplyOpen] = useState(false)
  const [applying, setApplying] = useState(false)

  const loadHealth = () => {
    setLoading(true)
    setHealthError(null)
    setReadinessError(null)
    void Promise.all([
      fetchBackendHealth()
        .then((h) => {
          setHealth(h)
          setHealthError(null)
        })
        .catch((err) => {
          setHealth(null)
          setHealthError(
            err instanceof BackendUnavailableError
              ? err.message
              : err instanceof Error
                ? err.message
                : t('admin.healthFetchFail'),
          )
        }),
      fetchModelReadiness()
        .then((r) => {
          setReadiness(r)
          setReadinessError(null)
        })
        .catch((err) => {
          setReadiness(null)
          setReadinessError(
            err instanceof BackendUnavailableError
              ? err.message
              : err instanceof Error
                ? err.message
                : t('admin.readinessFetchFail'),
          )
        }),
    ]).finally(() => setLoading(false))
  }

  useEffect(() => {
    loadHealth()
  }, [])

  const loadRetentionDryRun = () => {
    setRetentionLoading(true)
    setRetentionError(null)
    void fetchRetentionPlan()
      .then((plan) => {
        setRetentionPlan(plan)
        setRetentionError(null)
      })
      .catch((err) => {
        setRetentionPlan(null)
        setRetentionError(
          err instanceof BackendUnavailableError
            ? err.message
            : err instanceof Error
              ? err.message
              : t('admin.retentionFetchFail'),
        )
      })
      .finally(() => setRetentionLoading(false))
  }

  const backendOk = health?.status === 'ok'

  return (
    <>
      <PageHeader
        title={t('admin.systemTitle')}
        subtitle={
          health
            ? t('admin.systemSubtitleLive', {
                version: health.version,
                storage: health.storage,
                rag: health.rag,
              })
            : loading
              ? t('admin.systemSubtitleLoading')
              : t('admin.systemSubtitleIdle')
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={loadHealth} disabled={loading}>
              {t('common.refresh')}
            </Button>
            {backendOk ? (
              <span className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" /> {t('admin.apiLive')}
              </span>
            ) : (
              <span className="flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                <AlertTriangle className="h-3.5 w-3.5" /> {healthError ? t('admin.apiDown') : t('admin.healthPending')}
              </span>
            )}
          </div>
        }
      />

      <div className="mb-5 overflow-hidden rounded-[1.25rem] bg-gradient-to-r from-slate-950 via-emerald-950 to-slate-900 px-5 py-4 text-white shadow-soft">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/90">{t('admin.systemTitle')}</p>
        <p className="mt-1 text-sm text-slate-300">
          {health
            ? t('admin.systemSubtitleLive', {
                version: health.version,
                storage: health.storage,
                rag: health.rag,
              })
            : loading
              ? t('admin.systemSubtitleLoading')
              : t('admin.systemSubtitleIdle')}
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader title="FastAPI /health" subtitle="Canlı backend durumu (Vite proxy → :8000)" icon={<Server className="h-5 w-5" />} />
        {loading && !health && !healthError && (
          <p className="px-5 pb-5 text-sm text-slate-500">Sorgulanıyor…</p>
        )}
        {healthError && (
          <p className="px-5 pb-5 text-sm text-amber-800">{healthError}</p>
        )}
        {health && (
          <dl className="grid gap-3 px-5 pb-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-xs text-slate-500">status</dt><dd className="font-mono font-medium text-navy-900">{health.status}</dd></div>
            <div><dt className="text-xs text-slate-500">mode</dt><dd className="font-mono font-medium text-navy-900">{health.mode}</dd></div>
            <div><dt className="text-xs text-slate-500">version</dt><dd className="font-mono font-medium text-navy-900">{health.version}</dd></div>
            <div><dt className="text-xs text-slate-500">storage</dt><dd className="font-mono font-medium text-navy-900">{health.storage}</dd></div>
            <div><dt className="text-xs text-slate-500">rag</dt><dd className="font-mono font-medium text-navy-900">{health.rag}</dd></div>
            <div><dt className="text-xs text-slate-500">job_backend</dt><dd className="font-mono font-medium text-navy-900">{health.job_backend}</dd></div>
            <div><dt className="text-xs text-slate-500">auth_enabled</dt><dd className="font-mono font-medium text-navy-900">{String(health.auth_enabled)}</dd></div>
            <div><dt className="text-xs text-slate-500">vision_endpoint</dt><dd className="font-mono font-medium text-navy-900">{String(health.vision_endpoint)}</dd></div>
            {health.deployment_mode != null ? (
              <div><dt className="text-xs text-slate-500">deployment_mode</dt><dd className="font-mono font-medium text-navy-900">{health.deployment_mode}</dd></div>
            ) : null}
            {health.smtp_configured != null ? (
              <div><dt className="text-xs text-slate-500">smtp_configured</dt><dd className="font-mono font-medium text-navy-900">{String(health.smtp_configured)}</dd></div>
            ) : null}
            {health.demo_apis_enabled != null ? (
              <div><dt className="text-xs text-slate-500">demo_apis_enabled</dt><dd className="font-mono font-medium text-navy-900">{String(health.demo_apis_enabled)}</dd></div>
            ) : null}
            {health.self_registration_enabled != null ? (
              <div><dt className="text-xs text-slate-500">self_registration_enabled</dt><dd className="font-mono font-medium text-navy-900">{String(health.self_registration_enabled)}</dd></div>
            ) : null}
            {health.rate_limit_backend != null ? (
              <div><dt className="text-xs text-slate-500">rate_limit_backend</dt><dd className="font-mono font-medium text-navy-900">{health.rate_limit_backend}</dd></div>
            ) : null}
            {health.vlm_enabled != null ? (
              <div><dt className="text-xs text-slate-500">vlm_enabled</dt><dd className="font-mono font-medium text-navy-900">{String(health.vlm_enabled)}</dd></div>
            ) : null}
            {health.llm_provider != null ? (
              <div><dt className="text-xs text-slate-500">llm_provider</dt><dd className="font-mono font-medium text-navy-900">{health.llm_provider}</dd></div>
            ) : null}
            {health.sqlite_path ? (
              <div className="sm:col-span-2"><dt className="text-xs text-slate-500">sqlite_path</dt><dd className="break-all font-mono text-xs text-navy-800">{health.sqlite_path}</dd></div>
            ) : null}
            {health.quarantine_root ? (
              <div className="sm:col-span-2"><dt className="text-xs text-slate-500">quarantine_root</dt><dd className="break-all font-mono text-xs text-navy-800">{health.quarantine_root}</dd></div>
            ) : null}
            {health.note ? (
              <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs text-slate-500">note</dt><dd className="text-slate-600">{health.note}</dd></div>
            ) : null}
          </dl>
        )}
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="AI Model Readiness"
          subtitle="Configured adapters · capabilities · availability (no real inference loaded)"
          icon={<BrainCircuit className="h-5 w-5" />}
        />
        {loading && !readiness && !readinessError && (
          <p className="px-5 pb-5 text-sm text-slate-500">Model registry sorgulanıyor…</p>
        )}
        {readinessError && <p className="px-5 pb-5 text-sm text-amber-800">{readinessError}</p>}
        {readiness && (
          <>
            <p className="px-5 pb-3 text-xs text-slate-500">
              {readiness.enabled_count}/{readiness.model_count} enabled · blockers=
              {readiness.models_with_blockers ?? 0} · pixel_default=
              {String(readiness.pixel_analysis_default)} · {readiness.note}
            </p>
            <div className="overflow-x-auto px-2 pb-4">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className="th">Model</th>
                    <th className="th">Kind</th>
                    <th className="th">Modalities / Regions</th>
                    <th className="th">Capabilities</th>
                    <th className="th">Availability</th>
                    <th className="th">Blockers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {readiness.models.map((m) => (
                    <tr key={m.model_id}>
                      <td className="td">
                        <p className="font-mono text-xs font-medium text-navy-900">{m.model_id}</p>
                        <p className="text-[11px] text-slate-500">v{m.version} · {m.source_kind}{m.enabled ? '' : ' · disabled'}</p>
                      </td>
                      <td className="td font-mono text-xs">{m.adapter_kind}</td>
                      <td className="td text-xs text-slate-600">
                        {(m.modalities.length ? m.modalities.join(', ') : '—') +
                          ' / ' +
                          (m.body_regions.length ? m.body_regions.join(', ') : '—')}
                      </td>
                      <td className="td text-xs text-slate-600">
                        {m.task_capabilities.join(', ') || '—'}
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          in: {m.input_requirements.join(', ') || '—'}
                          {m.allows_pixel_analysis ? ' · pixels allowed' : ' · pixels deny'}
                        </span>
                      </td>
                      <td className="td">
                        <span
                          className={
                            m.availability === 'available' || m.availability === 'configured'
                              ? 'text-emerald-700'
                              : m.availability === 'synthetic'
                                ? 'text-slate-600'
                                : 'text-amber-800'
                          }
                        >
                          {m.availability}
                        </span>
                      </td>
                      <td className="td text-[11px] text-amber-900">
                        {(m.blockers || []).length ? (m.blockers || []).join(', ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(readiness.remaining_steps_to_first_real_model || []).length > 0 && (
              <div className="border-t border-slate-100 px-5 py-3">
                <p className="text-xs font-semibold text-navy-900">İlk gerçek modele kalan adımlar</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] text-slate-600">
                  {readiness.remaining_steps_to_first_real_model!.slice(0, 6).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </Card>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-200">
          {t('admin.demoFiction')}
        </span>
        <p className="text-xs text-slate-500">{t('admin.servicesDemoNote')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SERVICES.map((s) => (
          <Card key={s.key} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-navy-900">{t(`services.${s.key}`)}</p>
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                {t('admin.illustrative')}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{t(`services.${s.detailKey}`)}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={t('admin.gpuTitle')}
            subtitle={t('admin.gpuSubtitle')}
            icon={<Cpu className="h-5 w-5" />}
          />
          <div className="px-5 pb-5">
            <div
              className="flex flex-col items-center justify-center rounded-xl border border-dashed border-amber-200 bg-amber-50/40 px-4 text-center"
              style={{ height: 140 }}
            >
              <p className="text-sm font-medium text-amber-950">{t('dashboard.gpuTelemetryUnavailable')}</p>
              <p className="mt-1 text-xs text-amber-800/80">{t('dashboard.gpuTelemetryHint')}</p>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <StatCard
            label="Ortalama yanıt süresi"
            value="—"
            icon={<Timer className="h-5 w-5" />}
            tone="amber"
            hint="not configured · canlı p95 yok"
          />
          <StatCard
            label="Üretim hızı"
            value="—"
            icon={<Zap className="h-5 w-5" />}
            tone="teal"
            hint="not configured · token/s telemetrisi yok"
          />
          <StatCard
            label="Kuyruktaki iş"
            value={health?.job_backend ? String(health.job_backend) : '—'}
            icon={<ListOrdered className="h-5 w-5" />}
            tone="violet"
            hint={
              health?.job_backend
                ? `job_backend=${health.job_backend} (health)`
                : 'not configured · kuyruk derinliği bilinmiyor'
            }
          />
        </div>
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Veri saklama (retention)"
          subtitle="Dry-run plan · onaylı apply (immutable raporlar korunur)"
          icon={<Timer className="h-5 w-5" />}
        />
        <div className="flex flex-wrap gap-2 px-5 pb-3">
          <Button variant="secondary" size="sm" disabled={retentionLoading} onClick={loadRetentionDryRun}>
            {retentionLoading ? 'Plan alınıyor…' : 'Dry-run plan'}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!retentionPlan || retentionLoading}
            onClick={() => setApplyOpen(true)}
          >
            Apply (onaylı)
          </Button>
        </div>
        {retentionError && <p className="px-5 pb-4 text-sm text-amber-800">{retentionError}</p>}
        {retentionPlan && (
          <dl className="grid gap-2 px-5 pb-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">planned actions</dt>
              <dd className="font-mono">{retentionPlan.planned.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">blocked</dt>
              <dd className="font-mono">{retentionPlan.skipped_blocked.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">temp cleanup (dry-run)</dt>
              <dd className="font-mono">{retentionPlan.temp_cleanup_would_remove ?? '—'}</dd>
            </div>
            {retentionPlan.policy && (
              <div className="sm:col-span-2 text-xs text-slate-600">
                policy: dicom_days={String(retentionPlan.policy.dicom_days)} · reports_days=
                {String(retentionPlan.policy.reports_days)} · temp_hours={retentionPlan.policy.temp_hours}
              </div>
            )}
          </dl>
        )}
      </Card>

      <Modal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        title="Retention apply onayı"
      >
        <p className="text-sm text-slate-700">
          Bu işlem yapılandırılmış saklama politikasını uygular. Onaylı / immutable raporlar bloklanır; yine de yalnızca
          staging ortamında çalıştırın.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setApplyOpen(false)}>
            Vazgeç
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={applying}
            onClick={() => {
              setApplying(true)
              void applyRetentionPlan()
                .then((res) => {
                  setRetentionPlan(res)
                  setApplyOpen(false)
                })
                .catch((err) =>
                  setRetentionError(err instanceof Error ? err.message : t('admin.retentionApplyFail')),
                )
                .finally(() => setApplying(false))
            }}
          >
            {applying ? 'Uygulanıyor…' : 'Apply onayla'}
          </Button>
        </div>
      </Modal>

      <Card className="mt-6">
        <CardHeader title={t('admin.deploymentsTitle')} subtitle={t('admin.deploymentsEmptySub')} icon={<Rocket className="h-5 w-5" />} />
        <p className="px-5 pb-5 text-sm text-slate-500">{t('admin.deploymentsEmptyBody')}</p>
      </Card>
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <Gauge className="h-3.5 w-3.5" /> Canlı durum için /health ve model readiness panellerini kullanın.
      </p>
    </>
  )
}
