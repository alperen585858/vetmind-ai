import { LocalizedLink } from '../../../shared/shell/LocalizedLink'
import { useLocalizedNavigate } from '../../../shared/hooks/useLocalizedNavigate'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChevronRight, ClipboardCheck, FolderOpen, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../../shared/shell/AppContext'
import { useLocale } from '../../../shared/shell/LocaleContext'
import type { TranslateFn } from '../../../i18n'
import { Card } from '../../../shared/ui/Card'
import { ClinicGridAccent, ClinicWaveAccent } from '../../../shared/ui/ExpertBrandMark'
import { Button } from '../../../shared/ui/Button'
import { StatusBadge } from '../../../shared/ui/StatusBadge'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { getClinicDashboard, getClinicStats } from '../../../shared/api'
import { fmtDate } from '../../../shared/lib/format'
import type { BackendClinicStats, ClinicDashboardStats } from '../../../shared/types'

import { buildTrend } from '../../../shared/lib/trend'

function clinicGreeting(name: string, t: TranslateFn) {
  const h = new Date().getHours()
  const key =
    h < 12 ? 'dashboard.clinicGoodMorning' : h < 18 ? 'dashboard.clinicGoodAfternoon' : 'dashboard.clinicGoodEvening'
  return t(key, { name })
}

function ClinicMetric({
  label,
  value,
  hint,
  to,
  delayMs = 0,
  emphasize,
}: {
  label: string
  value: number | string
  hint?: string
  to: string
  delayMs?: number
  emphasize?: boolean
}) {
  return (
    <LocalizedLink
      to={to}
      aria-label={`${label}: ${value}`}
      className={`vm-clinic-card vm-fade-up block px-4 py-3.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
        emphasize ? 'border-amber-300/70 ring-1 ring-amber-100' : ''
      }`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p
        className={`mt-1 font-display text-3xl font-semibold tabular-nums tracking-tight ${
          emphasize ? 'text-amber-700' : 'text-[color:var(--vm-text,#172b4d)]'
        }`}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </LocalizedLink>
  )
}

export function ClinicOwnerDashboard() {
  const { user, cases, refreshBackendCases } = useApp()
  const { t, locale } = useLocale()
  const nav = useLocalizedNavigate()
  const [stats, setStats] = useState<BackendClinicStats | null>(null)
  const [dash, setDash] = useState<ClinicDashboardStats | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    void refreshBackendCases()
    void getClinicStats().then(setStats).catch(() => setStats(null))
    void getClinicDashboard().then(setDash).catch(() => setDash(null))
  }, [refreshBackendCases])

  const total = stats?.case_count ?? cases.length
  const awaiting = stats?.awaiting_review ?? dash?.awaiting_review ?? 0
  const approved = stats?.approved ?? dash?.completed_reports ?? 0
  const pendingSubs = stats?.pending_submissions ?? 0
  const urgent = dash?.urgent_cases ?? 0
  const staff = stats?.staff ?? []
  const activeStaff = staff.filter((s) => s.active).length

  const trend = useMemo(() => buildTrend(cases, t), [cases, t])
  const opsDist = useMemo(() => {
    const rows = [
      { key: 'review', name: t('dashboard.clinicChartReview'), value: awaiting, color: '#D99A32' },
      { key: 'approved', name: t('dashboard.clinicChartApproved'), value: approved, color: '#059669' },
      { key: 'pending', name: t('dashboard.clinicChartPending'), value: pendingSubs, color: '#6366F1' },
      { key: 'urgent', name: t('dashboard.clinicChartUrgent'), value: urgent, color: '#E5484D' },
    ]
    return rows.filter((r) => r.value > 0)
  }, [awaiting, approved, pendingSubs, urgent, t])

  const recent = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = [...cases].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (!needle) return list.slice(0, 8)
    return list
      .filter((c) =>
        [c.patient.name, c.no, c.clinic, c.patient.species, c.modality].join(' ').toLowerCase().includes(needle),
      )
      .slice(0, 8)
  }, [cases, q])

  const name = user?.name ?? ''
  const dashFallback = t('common.dash')

  return (
    <div className="space-y-6">
      <section className="vm-fade-up relative overflow-hidden rounded-2xl border border-slate-200/60 bg-[color:var(--vm-midnight,#0f172a)] text-white shadow-soft">
        <ClinicWaveAccent className="pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full opacity-80" />
        <ClinicGridAccent className="pointer-events-none absolute -left-4 top-4 h-36 w-36 opacity-45" />
        <div className="relative grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="flex flex-col justify-center px-6 py-7 sm:px-8 sm:py-9">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-200/90">
              {t('dashboard.clinicBrandTag')}
            </p>
            <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl lg:text-[2rem]">
              {clinicGreeting(name, t)}
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-300">{t('dashboard.clinicSubtitlePremium')}</p>
            {stats?.clinic_id ? (
              <p className="mt-2 font-mono text-[11px] text-slate-400">
                {t('dashboard.clinicIdLabel')}: {stats.clinic_id}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => nav('/vakalar')}>
                {t('nav.clinicCases')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="border-white/20 bg-white/5 text-white hover:bg-white/10"
                onClick={() => nav('/basvurular')}
              >
                {t('nav.ownerSubmissions')}
                {pendingSubs > 0 ? ` · ${pendingSubs}` : ''}
              </Button>
            </div>
          </div>
          <div className="relative min-h-[200px] overflow-hidden lg:min-h-[260px]">
            <img
              src="/expert-brand-dog.jpg"
              alt=""
              width={720}
              height={520}
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover object-[48%_20%]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[color:var(--vm-midnight,#0f172a)] via-[color:var(--vm-midnight,#0f172a)]/60 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-[color:var(--vm-midnight,#0f172a)]/75 via-transparent to-[color:var(--vm-midnight,#0f172a)]/25" />
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ClinicMetric
          label={t('dashboard.clinicStatTotal')}
          value={stats ? total : dashFallback}
          hint={t('dashboard.clinicStatTotalHint')}
          to="/vakalar"
          delayMs={40}
        />
        <ClinicMetric
          label={t('dashboard.clinicStatReview')}
          value={stats || dash ? awaiting : dashFallback}
          hint={t('dashboard.clinicStatReviewHint')}
          to="/vakalar"
          delayMs={80}
          emphasize={awaiting > 0}
        />
        <ClinicMetric
          label={t('dashboard.clinicStatApproved')}
          value={stats || dash ? approved : dashFallback}
          hint={t('dashboard.clinicStatApprovedHint')}
          to="/raporlar"
          delayMs={120}
        />
        <ClinicMetric
          label={t('dashboard.clinicStatPendingSubs')}
          value={stats ? pendingSubs : dashFallback}
          hint={t('dashboard.clinicStatPendingHint')}
          to="/basvurular"
          delayMs={160}
        />
      </div>

      {(awaiting > 0 || pendingSubs > 0 || urgent > 0) && (
        <div className="vm-fade-up flex flex-col gap-3 overflow-hidden rounded-2xl border border-indigo-200/70 bg-gradient-to-r from-indigo-50 via-white to-amber-50/70 px-4 py-3.5 shadow-soft sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
            <ClipboardCheck className="h-5 w-5" aria-hidden />
          </div>
          <p className="flex-1 text-sm text-indigo-950">
            <span className="font-semibold">{t('dashboard.clinicOpsBanner', { review: awaiting, pending: pendingSubs })}</span>{' '}
            {urgent > 0 ? t('dashboard.clinicOpsUrgent', { count: urgent }) : t('dashboard.clinicOpsBannerBody')}
          </p>
          <Button size="sm" onClick={() => nav(pendingSubs > 0 ? '/basvurular' : '/vakalar')}>
            {pendingSubs > 0 ? t('nav.ownerSubmissions') : t('nav.clinicCases')}
          </Button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card className="vm-fade-up overflow-hidden border-slate-200/70 p-4 shadow-soft" style={{ animationDelay: '180ms' }}>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{t('dashboard.clinicChartWorkload')}</h2>
            <p className="text-[11px] text-slate-400">{t('dashboard.clinicChartWorkloadHint')}</p>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="clinicTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366F1" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Area type="monotone" dataKey="yeni" name={t('dashboard.trendNew')} stroke="#6366F1" fill="url(#clinicTrendFill)" strokeWidth={2} />
                <Area
                  type="monotone"
                  dataKey="tamamlanan"
                  name={t('dashboard.trendCompleted')}
                  stroke="#102A43"
                  fill="transparent"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="vm-fade-up overflow-hidden border-slate-200/70 p-4 shadow-soft" style={{ animationDelay: '220ms' }}>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{t('dashboard.clinicChartOps')}</h2>
            <p className="text-[11px] text-slate-400">{t('dashboard.clinicChartOpsHint')}</p>
          </div>
          {opsDist.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">{t('dashboard.clinicOpsEmpty')}</p>
          ) : (
            <div className="flex h-44 items-center gap-4">
              <div className="h-40 w-40 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={opsDist} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={2}>
                      {opsDist.map((row) => (
                        <Cell key={row.key} fill={row.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-0 flex-1 space-y-2">
                {opsDist.map((row) => (
                  <li key={row.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
                      {row.name}
                    </span>
                    <span className="font-semibold tabular-nums text-[color:var(--vm-text,#172b4d)]">{row.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="vm-fade-up overflow-hidden border-slate-200/70 shadow-soft" style={{ animationDelay: '260ms' }}>
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-[color:var(--vm-text,#172b4d)]">
                {t('dashboard.clinicRecentCases')}
              </h2>
              <p className="text-xs text-slate-500">{t('dashboard.clinicRecentCasesHint')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="clinic-dash-q">
                {t('common.search')}
              </label>
              <input
                id="clinic-dash-q"
                className="input max-w-xs py-2 text-sm"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('dashboard.clinicSearchPlaceholder')}
              />
              <LocalizedLink to="/vakalar" className="text-sm font-semibold text-indigo-700 transition hover:text-indigo-800">
                {t('dashboard.clinicViewAllCases')}
              </LocalizedLink>
            </div>
          </div>
          {recent.length === 0 ? (
            <EmptyState compact icon={<FolderOpen className="h-5 w-5" />} title={t('dashboard.clinicNoCases')} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((c) => (
                <li key={c.id}>
                  <LocalizedLink
                    to={`/vakalar/${c.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-indigo-50/40"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[color:var(--vm-text,#172b4d)]">{c.patient.name}</p>
                        <StatusBadge status={c.status === 'revizyon' ? 'uzman_incelemesinde' : c.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {c.patient.species}
                        {c.modality ? ` · ${c.modality}` : ''}
                        {' · '}
                        {c.no} · {fmtDate(c.createdAt, locale)}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                  </LocalizedLink>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="vm-fade-up overflow-hidden border-slate-200/70 shadow-soft" style={{ animationDelay: '300ms' }}>
          <div className="border-b border-slate-100 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-indigo-600" aria-hidden />
              <h2 className="font-display text-base font-semibold text-[color:var(--vm-text,#172b4d)]">
                {t('dashboard.clinicStaff')}
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {stats?.clinic_id
                ? t('dashboard.clinicStaffMeta', { active: activeStaff, total: staff.length })
                : t('dashboard.clinicStaffEmpty')}
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {staff.map((s) => (
              <li key={s.email} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-[color:var(--vm-text,#172b4d)]">{s.display_name || s.email}</p>
                  <p className="truncate font-mono text-[11px] text-slate-400">{s.email}</p>
                </div>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                    s.active
                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                      : 'bg-slate-50 text-slate-500 ring-slate-200'
                  }`}
                >
                  {s.role} · {s.active ? t('admin.activeStaff') : t('admin.inactiveStaff')}
                </span>
              </li>
            ))}
            {!staff.length && (
              <li className="px-4 py-6 text-center text-sm text-slate-400">{t('dashboard.clinicStaffEmpty')}</li>
            )}
          </ul>
        </Card>
      </div>
    </div>
  )
}
