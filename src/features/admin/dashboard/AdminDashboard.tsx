import { LocalizedLink } from '../../../components/LocalizedLink'
import { useLocalizedNavigate } from '../../../hooks/useLocalizedNavigate'
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
import {
  Activity,
  BookOpen,
  ChevronRight,
  Cpu,
  Database,
  Layers,
  RefreshCw,
  Server,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { useLocale } from '../../../context/LocaleContext'
import type { TranslateFn } from '../../../i18n'
import { Card } from '../../../components/Card'
import { AdminCircuitAccent, AdminWaveAccent } from '../../../components/ExpertBrandMark'
import { Button } from '../../../components/Button'
import { StatusBadge } from '../../../components/StatusBadge'
import { EmptyState } from '../../../components/EmptyState'
import {
  BackendUnavailableError,
  fetchBackendHealth,
  fetchModelReadiness,
  fetchRadiologistPayoutLedger,
  listManagedUsers,
  type BackendHealth,
  type BackendModelReadiness,
} from '../../../lib/backend'
import { fmtDate } from '../../../lib/format'
import type { BackendManagedUser, BackendRadiologistPayoutLedger } from '../../../types'

import { GpuChart } from './GpuChart'
import { buildTrend } from '../../dashboard/trend'

function adminGreeting(name: string, t: TranslateFn) {
  const h = new Date().getHours()
  const key =
    h < 12 ? 'dashboard.adminGoodMorning' : h < 18 ? 'dashboard.adminGoodAfternoon' : 'dashboard.adminGoodEvening'
  return t(key, { name })
}

function AdminMetric({
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
      className={`vm-admin-card vm-fade-up block px-4 py-3.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
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

export function AdminDashboard() {
  const { kbSources, cases, user, refreshBackendCases } = useApp()
  const { t, locale, intlLocale } = useLocale()
  const nav = useLocalizedNavigate()
  const [health, setHealth] = useState<BackendHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [readiness, setReadiness] = useState<BackendModelReadiness | null>(null)
  const [users, setUsers] = useState<BackendManagedUser[]>([])
  const [payouts, setPayouts] = useState<BackendRadiologistPayoutLedger | null>(null)
  const [loadingLive, setLoadingLive] = useState(true)

  const chunks = kbSources.reduce((s, k) => s + k.chunks, 0)
  const backendOk = health?.status === 'ok'
  const unpaid = payouts?.total_unpaid_cases ?? 0
  const owed = payouts?.total_amount_owed ?? 0
  const activeUsers = users.filter((u) => u.active).length

  const loadLive = () => {
    setLoadingLive(true)
    setHealthError(null)
    void refreshBackendCases()
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
        .then(setReadiness)
        .catch(() => setReadiness(null)),
      listManagedUsers()
        .then(setUsers)
        .catch(() => setUsers([])),
      fetchRadiologistPayoutLedger()
        .then(setPayouts)
        .catch(() => setPayouts(null)),
    ]).finally(() => setLoadingLive(false))
  }

  useEffect(() => {
    loadLive()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount refresh only
  }, [])

  const trend = useMemo(() => buildTrend(cases, t), [cases, t])
  const statusDist = useMemo(() => {
    const rows = [
      {
        key: 'approved',
        name: t('dashboard.adminChartApproved'),
        value: cases.filter((c) => c.status === 'onaylandi').length,
        color: '#059669',
      },
      {
        key: 'review',
        name: t('dashboard.adminChartReview'),
        value: cases.filter((c) => c.status === 'uzman_incelemesinde' || c.status === 'revizyon').length,
        color: '#D99A32',
      },
      {
        key: 'process',
        name: t('dashboard.adminChartProcess'),
        value: cases.filter((c) => c.status === 'isleniyor' || c.status === 'ai_analizi' || c.status === 'taslak').length,
        color: '#64748B',
      },
      {
        key: 'other',
        name: t('dashboard.adminChartOther'),
        value: cases.filter((c) => c.status === 'reddedildi' || c.status === 'manuel_inceleme').length,
        color: '#E5484D',
      },
    ]
    return rows.filter((r) => r.value > 0)
  }, [cases, t])

  const recentCases = useMemo(
    () => [...cases].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    [cases],
  )

  const name = user?.name ?? ''
  const dash = t('common.dash')

  return (
    <div className="space-y-6">
      <section className="vm-fade-up relative overflow-hidden rounded-2xl border border-slate-200/60 bg-[color:var(--vm-midnight,#020617)] text-white shadow-soft">
        <AdminWaveAccent className="pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full opacity-80" />
        <AdminCircuitAccent className="pointer-events-none absolute -left-4 top-4 h-36 w-36 opacity-45" />
        <div className="relative grid gap-0 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="flex flex-col justify-center px-6 py-7 sm:px-8 sm:py-9">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200/90">
              {t('dashboard.adminBrandTag')}
            </p>
            <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl lg:text-[2rem]">
              {adminGreeting(name, t)}
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-300">{t('dashboard.adminSubtitlePremium')}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${
                  healthError
                    ? 'bg-rose-500/15 text-rose-200 ring-rose-400/30'
                    : backendOk
                      ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30'
                      : loadingLive
                        ? 'bg-slate-500/20 text-slate-200 ring-slate-400/30'
                        : 'bg-amber-500/15 text-amber-200 ring-amber-400/30'
                }`}
              >
                <Server className="h-3.5 w-3.5" aria-hidden />
                {healthError
                  ? t('dashboard.adminHealthDown')
                  : backendOk
                    ? t('dashboard.adminHealthOk')
                    : loadingLive
                      ? t('dashboard.adminHealthLoading')
                      : t('dashboard.adminHealthDegraded')}
                {health?.version ? ` · v${health.version}` : ''}
              </span>
              {health?.mode ? (
                <span className="rounded-full bg-white/5 px-2.5 py-1 font-mono text-[11px] text-slate-300 ring-1 ring-inset ring-white/10">
                  {health.mode}
                </span>
              ) : null}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => nav('/sistem')} icon={<Activity className="h-4 w-4" />}>
                {t('admin.system')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="border-white/20 bg-white/5 text-white hover:bg-white/10"
                onClick={loadLive}
                icon={<RefreshCw className={`h-4 w-4 ${loadingLive ? 'animate-spin' : ''}`} />}
              >
                {t('dashboard.adminRefreshLive')}
              </Button>
            </div>
          </div>
          <div className="relative min-h-[200px] overflow-hidden lg:min-h-[260px]">
            <img
              src="/dashboard-hero-dog.jpg"
              alt=""
              width={720}
              height={520}
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover object-[50%_18%] opacity-90"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[color:var(--vm-midnight,#020617)] via-[color:var(--vm-midnight,#020617)]/65 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-[color:var(--vm-midnight,#020617)]/80 via-transparent to-[color:var(--vm-midnight,#020617)]/30" />
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AdminMetric
          label={t('dashboard.adminSessionCases')}
          value={cases.length}
          hint={t('dashboard.adminSessionHint')}
          to="/sistem"
          delayMs={40}
        />
        <AdminMetric
          label={t('dashboard.adminKb')}
          value={kbSources.length}
          hint={t('dashboard.adminKbHint', { chunks: chunks.toLocaleString(intlLocale) })}
          to="/bilgi-tabani"
          delayMs={80}
        />
        <AdminMetric
          label={t('dashboard.adminUsersMetric')}
          value={users.length ? activeUsers : dash}
          hint={users.length ? t('dashboard.adminUsersHint', { total: users.length }) : t('dashboard.adminUsersUnavailable')}
          to="/kullanicilar"
          delayMs={120}
        />
        <AdminMetric
          label={t('dashboard.adminPayoutsMetric')}
          value={payouts ? unpaid : dash}
          hint={
            payouts
              ? t('dashboard.adminPayoutsHint', { amount: owed.toLocaleString(intlLocale), currency: payouts.currency })
              : t('dashboard.adminPayoutsUnavailable')
          }
          to="/radyologlarim"
          delayMs={160}
          emphasize={unpaid > 0}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="vm-fade-up overflow-hidden border-slate-200/70 p-4 shadow-soft" style={{ animationDelay: '180ms' }}>
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{t('dashboard.adminLivePlatform')}</h2>
              <p className="text-[11px] text-slate-400">{t('dashboard.adminLivePlatformHint')}</p>
            </div>
            <LocalizedLink to="/sistem" className="text-xs font-semibold text-emerald-700 transition hover:text-emerald-800">
              {t('admin.system')}
            </LocalizedLink>
          </div>
          <dl className="grid gap-2 sm:grid-cols-2">
            {[
              { label: t('dashboard.adminHealthStatus'), value: health?.status ?? (healthError ? t('dashboard.adminHealthDown') : dash) },
              { label: t('dashboard.adminHealthStorage'), value: health?.storage ?? dash },
              { label: t('dashboard.adminHealthRag'), value: health?.rag ?? dash },
              { label: t('dashboard.adminHealthJobs'), value: health?.job_backend ?? dash },
              {
                label: t('dashboard.adminModelsReady'),
                value: readiness
                  ? `${readiness.enabled_count}/${readiness.model_count}`
                  : dash,
              },
              {
                label: t('dashboard.adminVisionEndpoint'),
                value: health ? (health.vision_endpoint ? t('common.yes') : t('common.no')) : dash,
              },
            ].map((row) => (
              <div key={row.label} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{row.label}</dt>
                <dd className="mt-1 truncate font-mono text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{row.value}</dd>
              </div>
            ))}
          </dl>
          {healthError ? <p className="mt-3 text-xs text-rose-600">{healthError}</p> : null}
          {readiness?.note ? <p className="mt-3 text-xs text-slate-500">{readiness.note}</p> : null}
        </Card>

        <Card className="vm-fade-up overflow-hidden border-slate-200/70 p-4 shadow-soft" style={{ animationDelay: '220ms' }}>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{t('dashboard.adminChartStatus')}</h2>
            <p className="text-[11px] text-slate-400">{t('dashboard.adminChartStatusHint')}</p>
          </div>
          {statusDist.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">{t('dashboard.adminNoCases')}</p>
          ) : (
            <div className="flex h-44 items-center gap-4">
              <div className="h-40 w-40 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusDist} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={2}>
                      {statusDist.map((row) => (
                        <Cell key={row.key} fill={row.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-0 flex-1 space-y-2">
                {statusDist.map((row) => (
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card className="vm-fade-up overflow-hidden border-slate-200/70 p-4 shadow-soft" style={{ animationDelay: '260ms' }}>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{t('dashboard.adminChartWorkload')}</h2>
            <p className="text-[11px] text-slate-400">{t('dashboard.adminChartWorkloadHint')}</p>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="adminTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Area type="monotone" dataKey="yeni" name={t('dashboard.trendNew')} stroke="#10B981" fill="url(#adminTrendFill)" strokeWidth={2} />
                <Area
                  type="monotone"
                  dataKey="tamamlanan"
                  name={t('dashboard.trendCompleted')}
                  stroke="#0F172A"
                  fill="transparent"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="vm-fade-up overflow-hidden border-slate-200/70 shadow-soft" style={{ animationDelay: '300ms' }}>
          <div className="border-b border-slate-100 px-4 py-3.5">
            <h2 className="font-display text-base font-semibold text-[color:var(--vm-text,#172b4d)]">
              {t('dashboard.adminQuickLinks')}
            </h2>
            <p className="text-xs text-slate-500">{t('dashboard.adminQuickLinksHint')}</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {[
              { to: '/kullanicilar', label: t('nav.users'), icon: <ShieldCheck className="h-4 w-4" />, hint: t('dashboard.adminLinkUsers') },
              { to: '/radyologlarim', label: t('nav.myRadiologists'), icon: <Wallet className="h-4 w-4" />, hint: t('dashboard.adminLinkPayouts') },
              { to: '/bilgi-tabani', label: t('nav.knowledgeBase'), icon: <BookOpen className="h-4 w-4" />, hint: t('dashboard.adminLinkKb') },
              { to: '/model-performansi', label: t('nav.modelPerformance'), icon: <Cpu className="h-4 w-4" />, hint: t('dashboard.adminLinkModels') },
              { to: '/moduller', label: t('nav.modules'), icon: <Layers className="h-4 w-4" />, hint: t('dashboard.adminModulesHint') },
            ].map((item) => (
              <li key={item.to}>
                <LocalizedLink
                  to={item.to}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-emerald-50/50"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-emerald-700">
                      {item.icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{item.label}</span>
                      <span className="block truncate text-[11px] text-slate-400">{item.hint}</span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                </LocalizedLink>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="vm-fade-up overflow-hidden border-slate-200/70 shadow-soft" style={{ animationDelay: '320ms' }}>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
            <div>
              <h2 className="font-display text-base font-semibold text-[color:var(--vm-text,#172b4d)]">
                {t('dashboard.adminRecentCases')}
              </h2>
              <p className="text-xs text-slate-500">{t('dashboard.adminRecentCasesHint')}</p>
            </div>
            <span className="text-xs tabular-nums text-slate-400">{cases.length}</span>
          </div>
          {recentCases.length === 0 ? (
            <EmptyState compact icon={<Database className="h-5 w-5" />} title={t('dashboard.adminNoCases')} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentCases.map((c) => (
                <li key={c.id}>
                  <LocalizedLink
                    to={`/vakalar/${c.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-emerald-50/40"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[color:var(--vm-text,#172b4d)]">{c.patient.name}</p>
                        <StatusBadge status={c.status === 'revizyon' ? 'uzman_incelemesinde' : c.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {c.no} · {fmtDate(c.createdAt, locale)}
                        {c.clinic ? ` · ${c.clinic}` : ''}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                  </LocalizedLink>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="vm-fade-up overflow-hidden border-amber-200/60 bg-amber-50/30 shadow-soft" style={{ animationDelay: '340ms' }}>
          <div className="border-b border-amber-100/80 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-300">
                {t('dashboard.adminDemoBadge')}
              </span>
              <h2 className="font-display text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">
                {t('dashboard.gpuUsage')}
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">{t('dashboard.adminDemoBannerShort')}</p>
          </div>
          <div className="p-3">
            <GpuChart height={140} />
          </div>
          <div className="border-t border-amber-100/80 px-4 py-3">
            <LocalizedLink to="/sistem" className="text-sm font-semibold text-emerald-700 transition hover:text-emerald-800">
              {t('dashboard.adminOpenLiveStatus')}
            </LocalizedLink>
          </div>
        </Card>
      </div>
    </div>
  )
}
