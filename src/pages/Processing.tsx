import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, BookOpenCheck, Brain, CheckCircle2, Circle, Cpu, FileCog, FileText, Loader2, ShieldCheck, UserCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import { Card, CardHeader } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { StatusBadge } from '../components/StatusBadge'
import { EmptyState } from '../components/EmptyState'
import { LAYERS, PIPELINE_MS } from '../lib/pipeline'

const ICONS: Record<string, ReactNode> = {
  data: <FileCog className="h-5 w-5" />,
  rag: <BookOpenCheck className="h-5 w-5" />,
  llm: <Brain className="h-5 w-5" />,
  verify: <ShieldCheck className="h-5 w-5" />,
  report: <FileText className="h-5 w-5" />,
  expert: <UserCheck className="h-5 w-5" />,
}

export default function Processing() {
  const { id = '' } = useParams()
  const { getCase } = useApp()
  const nav = useNavigate()
  const c = getCase(id)
  const startedAt = c?.processingStartedAt
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!startedAt) return
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [startedAt])

  if (!c) return <Card><EmptyState icon={<FileText className="h-6 w-6" />} title="Vaka bulunamadı" /></Card>
  if (!c.ai) {
    return (
      <Card>
        <EmptyState icon={<Loader2 className="h-6 w-6 animate-spin" />} title="AI analizi sürüyor" text="Bu vaka için işlem hattı başka bir oturumda çalışıyor (demo verisi)." action={<Link to={`/vakalar/${c.id}`} className="text-sm font-medium text-teal-700">Vaka detayına dön</Link>} />
      </Card>
    )
  }

  const elapsed = startedAt ? Math.min(now - startedAt, PIPELINE_MS) : PIPELINE_MS
  const done = elapsed >= PIPELINE_MS
  const pct = Math.round((elapsed / PIPELINE_MS) * 100)

  return (
    <>
      <PageHeader
        title={`AI İşleme — ${c.patient.name}`}
        subtitle={`${c.no} · ${c.patient.species}, ${c.patient.breed}`}
        breadcrumb="Vakalar / AI İşleme"
        actions={<StatusBadge status={c.status} />}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-navy-800">{done ? 'İşlem hattı tamamlandı' : 'İşlem hattı çalışıyor…'}</span>
              <span className="font-mono text-slate-500">%{pct}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-navy-600 transition-[width] duration-100" style={{ width: `${pct}%` }} />
            </div>
          </Card>

          <ol className="relative space-y-3">
            {LAYERS.map((L, idx) => {
              const state = elapsed >= L.end ? 'done' : elapsed >= L.start ? 'running' : 'waiting'
              const logs = L.logs(c)
              const dur = L.end - L.start
              const visible = state === 'done' ? logs : state === 'running' ? logs.filter((_, i) => elapsed - L.start >= (i * dur) / logs.length) : []
              const layerPct = state === 'done' ? 100 : state === 'running' ? ((elapsed - L.start) / dur) * 100 : 0
              return (
                <li key={L.key}>
                  <Card className={`overflow-hidden transition ${state === 'running' ? 'ring-2 ring-teal-400' : ''} ${state === 'waiting' ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-4 px-5 py-4">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${state === 'done' ? 'bg-emerald-50 text-emerald-600' : state === 'running' ? 'bg-teal-50 text-teal-600' : 'bg-slate-100 text-slate-400'}`}>
                        {ICONS[L.key]}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-medium text-slate-400">Katman {idx + 1}</p>
                        <p className="font-semibold text-navy-900">{L.name}</p>
                      </div>
                      {state === 'done' && <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Tamamlandı</span>}
                      {state === 'running' && <span className="flex items-center gap-1.5 text-sm font-medium text-teal-600"><Loader2 className="h-4 w-4 animate-spin" /> Çalışıyor</span>}
                      {state === 'waiting' && <span className="flex items-center gap-1.5 text-sm text-slate-400"><Circle className="h-4 w-4" /> Bekliyor</span>}
                    </div>
                    <div className="h-0.5 bg-slate-100">
                      <div className={`h-full ${state === 'done' ? 'bg-emerald-400' : 'bg-teal-500'}`} style={{ width: `${layerPct}%` }} />
                    </div>
                    {visible.length > 0 && (
                      <div className="space-y-1 bg-navy-950 px-5 py-3 font-mono text-[12px] leading-relaxed text-navy-100">
                        {visible.map((l, i) => (
                          <p key={i} className="animate-fade-up">
                            <span className="text-teal-400">›</span> {l}
                          </p>
                        ))}
                      </div>
                    )}
                  </Card>
                </li>
              )
            })}
          </ol>
        </div>

        <div className="space-y-6">
          <Card className="xl:sticky xl:top-24">
            <CardHeader title="Çalışma ortamı" icon={<Cpu className="h-5 w-5" />} />
            <dl className="divide-y divide-slate-100 px-5 text-sm">
              {[
                ['LLM', c.ai.model],
                ['Embedding modeli', 'vetmind-embed-tr-v1'],
                ['Vektör DB', 'Qdrant · neuro-kb (5.036 parça)'],
                ['Çıkarım sunucusu', 'vLLM'],
                ['GPU node', 'gpu-node-01 · NVIDIA GPU #0'],
                ['İşlem süresi', `${(elapsed / 1000).toFixed(1)} sn`],
                ['Üretilen token', `${Math.round((elapsed / PIPELINE_MS) * 1184).toLocaleString('tr-TR')}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right font-medium text-navy-900">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="p-5 pt-3">
              {done ? (
                <Button size="lg" className="w-full" onClick={() => nav(`/vakalar/${c.id}?tab=ai`)}>
                  Ön değerlendirmeyi görüntüle <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <p className="flex items-center justify-center gap-2 rounded-lg bg-slate-50 py-3 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Analiz sürüyor…
                </p>
              )}
              <p className="mt-3 text-center text-[11px] text-slate-400">Demo: işlem hattı simüle edilmektedir.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
