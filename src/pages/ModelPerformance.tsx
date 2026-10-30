import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Bot, CheckCircle2, ClipboardCheck, FlaskConical, Languages, PenLine, RefreshCw, Sparkles } from 'lucide-react'
import { Card, CardHeader, StatCard } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import {
  fetchLatestLlmEval,
  fetchLlmFeedback,
  fetchLlmStatus,
  type LlmEvalResult,
  type LlmEvalRun,
  type LlmFeedbackSummary,
  type LlmStatus,
} from '../lib/backend'

const SECTION_TR: Record<string, string> = {
  technique: 'Teknik',
  findings: 'Bulgular',
  impression: 'Yorum',
  recommendations: 'Öneriler',
}

const DECISION_TR: Record<string, string> = {
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  revision_requested: 'Revizyon istendi',
}

// Same rows and formats as backend/app/evaluation/llm_eval.py METRIC_ROWS.
const EVAL_ROWS: { key: string; label: string; fmt: 'pct' | 'num' | 'sec' | 'score'; better: 'high' | 'low' }[] = [
  { key: 'score', label: 'Toplam skor (0–100)', fmt: 'score', better: 'high' },
  { key: 'score_std', label: 'Skor sapması — tekrarlar arası (±)', fmt: 'score', better: 'low' },
  { key: 'case_score_std', label: 'Vaka içi ortalama sapma (±)', fmt: 'score', better: 'low' },
  { key: 'success_rate', label: 'Başarılı üretim', fmt: 'pct', better: 'high' },
  { key: 'citation_coverage', label: 'Kaynaklı cümle oranı', fmt: 'pct', better: 'high' },
  { key: 'finding_coverage', label: 'Bulgu kapsama', fmt: 'pct', better: 'high' },
  { key: 'differential_recall', label: 'Beklenen tanı yakalama', fmt: 'pct', better: 'high' },
  { key: 'must_mention_recall', label: 'Zorunlu içerik', fmt: 'pct', better: 'high' },
  { key: 'overclaim_cases', label: 'Aşırı iddialı vaka', fmt: 'num', better: 'low' },
  { key: 'forbidden_cases', label: 'Yasak ifade içeren vaka', fmt: 'num', better: 'low' },
  { key: 'unknown_refs', label: 'Geçersiz atıf', fmt: 'num', better: 'low' },
  { key: 'blank_cases', label: 'Bölüm boş bırakılan vaka', fmt: 'num', better: 'low' },
  { key: 'english_ratio', label: 'İngilizce kelime oranı', fmt: 'pct', better: 'low' },
  { key: 'latency_s', label: 'Ortalama süre', fmt: 'sec', better: 'low' },
  { key: 'calls_per_case', label: 'Vaka başına model çağrısı', fmt: 'score', better: 'low' },
  { key: 'repair_applied_rate', label: 'Onarım uygulanan vaka', fmt: 'pct', better: 'low' },
]

function pct(v: number | null | undefined) {
  return v == null ? '—' : `%${Math.round(v * 100)}`
}

function fmt(v: number | null | undefined, kind: (typeof EVAL_ROWS)[number]['fmt']) {
  if (v == null) return '—'
  if (kind === 'pct') return pct(v)
  if (kind === 'sec') return `${v.toFixed(1)} sn`
  if (kind === 'score') return v.toFixed(1)
  return String(Math.round(v))
}

function meanCaseScore(run: LlmEvalRun, caseId: string) {
  const scores = run.cases.filter((c) => c.case_id === caseId).map((c) => c.score ?? 0)
  return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0
}

function bestIndex(values: (number | null | undefined)[], better: 'high' | 'low') {
  const nums = values.map((v) => (v == null ? null : v))
  const valid = nums.filter((v): v is number => v != null)
  if (valid.length < 2) return -1
  const target = better === 'high' ? Math.max(...valid) : Math.min(...valid)
  return valid.filter((v) => v === target).length === 1 ? nums.indexOf(target) : -1
}

export default function ModelPerformance() {
  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [feedback, setFeedback] = useState<LlmFeedbackSummary | null>(null)
  const [evalResult, setEvalResult] = useState<LlmEvalResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    setError(null)
    Promise.all([fetchLlmStatus(), fetchLlmFeedback(), fetchLatestLlmEval()])
      .then(([s, f, e]) => {
        setStatus(s)
        setFeedback(f)
        setEvalResult(e)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Veriler alınamadı'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const approved = feedback?.by_decision.approved ?? 0
  const models = Object.values(feedback?.models ?? {})
  const unedited = models.reduce((sum, m) => sum + m.approved_unedited_rate * m.reviews, 0)
  const sectionData = Object.entries(feedback?.sections ?? {}).map(([k, v]) => ({
    name: SECTION_TR[k] ?? k,
    oran: v.edited_rate == null ? 0 : Math.round(v.edited_rate * 100),
  }))
  const runs = evalResult?.runs ?? []
  const caseIds = Array.from(new Set(runs.flatMap((r) => r.cases.map((c) => c.case_id))))
  const repeats = Math.max(1, ...runs.map((r) => r.repeats ?? 1))
  const topRate = Math.max(0, ...sectionData.map((d) => d.oran))
  const mostEdited = feedback?.reviews && topRate > 0
    ? sectionData.filter((d) => d.oran === topRate).map((d) => d.name).join(' · ')
    : '—'

  return (
    <>
      <PageHeader
        title="Model Performansı"
        subtitle="Rapor modeli · uzman geri bildirimi · çevrimdışı değerlendirme"
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={load} disabled={loading}>
            Yenile
          </Button>
        }
      />

      {error && (
        <Card className="mb-6 border-amber-200 p-4 text-sm text-amber-900">
          {error}
        </Card>
      )}

      {status && (
        <Card className="mb-6">
          <CardHeader title="Aktif rapor modeli" icon={<Bot className="h-5 w-5" />} />
          <dl className="grid gap-4 px-5 pb-5 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Sağlayıcı</dt><dd className="font-medium text-navy-900">{status.provider_id}</dd></div>
            <div><dt className="text-xs text-slate-500">Model</dt><dd className="font-mono font-medium text-navy-900">{status.model_id}</dd></div>
            <div>
              <dt className="text-xs text-slate-500">Prompt</dt>
              <dd className="font-mono font-medium text-navy-900">{status.prompt_version ?? 'şablon (mock)'}</dd>
            </div>
            <div><dt className="flex items-center gap-1 text-xs text-slate-500"><Languages className="h-3 w-3" /> Rapor dili</dt><dd className="font-medium uppercase text-navy-900">{status.report_language}</dd></div>
          </dl>
        </Card>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Uzman geri bildirimi</h2>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="İncelenen taslak" value={feedback?.reviews ?? '—'} icon={<ClipboardCheck className="h-4 w-4" />} tone="navy" />
        <StatCard
          label="Onay oranı"
          value={feedback?.reviews ? pct(approved / feedback.reviews) : '—'}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="emerald"
          hint={feedback ? Object.entries(feedback.by_decision).map(([k, v]) => `${DECISION_TR[k] ?? k}: ${v}`).join(' · ') : undefined}
        />
        <StatCard
          label="Düzeltmesiz onay"
          value={feedback?.reviews ? pct(unedited / feedback.reviews) : '—'}
          icon={<Sparkles className="h-4 w-4" />}
          tone="violet"
          hint="Uzman hiçbir bölümü değiştirmeden onayladı"
        />
        <StatCard
          label="En çok düzeltilen bölüm"
          value={mostEdited}
          icon={<PenLine className="h-4 w-4" />}
          tone="amber"
        />
      </div>

      <div className="mb-8 grid gap-6 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="Bölüm bazında düzeltme oranı" subtitle="Uzmanın model metnini değiştirdiği incelemelerin payı" />
          {feedback?.reviews ? (
            <div className="h-64 px-3 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sectionData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis unit="%" domain={[0, 100]} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => [`%${v}`, 'Düzeltme oranı']} />
                  <Bar dataKey="oran" fill="#0d9488" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={<PenLine className="h-6 w-6" />} title="Henüz incelenmiş taslak yok" text="Uzman bir taslağı onayladığında, reddettiğinde ya da revizyon istediğinde burada görünür." />
          )}
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Model / prompt bazında" subtitle="Benzerlik: model metni ile uzmanın imzaladığı metin (1.0 = değişmedi)" />
          {models.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr><th className="px-5 py-2">Model @ prompt</th><th className="px-3 py-2">İnceleme</th><th className="px-3 py-2">Onay</th><th className="px-3 py-2">Düzeltmesiz</th><th className="px-3 py-2">Benzerlik</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(feedback?.models ?? {}).map(([name, m]) => (
                    <tr key={name}>
                      <td className="px-5 py-2 font-mono text-xs text-navy-900">{name}</td>
                      <td className="px-3 py-2">{m.reviews}</td>
                      <td className="px-3 py-2">{pct(m.approved_rate)}</td>
                      <td className="px-3 py-2">{pct(m.approved_unedited_rate)}</td>
                      <td className="px-3 py-2">{m.mean_similarity.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-6 text-sm text-slate-500">Veri yok.</p>
          )}
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Çevrimdışı değerlendirme</h2>
      {runs.length ? (
        <div className="grid gap-6 xl:grid-cols-5">
          <Card className="min-w-0 xl:col-span-3">
            <CardHeader
              title="Model karşılaştırması"
              subtitle={`${evalResult?.set} · ${caseIds.length} vaka${repeats > 1 ? ` × ${repeats} tekrar` : ''} · prompt ${runs[0].prompt_version || '—'} · ${evalResult?.file}`}
              icon={<FlaskConical className="h-5 w-5" />}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-2">Metrik</th>
                    {runs.map((r) => <th key={r.label} className="px-3 py-2 font-mono">{r.label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {EVAL_ROWS.map((row) => {
                    const values = runs.map((r) => r.summary[row.key])
                    const best = bestIndex(values, row.better)
                    return (
                      <tr key={row.key} className={row.key === 'score' ? 'font-semibold' : ''}>
                        <td className="px-5 py-2 text-slate-600">{row.label}</td>
                        {values.map((v, i) => (
                          <td key={i} className={`px-3 py-2 ${i === best ? 'text-emerald-700' : 'text-navy-900'}`}>
                            {fmt(v, row.fmt)}
                            {i === best && <span className="ml-1 text-[10px]">▲</span>}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">
              Skorlar atıf, kapsama ve güvenlik davranışını ölçer; klinik doğruluk değildir. Yeni ölçüm: <code>python scripts/llm_eval.py</code>
            </p>
          </Card>
          <Card className="min-w-0 xl:col-span-2">
            <CardHeader title="Vaka bazında skor" subtitle={repeats > 1 ? `${repeats} tekrarın ortalaması` : undefined} />
            <div className="h-80 px-3 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={caseIds.map((id) => ({
                    name: id,
                    ...Object.fromEntries(runs.map((r) => [r.label, meanCaseScore(r, id)])),
                  }))}
                  margin={{ top: 10, right: 10, left: 40, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {runs.map((r, i) => (
                    <Bar key={r.label} dataKey={r.label} fill={['#0d9488', '#6366f1', '#f59e0b', '#64748b'][i % 4]} radius={[0, 4, 4, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<FlaskConical className="h-6 w-6" />}
            title="Henüz değerlendirme çalıştırılmadı"
            text="backend klasöründe: python scripts/llm_eval.py --provider ollama --models llama3.2:3b"
          />
        </Card>
      )}
    </>
  )
}
