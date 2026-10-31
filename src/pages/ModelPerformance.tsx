import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Bot, CheckCircle2, ClipboardCheck, FlaskConical, Languages, PenLine, RefreshCw, Sparkles } from 'lucide-react'
import { Card, CardHeader, StatCard } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { useLocale } from '../context/LocaleContext'
import {
  fetchLatestLlmEval,
  fetchLlmFeedback,
  fetchLlmStatus,
  type LlmEvalResult,
  type LlmEvalRun,
  type LlmFeedbackSummary,
  type LlmStatus,
} from '../lib/backend'

const EVAL_ROW_KEYS: { key: string; fmt: 'pct' | 'num' | 'sec' | 'score'; better: 'high' | 'low' }[] = [
  { key: 'score', fmt: 'score', better: 'high' },
  { key: 'score_std', fmt: 'score', better: 'low' },
  { key: 'case_score_std', fmt: 'score', better: 'low' },
  { key: 'success_rate', fmt: 'pct', better: 'high' },
  { key: 'citation_coverage', fmt: 'pct', better: 'high' },
  { key: 'finding_coverage', fmt: 'pct', better: 'high' },
  { key: 'differential_recall', fmt: 'pct', better: 'high' },
  { key: 'must_mention_recall', fmt: 'pct', better: 'high' },
  { key: 'overclaim_cases', fmt: 'num', better: 'low' },
  { key: 'forbidden_cases', fmt: 'num', better: 'low' },
  { key: 'unknown_refs', fmt: 'num', better: 'low' },
  { key: 'blank_cases', fmt: 'num', better: 'low' },
  { key: 'english_ratio', fmt: 'pct', better: 'low' },
  { key: 'latency_s', fmt: 'sec', better: 'low' },
  { key: 'verified_supported_rate', fmt: 'pct', better: 'high' },
  { key: 'verified_problems', fmt: 'score', better: 'low' },
  { key: 'calls_per_case', fmt: 'score', better: 'low' },
  { key: 'repair_applied_rate', fmt: 'pct', better: 'low' },
]

function pct(v: number | null | undefined) {
  return v == null ? '—' : `%${Math.round(v * 100)}`
}

function fmt(v: number | null | undefined, kind: (typeof EVAL_ROW_KEYS)[number]['fmt'], locale: string) {
  if (v == null) return '—'
  if (kind === 'pct') return pct(v)
  if (kind === 'sec') return locale.startsWith('en') ? `${v.toFixed(1)} s` : `${v.toFixed(1)} sn`
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
  const { t, intlLocale } = useLocale()
  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [feedback, setFeedback] = useState<LlmFeedbackSummary | null>(null)
  const [evalResult, setEvalResult] = useState<LlmEvalResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const evalRows = useMemo(
    () =>
      EVAL_ROW_KEYS.map((row) => ({
        ...row,
        label: t(`admin.evalMetrics.${row.key}`),
      })),
    [t],
  )

  const load = () => {
    setLoading(true)
    setError(null)
    Promise.all([fetchLlmStatus(), fetchLlmFeedback(), fetchLatestLlmEval()])
      .then(([s, f, e]) => {
        setStatus(s)
        setFeedback(f)
        setEvalResult(e)
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('admin.loadDataFail')))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const approved = feedback?.by_decision.approved ?? 0
  const models = Object.values(feedback?.models ?? {})
  const unedited = models.reduce((sum, m) => sum + m.approved_unedited_rate * m.reviews, 0)
  const sectionData = Object.entries(feedback?.sections ?? {}).map(([k, v]) => ({
    name: t(`admin.evalSection.${k}`) !== `admin.evalSection.${k}` ? t(`admin.evalSection.${k}`) : k,
    oran: v.edited_rate == null ? 0 : Math.round(v.edited_rate * 100),
  }))
  const runs = evalResult?.runs ?? []
  const caseIds = Array.from(new Set(runs.flatMap((r) => r.cases.map((c) => c.case_id))))
  const repeats = Math.max(1, ...runs.map((r) => r.repeats ?? 1))
  const topRate = Math.max(0, ...sectionData.map((d) => d.oran))
  const mostEdited = feedback?.reviews && topRate > 0
    ? sectionData.filter((d) => d.oran === topRate).map((d) => d.name).join(' · ')
    : t('common.dash')

  const decisionHint = feedback
    ? Object.entries(feedback.by_decision)
        .map(([k, v]) => `${t(`admin.evalDecision.${k}`) !== `admin.evalDecision.${k}` ? t(`admin.evalDecision.${k}`) : k}: ${v}`)
        .join(' · ')
    : undefined

  return (
    <>
      <PageHeader
        title={t('admin.modelPerfTitle')}
        subtitle={t('admin.modelPerfSubtitle')}
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={load} disabled={loading}>
            {t('common.refresh')}
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
          <CardHeader title={t('admin.activeReportModel')} icon={<Bot className="h-5 w-5" />} />
          <dl className="grid gap-4 px-5 pb-5 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-slate-500">{t('admin.provider')}</dt><dd className="font-medium text-navy-900">{status.provider_id}</dd></div>
            <div><dt className="text-xs text-slate-500">{t('admin.model')}</dt><dd className="font-mono font-medium text-navy-900">{status.model_id}</dd></div>
            <div>
              <dt className="text-xs text-slate-500">{t('admin.prompt')}</dt>
              <dd className="font-mono font-medium text-navy-900">{status.prompt_version ?? t('admin.promptMock')}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1 text-xs text-slate-500">
                <Languages className="h-3 w-3" /> {t('admin.reportLanguage')}
              </dt>
              <dd className="font-medium uppercase text-navy-900">{status.report_language}</dd>
            </div>
          </dl>
        </Card>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('admin.expertFeedback')}</h2>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('admin.reviewedDrafts')} value={feedback?.reviews ?? t('common.dash')} icon={<ClipboardCheck className="h-4 w-4" />} tone="navy" />
        <StatCard
          label={t('admin.approvalRate')}
          value={feedback?.reviews ? pct(approved / feedback.reviews) : t('common.dash')}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="emerald"
          hint={decisionHint}
        />
        <StatCard
          label={t('admin.uneditedApproval')}
          value={feedback?.reviews ? pct(unedited / feedback.reviews) : t('common.dash')}
          icon={<Sparkles className="h-4 w-4" />}
          tone="violet"
          hint={t('admin.uneditedHint')}
        />
        <StatCard
          label={t('admin.mostEditedSection')}
          value={mostEdited}
          icon={<PenLine className="h-4 w-4" />}
          tone="amber"
        />
      </div>

      <div className="mb-8 grid gap-6 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title={t('admin.sectionEditRate')} subtitle={t('admin.sectionEditRateSub')} />
          {feedback?.reviews ? (
            <div className="h-64 px-3 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sectionData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis unit="%" domain={[0, 100]} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => [`%${v}`, t('admin.editRateTooltip')]} />
                  <Bar dataKey="oran" fill="#0d9488" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={<PenLine className="h-6 w-6" />} title={t('admin.noReviewedDrafts')} text={t('admin.noReviewedDraftsText')} />
          )}
        </Card>
        <Card className="min-w-0">
          <CardHeader title={t('admin.byModelPrompt')} subtitle={t('admin.similaritySub')} />
          {models.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-2">{t('admin.colModelPrompt')}</th>
                    <th className="px-3 py-2">{t('admin.colReviews')}</th>
                    <th className="px-3 py-2">{t('admin.colApproval')}</th>
                    <th className="px-3 py-2">{t('admin.colUnedited')}</th>
                    <th className="px-3 py-2">{t('admin.colSimilarity')}</th>
                  </tr>
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
            <p className="px-5 py-6 text-sm text-slate-500">{t('admin.noData')}</p>
          )}
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{t('admin.offlineEval')}</h2>
      {runs.length ? (
        <div className="grid gap-6 xl:grid-cols-5">
          <Card className="min-w-0 xl:col-span-3">
            <CardHeader
              title={t('admin.modelCompare')}
              subtitle={`${evalResult?.set} · ${caseIds.length} vaka${repeats > 1 ? ` × ${repeats} tekrar` : ''} · prompt ${runs[0].prompt_version || t('common.dash')} · ${evalResult?.file}`}
              icon={<FlaskConical className="h-5 w-5" />}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-2">{t('admin.metricCol')}</th>
                    {runs.map((r) => <th key={r.label} className="px-3 py-2 font-mono">{r.label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {evalRows.map((row) => {
                    const values = runs.map((r) => r.summary[row.key])
                    const best = bestIndex(values, row.better)
                    return (
                      <tr key={row.key} className={row.key === 'score' ? 'font-semibold' : ''}>
                        <td className="px-5 py-2 text-slate-600">{row.label}</td>
                        {values.map((v, i) => (
                          <td key={i} className={`px-3 py-2 ${i === best ? 'text-emerald-700' : 'text-navy-900'}`}>
                            {fmt(v, row.fmt, intlLocale)}
                            {i === best && <span className="ml-1 text-[10px]">▲</span>}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">{t('admin.evalFooter')}</p>
          </Card>
          <Card className="min-w-0 xl:col-span-2">
            <CardHeader
              title={t('admin.caseScores')}
              subtitle={repeats > 1 ? t('admin.repeatsAvg', { repeats }) : undefined}
            />
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
            title={t('admin.noEvalYet')}
            text={t('admin.noEvalYetText')}
          />
        </Card>
      )}
    </>
  )
}
