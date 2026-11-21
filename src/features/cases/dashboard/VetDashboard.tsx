import { LocalizedLink } from '../../../components/LocalizedLink'
import { useLocalizedNavigate } from '../../../hooks/useLocalizedNavigate'
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  CheckCircle2,
  ClipboardCheck,
  FilePlus2,
  FileText,
  FolderOpen,
  HelpCircle,
  Hourglass,
  MoreHorizontal,
  Timer,
  UploadCloud,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { useLocale } from '../../../context/LocaleContext'
import type { TranslateFn } from '../../../i18n'
import { studyLabel } from '../../../lib/displayClean'
import { Card, CardHeader } from '../../../components/Card'
import { SpeciesIcon } from '../../../components/CaseTable'
import { StatusBadge } from '../../../components/StatusBadge'
import { EmptyState } from '../../../components/EmptyState'
import { getClinicDashboard, listSubmissions } from '../../../lib/backend'
import { fmtDate } from '../../../lib/format'
import type { ClinicDashboardStats } from '../../../types'

import { buildTrend } from '../../dashboard/trend'

const PIE_COLORS = ['#0b807a', '#3e6895', '#94a3b8']

function weekdayKey(d: Date) {
  const js = d.getDay()
  return `dashboard.weekday${js === 0 ? 6 : js - 1}`
}

function formatClinicDate(t: TranslateFn, d = new Date()) {
  const m = d.getMonth() + 1
  return `${d.getDate()} ${t(`format.month${m}`)} ${d.getFullYear()}, ${t(weekdayKey(d))}`
}

export function VetDashboard() {
  const { cases, user, refreshBackendCases } = useApp()
  const { t, locale } = useLocale()
  const nav = useLocalizedNavigate()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [stats, setStats] = useState<ClinicDashboardStats | null>(null)
  const [pendingSubs, setPendingSubs] = useState(0)

  useEffect(() => {
    void refreshBackendCases()
  }, [refreshBackendCases])

  // Debounce clinic dashboard search so typing does not spam the API (local filter still uses `q`).
  useEffect(() => {
    const handle = window.setTimeout(() => {
      void getClinicDashboard({ q: q || undefined })
        .then(setStats)
        .catch(() => setStats(null))
    }, q ? 350 : 0)
    return () => window.clearTimeout(handle)
  }, [q])

  useEffect(() => {
    void listSubmissions()
      .then((rows) =>
        setPendingSubs(rows.filter((r) => r.status === 'pending_verification' || r.status === 'needs_info').length),
      )
      .catch(() => setPendingSubs(0))
  }, [])

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return cases.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false
      if (!ql) return true
      const hay = `${c.patient.name} ${c.no} ${c.id} ${c.clinic} ${c.patient.species} ${c.patient.breed}`.toLowerCase()
      return hay.includes(ql)
    })
  }, [cases, q, statusFilter])

  const open = stats?.active_cases ?? cases.filter((c) => !['onaylandi', 'reddedildi'].includes(c.status)).length
  const review = stats?.awaiting_review ?? cases.filter((c) => c.status === 'uzman_incelemesinde').length
  const urgent =
    stats?.urgent_cases ??
    cases.filter((c) => (c.priority === 'STAT' || c.priority === 'Acil') && !['onaylandi', 'reddedildi'].includes(c.status))
      .length
  const approved = stats?.completed_reports ?? cases.filter((c) => c.status === 'onaylandi').length

  const trend = useMemo(() => buildTrend(cases, t), [cases, t])

  const speciesData = useMemo(() => {
    const active = cases.filter((c) => !['onaylandi', 'reddedildi'].includes(c.status))
    let dog = 0
    let cat = 0
    let other = 0
    for (const c of active) {
      if (c.patient.species === 'Köpek') dog += 1
      else if (c.patient.species === 'Kedi') cat += 1
      else other += 1
    }
    const total = active.length || 1
    return [
      { name: t('dashboard.speciesDog'), value: dog, pct: Math.round((dog / total) * 100) },
      { name: t('dashboard.speciesCat'), value: cat, pct: Math.round((cat / total) * 100) },
      { name: t('dashboard.speciesOther'), value: other, pct: Math.round((other / total) * 100) },
    ].filter((x) => x.value > 0 || active.length === 0)
  }, [cases, t])

  const recent = filtered.slice(0, 5)

  const metricCards = [
    { label: t('dashboard.metricActiveCases'), value: open, icon: <FolderOpen className="h-4 w-4" />, tone: 'bg-sky-50 text-sky-700', to: '/vakalar' },
    { label: t('dashboard.metricAwaitingReview'), value: review, icon: <Hourglass className="h-4 w-4" />, tone: 'bg-amber-50 text-amber-700', to: '/vakalar' },
    { label: t('dashboard.metricUrgentStat'), value: urgent, icon: <Timer className="h-4 w-4" />, tone: 'bg-violet-50 text-violet-700', to: '/vakalar' },
    { label: t('dashboard.metricCompletedReports'), value: approved, icon: <CheckCircle2 className="h-4 w-4" />, tone: 'bg-emerald-50 text-emerald-700', to: '/raporlar' },
  ]

  const quickLinks = [
    {
      to: '/basvurular',
      label: t('dashboard.quickOwnerSubmissions'),
      icon: <ClipboardCheck className="h-5 w-5" />,
      hint: pendingSubs ? t('dashboard.hintPendingCount', { count: pendingSubs }) : t('dashboard.hintRequests'),
    },
    { to: '/vakalar', label: t('dashboard.quickReviewQueue'), icon: <Hourglass className="h-5 w-5" />, hint: t('dashboard.hintCaseCount', { count: review }) },
    { to: '/raporlar', label: t('dashboard.quickReports'), icon: <FileText className="h-5 w-5" />, hint: t('dashboard.hintApprovedCount', { count: approved }) },
    { to: '/dicom-yukle', label: t('dashboard.quickDicom'), icon: <UploadCloud className="h-5 w-5" />, hint: t('dashboard.hintAddImaging') },
  ]

  return (
    <div className="space-y-4">
      {/* Welcome + primary actions */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,17rem)]">
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-300/90">
                {user?.org || t('nav.dashboard')}
              </p>
              <p className="mt-1 font-display text-xl font-bold tracking-tight sm:text-2xl">
                {t('dashboard.welcomeNamed', { name: user?.name ?? '' })}
              </p>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
                {t('dashboard.todayAtClinic', { date: formatClinicDate(t) })}{' '}
                <span className="font-semibold text-white">{t('dashboard.reviewCount', { count: review })}</span>
                {pendingSubs > 0 ? (
                  <>
                    {' '}
                    <span className="font-semibold text-white">
                      {t('dashboard.andNewSubmissions', { count: pendingSubs })}
                    </span>
                  </>
                ) : null}{' '}
                {t('dashboard.awaitingSuffix')}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => nav('/dicom-yukle')}
            className="flex flex-1 items-center gap-3 rounded-2xl bg-teal-700 px-4 py-3.5 text-left text-white shadow-sm transition hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <UploadCloud className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold">{t('dashboard.uploadDicom')}</span>
              <span className="block text-xs text-teal-100">{t('dashboard.uploadDicomHint')}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => nav('/vakalar/yeni')}
            className="flex flex-1 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left shadow-soft transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-navy-700">
              <FilePlus2 className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-navy-900">{t('dashboard.newCase')}</span>
              <span className="block text-xs text-slate-500">{t('dashboard.newCaseHint')}</span>
            </span>
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((m) => (
          <LocalizedLink
            key={m.label}
            to={m.to}
            aria-label={t('dashboard.metricGoToPage', { label: m.label, value: m.value })}
            className="flex items-center gap-3 rounded-vm border border-slate-200/80 bg-surface-elevated px-4 py-3.5 shadow-soft transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${m.tone}`}>{m.icon}</div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">{m.label}</p>
              <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-navy-900">{m.value}</p>
            </div>
          </LocalizedLink>
        ))}
      </div>

      {/* Charts + quick access */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-1">
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
          <CardHeader title={t('dashboard.speciesDistribution')} subtitle={t('dashboard.activeCasesSubtitle')} />
          <div className="flex items-center gap-3 px-4 pb-4">
            <div className="relative h-36 w-36 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={speciesData.length ? speciesData : [{ name: '—', value: 1, pct: 0 }]}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={38}
                    outerRadius={58}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {(speciesData.length ? speciesData : [{ name: '—' }]).map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-lg font-semibold text-navy-900">{open}</span>
                <span className="text-[10px] text-slate-500">{t('dashboard.centerActive')}</span>
              </div>
            </div>
            <ul className="min-w-0 flex-1 space-y-2 text-xs">
              {(speciesData.length ? speciesData : [{ name: t('dashboard.noData'), value: 0, pct: 0 }]).map((s, i) => (
                <li key={s.name} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-slate-600">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    {s.name}
                  </span>
                  <span className="font-medium tabular-nums text-navy-900">
                    {s.value} · %{s.pct}
                  </span>
                </li>
              ))}
            </ul>
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
      <div className="grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={t('dashboard.recentActiveCases')}
            subtitle={t('dashboard.recordsCount', { count: filtered.length })}
            action={
              <LocalizedLink to="/vakalar" className="text-sm font-medium text-teal-700 hover:underline">
                {t('dashboard.viewAll')}
              </LocalizedLink>
            }
          />
          <div className="grid gap-2 border-b border-slate-100 px-4 py-3 sm:grid-cols-[1fr_minmax(9rem,12rem)] sm:items-end">
            <label className="block text-xs font-medium text-slate-600" htmlFor="vet-dash-q">
              {t('common.search')}
              <input
                id="vet-dash-q"
                className="input mt-1 !min-h-9 !py-1.5"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('cases.listSearchPlaceholder')}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600" htmlFor="vet-dash-status">
              {t('common.status')}
              <select
                id="vet-dash-status"
                className="input mt-1 !min-h-9 !py-1.5"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">{t('common.all')}</option>
                <option value="taslak">{t('status.taslak')}</option>
                <option value="ai_analizi">{t('status.ai_analizi')}</option>
                <option value="uzman_incelemesinde">{t('status.uzman_incelemesinde')}</option>
                <option value="onaylandi">{t('status.onaylandi')}</option>
                <option value="revizyon">{t('status.revizyon')}</option>
              </select>
            </label>
          </div>
          {recent.length === 0 ? (
            <EmptyState
              compact
              icon={<FolderOpen className="h-5 w-5" />}
              title={t('dashboard.noCases')}
              text={t('dashboard.noCasesHint')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className="th w-10" />
                    <th className="th">{t('cases.caseNo')}</th>
                    <th className="th">{t('common.patient')}</th>
                    <th className="th">{t('cases.speciesBreed')}</th>
                    <th className="th">{t('cases.modality')}</th>
                    <th className="th">{t('cases.study')}</th>
                    <th className="th">{t('common.status')}</th>
                    <th className="th">{t('cases.updated')}</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recent.map((c) => (
                    <tr
                      key={c.id}
                      className="cursor-pointer transition hover:bg-teal-50/40"
                      onClick={() => nav(`/vakalar/${c.id}`)}
                    >
                      <td className="td">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-900 text-[10px] font-semibold text-teal-200">
                          {(c.modality || 'IMG').slice(0, 3)}
                        </div>
                      </td>
                      <td className="td font-mono text-[11px] text-slate-400">{c.no}</td>
                      <td className="td">
                        <div className="flex items-center gap-2 font-semibold text-navy-900">
                          <SpeciesIcon species={c.patient.species} />
                          {c.patient.name}
                        </div>
                      </td>
                      <td className="td">
                        <div>{c.patient.species}</div>
                        <div className="text-xs text-slate-500">{c.patient.breed}</div>
                      </td>
                      <td className="td">
                        <span className="rounded-md bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-700">
                          {c.modality ? studyLabel(t, c.modality, c.anatomicalRegion) : '—'}
                        </span>
                      </td>
                      <td className="td text-xs text-slate-600">
                        {c.seriesCount != null || c.instanceCount != null
                          ? `${t('cases.seriesShort', { n: c.seriesCount ?? '—' })} · ${t('cases.imagesShort', { n: c.instanceCount ?? '—' })}`
                          : t('common.dash')}
                      </td>
                      <td className="td">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="td text-xs text-slate-500">{fmtDate(c.createdAt, locale)}</td>
                      <td className="td text-right">
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700"
                          aria-label={t('dashboard.caseDetailAria')}
                          onClick={(e) => {
                            e.stopPropagation()
                            nav(`/vakalar/${c.id}`)
                          }}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4 self-start">
          <div className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
              <HelpCircle className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-navy-900">{t('dashboard.helpTitle')}</p>
              <p className="mt-0.5 text-xs text-slate-500">{t('dashboard.helpBody')}</p>
              {stats && stats.unread_messages > 0 ? (
                <p className="mt-1 text-xs font-medium text-amber-800">
                  {t('dashboard.unreadCaseMessages', { count: stats.unread_messages })}
                </p>
              ) : null}
              <a
                href="mailto:destek@vetmind.local?subject=VetMind%20destek"
                className="mt-2 inline-block text-xs font-semibold text-teal-700 hover:underline"
              >
                {t('dashboard.contactSupport')}
              </a>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
