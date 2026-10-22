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
import type { VetCase } from '../types'

const ICONS: Record<string, ReactNode> = {
  data: <FileCog className="h-5 w-5" />,
  rag: <BookOpenCheck className="h-5 w-5" />,
  llm: <Brain className="h-5 w-5" />,
  verify: <ShieldCheck className="h-5 w-5" />,
  report: <FileText className="h-5 w-5" />,
  expert: <UserCheck className="h-5 w-5" />,
  route: <Cpu className="h-5 w-5" />,
  vision: <Brain className="h-5 w-5" />,
  fuse: <FileCog className="h-5 w-5" />,
  validate: <ShieldCheck className="h-5 w-5" />,
}

interface MockStep {
  key: string
  name: string
  logs: string[]
}

function backendMockSteps(c: VetCase): MockStep[] {
  const models = c.backendFindings?.contributing_model_ids?.length
    ? c.backendFindings.contributing_model_ids.join(', ')
    : c.backendFindings?.source_model_id ?? '—'
  const outcome = c.backendOutcome ?? 'unknown'
  const failed = outcome === 'failed'
  const unsupported = outcome === 'unsupported'
  return [
    {
      key: 'route',
      name: 'Model Router (kural tabanlı)',
      logs: [
        'Async analyze: demo thread worker + job poll (üretim kuyruğu değil).',
        `Yönlendirme sonucu: outcome=${outcome}`,
        c.backendJobId ? `job_id: ${c.backendJobId}` : 'job_id yok',
      ],
    },
    {
      key: 'vision',
      name: 'Mock Vision AI bağdaştırıcıları',
      logs: failed
        ? ['Mock vision adapter başarısız oldu. Bu klinik bir yorum değildir.', 'Onaylanabilir AI taslak üretilmedi.']
        : unsupported
          ? ['Desteklenmeyen modality/bölge → manuel inceleme.', 'Otomatik AI taslak üretilmedi.']
          : [`Kullanılan mock model(ler): ${models}`, 'Çıktı: yapılandırılmış sentetik bulgular (MOCK).'],
    },
    {
      key: 'fuse',
      name: 'Normalizer / Evidence Fusion',
      logs: [
        `source_kind=${c.backendFindings?.source_kind ?? 'n/a'}`,
        `bulgu sayısı=${c.backendFindings?.findings.length ?? 0}`,
        'Eksik bulgu hastalık yokluğu sayılmaz.',
      ],
    },
    {
      key: 'rag',
      name: 'Optional RAG (embedding / lexical)',
      logs: unsupported || failed
        ? ['RAG atlandı (unsupported/failed).']
        : [
            `Demo RAG citations: ${c.backendDraft?.rag_citations?.length ?? 0} pasaj`,
            c.backendDraft?.rag_note ?? 'Hash-embedding cosine (varsayılan) veya lexical — klinik kanıt sayılmaz.',
          ],
    },
    {
      key: 'llm',
      name: 'Mock LLM Gateway',
      logs: unsupported || failed
        ? ['AI draft üretilmedi (unsupported/failed politikası).']
        : [
            'MockLLMProvider şablon taslağı üretti (sentetik).',
            `Rapor durumu: ${c.backendDraft?.status ?? 'yok'}`,
          ],
    },
    {
      key: 'validate',
      name: 'Report Validator',
      logs: [
        'Yalnızca yapısal kontrol; klinik doğruluk iddiası yok.',
        ...(c.backendDraft?.validation_warnings?.slice(0, 3) ?? ['Uyarı yok veya draft yok.']),
      ],
    },
    {
      key: 'expert',
      name: 'Uzman inceleme kapısı',
      logs: [
        failed
          ? 'Durum: analiz_basarisiz — AI draft onayı kapalı.'
          : unsupported
            ? 'Durum: manuel_inceleme — AI draft onayı kapalı.'
            : 'Durum: uzman incelemesi için taslak uygun (sentetik).',
      ],
    },
  ]
}

export default function Processing() {
  const { id = '' } = useParams()
  const { getCase } = useApp()
  const nav = useNavigate()
  const c = getCase(id)
  const startedAt = c?.processingStartedAt
  const [now, setNow] = useState(Date.now())
  const isBackend = Boolean(c?.backendCaseId)

  useEffect(() => {
    if (!startedAt) return
    const t = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(t)
  }, [startedAt])

  if (!c) return <Card><EmptyState icon={<FileText className="h-6 w-6" />} title="Vaka bulunamadı" /></Card>
  if (!c.ai && !isBackend) {
    return (
      <Card>
        <EmptyState icon={<Loader2 className="h-6 w-6 animate-spin" />} title="AI analizi sürüyor" text="Bu vaka için işlem hattı başka bir oturumda çalışıyor (demo verisi)." action={<Link to={`/vakalar/${c.id}`} className="text-sm font-medium text-teal-700">Vaka detayına dön</Link>} />
      </Card>
    )
  }

  const elapsed = startedAt ? Math.min(now - startedAt, PIPELINE_MS) : PIPELINE_MS
  const done = elapsed >= PIPELINE_MS
  const pct = Math.round((elapsed / PIPELINE_MS) * 100)
  const mockSteps = isBackend ? backendMockSteps(c) : null

  return (
    <>
      <PageHeader
        title={`AI İşleme — ${c.patient.name}`}
        subtitle={`${c.no} · ${c.patient.species}, ${c.patient.breed}`}
        breadcrumb="Vakalar / AI İşleme"
        actions={<StatusBadge status={c.status} />}
      />
      {isBackend ? (
        <p className="mb-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm text-teal-900">
          FastAPI mock pipeline (async job + poll). job_id: <span className="font-mono">{c.backendJobId}</span> · outcome=
          {c.backendOutcome ?? 'pending'} · case={c.backendCaseId}. Gerçek Qdrant / vLLM / GPU kullanılmaz.
        </p>
      ) : (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Yerel prototip simülasyonu: aşağıdaki katmanlar ve ortam bilgileri tarayıcıda animasyonla üretilir; gerçek altyapı çalışmaz.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-navy-800">
                {isBackend
                  ? done
                    ? 'Mock pipeline adımları (async sonuç alındı)'
                    : 'UI animasyonu… (backend async analyze + poll tamamlandı)'
                  : done
                    ? 'Simüle işlem hattı tamamlandı'
                    : 'Simüle işlem hattı çalışıyor…'}
              </span>
              <span className="font-mono text-slate-500">%{pct}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-navy-600 transition-[width] duration-100" style={{ width: `${pct}%` }} />
            </div>
          </Card>

          {isBackend && mockSteps ? (
            <ol className="relative space-y-3">
              {mockSteps.map((step, idx) => {
                const slice = PIPELINE_MS / mockSteps.length
                const start = idx * slice
                const end = start + slice
                const state = elapsed >= end ? 'done' : elapsed >= start ? 'running' : 'waiting'
                const visible = state === 'waiting' ? [] : step.logs
                return (
                  <li key={step.key}>
                    <Card className={`overflow-hidden transition ${state === 'running' ? 'ring-2 ring-teal-400' : ''} ${state === 'waiting' ? 'opacity-60' : ''}`}>
                      <div className="flex items-center gap-4 px-5 py-4">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${state === 'done' ? 'bg-emerald-50 text-emerald-600' : state === 'running' ? 'bg-teal-50 text-teal-600' : 'bg-slate-100 text-slate-400'}`}>
                          {ICONS[step.key] ?? <Cpu className="h-5 w-5" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-medium text-slate-400">Adım {idx + 1}</p>
                          <p className="font-semibold text-navy-900">{step.name}</p>
                        </div>
                        {state === 'done' && <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Tamamlandı</span>}
                        {state === 'running' && <span className="flex items-center gap-1.5 text-sm font-medium text-teal-600"><Loader2 className="h-4 w-4 animate-spin" /> Gösteriliyor</span>}
                        {state === 'waiting' && <span className="flex items-center gap-1.5 text-sm text-slate-400"><Circle className="h-4 w-4" /> Bekliyor</span>}
                      </div>
                      {visible.length > 0 && (
                        <div className="space-y-1 bg-navy-950 px-5 py-3 font-mono text-[12px] leading-relaxed text-navy-100">
                          {visible.map((l, i) => (
                            <p key={i}><span className="text-teal-400">›</span> {l}</p>
                          ))}
                        </div>
                      )}
                    </Card>
                  </li>
                )
              })}
            </ol>
          ) : (
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
                          <p className="text-xs font-medium text-slate-400">Simüle katman {idx + 1}</p>
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
          )}
        </div>

        <div className="space-y-6">
          <Card className="xl:sticky xl:top-24">
            <CardHeader
              title={isBackend ? 'Çalışma ortamı (mock backend)' : 'Simüle çalışma ortamı'}
              icon={<Cpu className="h-5 w-5" />}
            />
            <dl className="divide-y divide-slate-100 px-5 text-sm">
              {(isBackend
                ? [
                    ['Yürütme', 'Senkron FastAPI (kuyruk yok)'],
                    ['Pipeline', 'Router → Mock Vision → Normalizer → Mock LLM → Validator'],
                    ['Vision', c.backendFindings?.source_model_id ?? '—'],
                    ['source_kind', c.backendFindings?.source_kind ?? '—'],
                    ['LLM', c.backendDraft?.generation.model_id ?? (c.backendOutcome === 'unsupported' || c.backendOutcome === 'failed' ? 'draft yok' : '—')],
                    ['Outcome', c.backendOutcome ?? '—'],
                    ['UI süresi', `${(elapsed / 1000).toFixed(1)} sn (animasyon)`],
                  ]
                : [
                    ['Mod', 'Yerel prototip simülasyonu'],
                    ['LLM (simüle etiket)', c.ai?.model ?? '—'],
                    ['Embedding', 'simüle · vetmind-embed-tr-v1 (gerçek değil)'],
                    ['Vektör DB', 'simüle · Qdrant yok'],
                    ['Çıkarım', 'simüle · vLLM/GPU yok'],
                    ['İşlem süresi', `${(elapsed / 1000).toFixed(1)} sn`],
                    ['Üretilen token', `simüle · ${Math.round((elapsed / PIPELINE_MS) * 1184).toLocaleString('tr-TR')}`],
                  ]
              ).map(([k, v]) => (
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
                  <Loader2 className="h-4 w-4 animate-spin" /> {isBackend ? 'Sonuç paneli hazırlanıyor…' : 'Simülasyon sürüyor…'}
                </p>
              )}
              <p className="mt-3 text-center text-[11px] text-slate-400">
                {isBackend
                  ? 'Klinik altyapı simülasyonu değildir. Mock AI foundation.'
                  : 'Demo: işlem hattı tarayıcıda simüle edilmektedir.'}
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
