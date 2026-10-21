import { Activity, CheckCircle2, Cpu, Gauge, Rocket, Thermometer, Timer, Zap, AlertTriangle, ListOrdered } from 'lucide-react'
import { Card, CardHeader, StatCard } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { DEPLOYMENTS, SERVICES } from '../data/mock'
import { GpuChart } from './Dashboard'
import { fmtDate } from '../lib/format'

export default function SystemStatus() {
  const vramUsed = 29.4
  const vramTotal = 48
  return (
    <>
      <PageHeader title="Sistem Durumu" subtitle="Son güncelleme: az önce · mock izleme verisi" actions={<span className="flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200"><AlertTriangle className="h-3.5 w-3.5" /> 1 serviste yüksek yük</span>} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SERVICES.map((s) => (
          <Card key={s.name} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-navy-900">{s.name}</p>
              {s.status === 'ok' ? (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Çalışıyor</span>
              ) : (
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" /> Yüksek yük</span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">{s.detail}</p>
            <p className="mt-3 text-xs text-slate-500">Gecikme: <span className="font-mono font-medium text-navy-800">{s.latency}</span></p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="NVIDIA GPU #0" subtitle="gpu-node-01 · kullanım % (son 1 saat)" icon={<Cpu className="h-5 w-5" />} />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <p className="mb-1 flex justify-between text-sm"><span className="text-slate-500">VRAM</span><span className="font-mono font-medium text-navy-900">{vramUsed} / {vramTotal} GB</span></p>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-navy-600" style={{ width: `${(vramUsed / vramTotal) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-slate-400">vetmind-neuro-v0.1 + LoRA adaptörü + KV önbellek</p>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
              <Thermometer className="h-6 w-6 text-orange-500" />
              <div>
                <p className="text-xs text-slate-500">Sıcaklık</p>
                <p className="text-lg font-semibold text-navy-900">71 °C</p>
              </div>
            </div>
          </div>
          <div className="px-3 pb-4">
            <GpuChart height={220} />
          </div>
        </Card>

        <div className="space-y-4">
          <StatCard label="Ortalama yanıt süresi" value="2.4 sn" icon={<Timer className="h-5 w-5" />} tone="amber" hint="p95: 4.1 sn · hedef < 3 sn" />
          <StatCard label="Üretim hızı" value="38 token/s" icon={<Zap className="h-5 w-5" />} tone="teal" hint="Batch boyutu: 4" />
          <StatCard label="Kuyruktaki iş" value="3" icon={<ListOrdered className="h-5 w-5" />} tone="violet" hint="2 belge işleme · 1 LLM çıkarımı" />
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="Son dağıtımlar" icon={<Rocket className="h-5 w-5" />} />
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
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-400"><Gauge className="h-3.5 w-3.5" /> İzleme verileri demo amaçlıdır; ilerleyen aşamada Prometheus/Grafana entegrasyonu planlanmaktadır.</p>
    </>
  )
}
