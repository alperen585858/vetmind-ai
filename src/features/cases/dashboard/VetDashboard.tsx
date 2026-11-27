import { LocalizedLink } from '../../../shared/shell/LocalizedLink'
import { useLocalizedNavigate } from '../../../shared/hooks/useLocalizedNavigate'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  MessageSquare,
  PencilLine,
  ClipboardCheck,
  FilePlus2,
  FileText,
  FolderOpen,
  Hourglass,
  Timer,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../../shared/shell/AppContext'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { Card, CardHeader } from '../../../shared/ui/Card'
import { CaseTable } from '../../../shared/ui/CaseTable'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { getClinicDashboard } from '../../../shared/api'
import { AnalysisTasksBanner } from '../../analysis/AnalysisTaskWidgets'
import { AWAITING_REPORT_FILTER, isAwaitingReport } from '../lib/caseStatusMap'
import { buildTrend } from '../../../shared/lib/trend'
import type { ClinicDashboardStats, VetCase } from '../../../shared/types'


const TODO_META: Record<TodoKind, { key: string; icon: JSX.Element; tone: string }> = {
  failed: { key: 'dashboard.todoFailed', icon: <AlertTriangle className="h-4 w-4" aria-hidden />, tone: 'bg-rose-100 text-rose-700' },
  messages: { key: 'dashboard.todoMessages', icon: <MessageSquare className="h-4 w-4" aria-hidden />, tone: 'bg-sky-100 text-sky-700' },
  report: { key: 'dashboard.todoReport', icon: <FileText className="h-4 w-4" aria-hidden />, tone: 'bg-emerald-100 text-emerald-700' },
  draft: { key: 'dashboard.todoDraft', icon: <PencilLine className="h-4 w-4" aria-hidden />, tone: 'bg-amber-100 text-amber-700' },
}


/** "27.11.2026 Cuma" for the top-left corner of the welcome card. */
function formatClinicDate(intlLocale: string, d = new Date()) {
  const date = d.toLocaleDateString(intlLocale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const weekday = d.toLocaleDateString(intlLocale, { weekday: 'long' })
  return `${date} ${weekday}`
}

type TodoKind = 'failed' | 'messages' | 'report' | 'draft'

/** What the vet has to do next, most pressing first (from the synced case list). */
export function buildVetTodos(cases: VetCase[]): { kind: TodoKind; c: VetCase }[] {
  const out: { kind: TodoKind; c: VetCase }[] = []
  for (const c of cases) {
    if (c.status === 'analiz_basarisiz') out.push({ kind: 'failed', c })
    else if ((c.unreadMessages ?? 0) > 0) out.push({ kind: 'messages', c })
    else if (c.status === 'onaylandi' && !c.reportDeliveredAt) out.push({ kind: 'report', c })
    else if (c.status === 'taslak') out.push({ kind: 'draft', c })
  }
  const rank: Record<TodoKind, number> = { failed: 0, messages: 1, report: 2, draft: 3 }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || Date.parse(b.c.createdAt) - Date.parse(a.c.createdAt))
}

export function VetDashboard() {
  const { cases, user, refreshBackendCases } = useApp()
  const { t, intlLocale } = useLocale()
  const nav = useLocalizedNavigate()
  const [stats, setStats] = useState<ClinicDashboardStats | null>(null)

  useEffect(() => {
    void refreshBackendCases()
  }, [refreshBackendCases])

  useEffect(() => {
    void getClinicDashboard({})
      .then(setStats)
      .catch(() => setStats(null))
  }, [])


  const open = stats?.active_cases ?? cases.filter((c) => !['onaylandi', 'reddedildi'].includes(c.status)).length
  const review = stats?.awaiting_review ?? cases.filter((c) => c.status === 'uzman_incelemesinde').length
  const urgent =
    stats?.urgent_cases ??
    cases.filter((c) => (c.priority === 'STAT' || c.priority === 'Acil') && !['onaylandi', 'reddedildi'].includes(c.status))
      .length
  // Cases whose report is not approved yet — from the synced backend case list (issue #91).
  const awaitingReport = cases.filter((c) => isAwaitingReport(c.status)).length
  const approved = stats?.completed_reports ?? cases.filter((c) => c.status === 'onaylandi').length

  const todos = useMemo(() => buildVetTodos(cases), [cases])
  const trend = useMemo(() => buildTrend(cases, t), [cases, t])


  // Cases added in the last 24 hours, newest first; the full list is one click away (sidebar).
  const recent = useMemo(() => {
    const since = Date.now() - 24 * 3_600_000
    return cases
      .filter((c) => Date.parse(c.createdAt) >= since)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  }, [cases])

  const metricCards = [
    { label: t('dashboard.metricActiveCases'), value: open, icon: <FolderOpen className="h-4 w-4" />, tone: 'bg-sky-50 text-sky-700', to: '/vakalar' },
    { label: t('dashboard.metricAwaitingReview'), value: review, icon: <Hourglass className="h-4 w-4" />, tone: 'bg-amber-50 text-amber-700', to: '/vakalar' },
    { label: t('dashboard.metricUrgentStat'), value: urgent, icon: <Timer className="h-4 w-4" />, tone: 'bg-white/20 text-white', to: '/vakalar?acil=1', urgent: true },
    { label: t('dashboard.metricCompletedReports'), value: approved, icon: <CheckCircle2 className="h-4 w-4" />, tone: 'bg-emerald-50 text-emerald-700', to: '/vakalar?durum=onaylandi' },
  ]

  const quickLinks = [
    { to: '/vakalar/yeni', label: t('dashboard.newCase'), icon: <FilePlus2 className="h-5 w-5" />, hint: t('dashboard.newCaseHint') },
    { to: '/vakalar', label: t('dashboard.quickReviewQueue'), icon: <Hourglass className="h-5 w-5" />, hint: t('dashboard.hintCaseCount', { count: review }) },
    { to: '/vakalar?durum=onaylandi', label: t('dashboard.quickReports'), icon: <FileText className="h-5 w-5" />, hint: t('dashboard.hintApprovedCount', { count: approved }) },
    {
      to: `/vakalar?durum=${AWAITING_REPORT_FILTER}`,
      label: t('dashboard.quickAwaitingReport'),
      icon: <ClipboardCheck className="h-5 w-5" />,
      hint: t('dashboard.hintAwaitingReport', { count: awaitingReport }),
    },
  ]

  return (
    <div className="space-y-4">
      <AnalysisTasksBanner />
      {/* Welcome + primary actions */}
      <div>
        <div className="relative overflow-hidden rounded-[1.5rem] bg-[color:var(--vm-midnight,#0b1728)] text-white shadow-[0_20px_50px_-28px_rgba(11,23,40,0.55)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_0%,rgba(45,212,191,0.35),transparent_50%),radial-gradient(ellipse_at_100%_80%,rgba(14,165,233,0.2),transparent_45%)]"
          />
          {/* Photo fades into the card — mask avoids a hard vertical seam */}
          <div
            className="pointer-events-none absolute inset-y-0 right-0 hidden w-[52%] max-w-[360px] sm:block [mask-image:linear-gradient(to_right,transparent_0%,rgba(0,0,0,0.55)_28%,black_52%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,rgba(0,0,0,0.55)_28%,black_52%)]"
            aria-hidden
          >
            <img
              src="/dashboard-hero-dog.jpg"
              alt=""
              className="h-full w-full scale-[1.06] object-cover object-[58%_12%] opacity-90"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[color:var(--vm-midnight,#0b1728)] via-[color:var(--vm-midnight,#0b1728)]/55 to-transparent" />
          </div>
          <div className="relative flex min-h-[168px] items-center p-5 sm:p-6">
            <div className="max-w-[58%] min-w-0">
              <p className="text-xs font-semibold tabular-nums tracking-wide text-teal-300/90">{formatClinicDate(intlLocale)}</p>
              <p className="mt-1 font-display text-xl font-bold tracking-tight sm:text-2xl">
                {t('dashboard.welcomeNamed', { name: user?.name ?? '' })}
              </p>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
                {t('dashboard.heroInReview', { count: review })}{' '}
                {todos.length ? (
                  <span className="font-semibold text-white">{t('dashboard.heroTodo', { count: todos.length })}</span>
                ) : (
                  t('dashboard.heroAllClear')
                )}
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Metrics */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((m) => (
          <LocalizedLink
            key={m.label}
            to={m.to}
            aria-label={t('dashboard.metricGoToPage', { label: m.label, value: m.value })}
            className={`flex items-center gap-3 rounded-vm border px-4 py-3.5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
              'urgent' in m ? 'border-rose-700 bg-rose-600 hover:bg-rose-700' : 'border-slate-200/80 bg-surface-elevated hover:border-teal-200'
            }`}
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${m.tone}`}>{m.icon}</div>
            <div className="min-w-0">
              <p className={`text-xs font-medium ${'urgent' in m ? 'text-white/85' : 'text-slate-500'}`}>{m.label}</p>
              <p className={`font-display text-2xl font-semibold tabular-nums tracking-tight ${'urgent' in m ? 'text-white' : 'text-navy-900'}`}>{m.value}</p>
            </div>
          </LocalizedLink>
        ))}
      </div>

      {/* Charts + quick access */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title={t('dashboard.todoTitle')} subtitle={t('dashboard.todoSubtitle')} />
          {todos.length === 0 ? (
            <p className="flex items-center gap-2 px-4 pb-5 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> {t('dashboard.todoEmpty')}
            </p>
          ) : (
            <ul className="space-y-1.5 px-3 pb-3">
              {todos.slice(0, 5).map(({ kind, c }) => {
                const meta = TODO_META[kind]
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => nav(kind === 'report' ? `/raporlar/${c.id}` : `/vakalar/${c.id}`)}
                      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-teal-300 hover:bg-teal-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>{meta.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">{c.patient.name}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {t(meta.key, { count: c.unreadMessages ?? 0 })}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                    </button>
                  </li>
                )
              })}
              {todos.length > 5 ? (
                <li className="px-1 pt-1 text-xs text-slate-500">{t('dashboard.todoMore', { count: todos.length - 5 })}</li>
              ) : null}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t('dashboard.caseDistribution')} subtitle={t('dashboard.last7Days')} />
          <div className="h-48 px-2 pb-3 pr-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={28} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                  labelStyle={{ color: '#12233a' }}
                />
                <Line type="monotone" dataKey="yeni" name={t('dashboard.trendNew')} stroke="#0b807a" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="tamamlanan" name={t('dashboard.trendCompleted')} stroke="#059669" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="inceleme" name={t('dashboard.trendInReview')} stroke="#d97706" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title={t('dashboard.quickAccess')} />
          <div className="grid grid-cols-2 gap-2.5 px-4 pb-4">
            {quickLinks.map((l) => (
              <button
                key={l.to}
                type="button"
                onClick={() => nav(l.to)}
                className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3 text-left transition hover:border-teal-200 hover:bg-teal-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
              >
                <span className="text-teal-700">{l.icon}</span>
                <span className="text-xs font-semibold text-navy-900">{l.label}</span>
                <span className="text-[11px] text-slate-500">{l.hint}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Cases + sidebar widgets */}
      <div>
        <Card>
          <CardHeader
            title={t('dashboard.recentActiveCases')}
            subtitle={t('dashboard.recentLast24h', { count: recent.length })}
            action={
              <LocalizedLink to="/vakalar" className="text-sm font-medium text-teal-700 hover:underline">
                {t('dashboard.viewAll')}
              </LocalizedLink>
            }
          />
          {recent.length === 0 ? (
            <EmptyState
              compact
              icon={<FolderOpen className="h-5 w-5" />}
              title={t('dashboard.recentEmpty')}
              text={t('dashboard.recentEmptyHint')}
            />
          ) : (
            // Same table as the case list and the radiologist worklist.
            <CaseTable cases={recent} />
          )}
        </Card>

      </div>
    </div>
  )
}
