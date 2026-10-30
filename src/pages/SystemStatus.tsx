import { useEffect, useState } from 'react'
import { Activity, CheckCircle2, Cpu, Gauge, Rocket, Thermometer, Timer, Zap, AlertTriangle, ListOrdered, Server, RefreshCw, BrainCircuit } from 'lucide-react'
import { Card, CardHeader, StatCard } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { DEPLOYMENTS, SERVICES } from '../data/mock'
import { fmtDate } from '../lib/format'
import {
  BackendUnavailableError,
  fetchBackendHealth,
  fetchModelReadiness,
  type BackendHealth,
  type BackendModelReadiness,
} from '../lib/backend'

export default function SystemStatus() {
  const vramUsed = 29.4
  const vramTotal = 48
  const [health, setHealth] = useState<BackendHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [readiness, setReadiness] = useState<BackendModelReadiness | null>(null)
  const [readinessError, setReadinessError] = useState<string | null>(null)

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
                : 'Health alınamadı',
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
                : 'Model readiness alınamadı',
          )
        }),
    ]).finally(() => setLoading(false))
  }

  useEffect(() => {
    loadHealth()
  }, [])

  const backendOk = health?.status === 'ok'

  return (
    <>
      <PageHeader
        title="Sistem Durumu"
        subtitle={
          health
            ? `Backend /health · v${health.version} · storage=${health.storage} · rag=${health.rag}`
            : loading
              ? 'Backend /health sorgulanıyor…'
              : 'Son güncelleme: az önce · canlı health'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={loadHealth} disabled={loading}>
              Yenile
            </Button>
            {backendOk ? (
              <span className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" /> API canlı
              </span>
            ) : (
              <span className="flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                <AlertTriangle className="h-3.5 w-3.5" /> {healthError ? 'API yok' : 'Health bekleniyor'}
              </span>
            )}
          </div>
        }
      />

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
          DEMO FICTION
        </span>
        <p className="text-xs text-slate-500">
          Aşağıdaki servis / GPU / dağıtım kartları illustrative’dır; canlı durum için yalnızca /health ve model readiness kullanın.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SERVICES.map((s) => (
          <Card key={s.name} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-navy-900">{s.name}</p>
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                Illustrative
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{s.detail}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="GPU telemetri"
            subtitle="DEMO FICTION · gerçek VRAM telemetrisi yok"
            icon={<Cpu className="h-5 w-5" />}
          />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <p className="mb-1 flex justify-between text-sm">
                <span className="text-slate-500">VRAM</span>
                <span className="font-mono font-medium text-slate-500">— / —</span>
              </p>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-0 rounded-full bg-slate-300" />
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
              <Thermometer className="h-6 w-6 text-slate-400" />
              <div>
                <p className="text-xs text-slate-500">Sıcaklık</p>
                <p className="text-lg font-semibold text-slate-500">—</p>
              </div>
            </div>
          </div>
          <div className="border-t border-dashed border-slate-200 px-5 py-6 text-center text-sm text-slate-500">
            GpuChart gizlendi — sahte kullanım eğrisi jüri yanılsaması yaratıyordu.
            <span className="mt-1 block text-xs text-slate-400">
              (Eski demo değerler: {vramUsed}/{vramTotal} GB — kullanılmıyor)
            </span>
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

      <Card className="mt-6">
        <CardHeader title="Son dağıtımlar" subtitle="DEMO FICTION · mock changelog" icon={<Rocket className="h-5 w-5" />} />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/70">
              <tr>
                <th className="th">Sürüm</th>
                <th className="th">Tür</th>
                <th className="th">Tarih</th>
                <th className="th">Dağıtan</th>
                <th className="th">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {DEPLOYMENTS.map((d) => (
                <tr key={d.version}>
                  <td className="td font-mono text-xs font-medium">{d.version}</td>
                  <td className="td">{d.kind}</td>
                  <td className="td text-slate-500">{fmtDate(d.date)}</td>
                  <td className="td">{d.by}</td>
                  <td className="td">
                    {d.status === 'Başarılı' ? (
                      <span className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Başarılı</span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-orange-700"><Activity className="h-4 w-4" /> {d.status}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <Gauge className="h-3.5 w-3.5" /> Canlı durum için /health ve model readiness panellerini kullanın.
      </p>
    </>
  )
}
