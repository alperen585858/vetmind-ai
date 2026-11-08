import { LocalizedLink } from '../components/LocalizedLink'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import {
  Area,
  AreaChart,
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
  Activity,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Cpu,
  Database,
  FilePlus2,
  FileText,
  FolderOpen,
  HelpCircle,
  Hourglass,
  Layers,
  MoreHorizontal,
  PawPrint,
  RefreshCw,
  Server,
  ShieldCheck,
  Timer,
  UploadCloud,
  Users,
  Wallet,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import type { TranslateFn } from '../i18n'
import { studyLabel } from '../lib/displayClean'
import { Card, CardHeader, StatCard } from '../components/Card'
import {
  AdminCircuitAccent,
  AdminWaveAccent,
  ClinicGridAccent,
  ClinicWaveAccent,
  ExpertNodeAccent,
  ExpertWaveAccent,
  OwnerPawAccent,
  OwnerWaveAccent,
} from '../components/ExpertBrandMark'
import { ExpertWorklistTable } from '../components/ExpertWorklistTable'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { SpeciesIcon } from '../components/CaseTable'
import { StatusBadge } from '../components/StatusBadge'
import { EmptyState } from '../components/EmptyState'
import { DEPLOYMENTS, GPU_SERIES } from '../data/mock'
import {
  BackendUnavailableError,
  fetchBackendHealth,
  fetchModelReadiness,
  fetchRadiologistPayoutLedger,
  getClinicDashboard,
  getClinicStats,
  listManagedUsers,
  listPets,
  listSubmissions,
  type BackendHealth,
  type BackendModelReadiness,
} from '../lib/backend'
import { fmtDate } from '../lib/format'
import { isSlaAttention } from '../lib/reviewSla'
import { caseBelongsToOwner } from '../lib/caseMapper'
import type {
  BackendClinicStats,
  BackendManagedUser,
  BackendPet,
  BackendImagingSubmission,
  BackendRadiologistPayoutLedger,
  ClinicDashboardStats,
  VetCase,
} from '../types'

const PIE_COLORS = ['#0b807a', '#3e6895', '#94a3b8']

function weekdayKey(d: Date) {
  const js = d.getDay()
  return `dashboard.weekday${js === 0 ? 6 : js - 1}`
}

function formatClinicDate(t: TranslateFn, d = new Date()) {
  const m = d.getMonth() + 1
  return `${d.getDate()} ${t(`format.month${m}`)} ${d.getFullYear()}, ${t(weekdayKey(d))}`
}

function dayKey(iso: string) {
  return iso.slice(0, 10)
}

function buildTrend(cases: VetCase[], t: TranslateFn) {
  const days: { key: string; label: string; yeni: number; tamamlanan: number; inceleme: number }[] = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const m = d.getMonth() + 1
    days.push({ key, label: `${d.getDate()} ${t(`format.month${m}`)}`, yeni: 0, tamamlanan: 0, inceleme: 0 })
  }
  const byKey = Object.fromEntries(days.map((x) => [x.key, x]))
  for (const c of cases) {
    const k = dayKey(c.createdAt)
    const row = byKey[k]
    if (!row) continue
    row.yeni += 1
    if (c.status === 'onaylandi') row.tamamlanan += 1
    if (c.status === 'uzman_incelemesinde' || c.status === 'revizyon') row.inceleme += 1
  }
  return days
}

export default function Dashboard() {
  const { role } = useApp()
  if (role === 'expert') return <ExpertDashboard />
  if (role === 'owner') return <OwnerDashboard />
  if (role === 'clinic_owner') return <ClinicOwnerDashboard />
  if (role === 'admin') return <AdminDashboard />
  return <VetDashboard />
}

function VetDashboard() {
  const { cases, user, refreshBackendCases } = useApp()
  const { t, locale } = useLocale()
  const nav = useLocalizedNavigate()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [stats, setStats] = useState<ClinicDashboardStats | null>(null)
  const [pendingSubs, setPendingSubs] = useState(0)

  useEffect(() => {
    void refreshBackendCases()
    void getClinicDashboard({ q: q || undefined })
      .then(setStats)
      .catch(() => setStats(null))
  }, [refreshBackendCases, q])

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
        <div className="relative overflow-hidden rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50 via-sky-50 to-white shadow-soft">
          <div
            className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-teal-200/30 blur-2xl"
            aria-hidden
          />
          {/* Photo fades into the card — mask avoids a hard vertical seam */}
          <div
            className="pointer-events-none absolute inset-y-0 right-0 hidden w-[52%] max-w-[360px] sm:block [mask-image:linear-gradient(to_right,transparent_0%,rgba(0,0,0,0.55)_28%,black_52%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0%,rgba(0,0,0,0.55)_28%,black_52%)]"
            aria-hidden
          >
            <img
              src="/dashboard-hero-dog.jpg"
              alt=""
              className="h-full w-full scale-[1.06] object-cover object-[58%_12%]"
            />
            <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white/70 to-transparent" />
            <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-teal-50/50 to-transparent" />
          </div>
          <div className="relative flex min-h-[168px] items-center p-5 sm:p-6">
            <div className="max-w-[58%] min-w-0">
              <p className="font-display text-xl font-semibold tracking-tight text-navy-900 sm:text-2xl">
                {t('dashboard.welcomeNamed', { name: user?.name ?? '' })}
              </p>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
                {t('dashboard.todayAtClinic', { date: formatClinicDate(t) })}{' '}
                <span className="font-semibold text-navy-900">{t('dashboard.reviewCount', { count: review })}</span>
                {pendingSubs > 0 ? (
                  <>
                    {' '}
                    <span className="font-semibold text-navy-900">
                      {t('dashboard.andNewSubmissions', { count: pendingSubs })}
                    </span>
                  </>
                ) : null}{' '}
                {t('dashboard.awaitingSuffix')}
              </p>
              {user?.org ? <p className="mt-2 text-xs text-slate-500">{user.org}</p> : null}
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

type ExpertQueueFilter = 'all' | 'sla' | 'urgent'

function expertGreeting(name: string, t: TranslateFn) {
  const h = new Date().getHours()
  const key =
    h < 12 ? 'dashboard.expertGoodMorning' : h < 18 ? 'dashboard.expertGoodAfternoon' : 'dashboard.expertGoodEvening'
  return t(key, { name })
}

function ExpertMetric({
  label,
  value,
  hint,
  active,
  emphasize,
  onClick,
  ariaLabel,
  delayMs = 0,
}: {
  label: string
  value: number
  hint?: string
  active?: boolean
  emphasize?: boolean
  onClick?: () => void
  ariaLabel: string
  delayMs?: number
}) {
  const base =
    'vm-expert-card vm-fade-up px-4 py-3.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600'
  const activeCls = active
    ? 'border-teal-400 bg-accent-soft ring-1 ring-teal-200/60'
    : emphasize && value > 0
      ? 'border-[color:var(--vm-danger)]/35 bg-white'
      : ''
  const valueCls = emphasize && value > 0 ? 'text-[color:var(--vm-danger)]' : 'text-[color:var(--vm-text,#172b4d)]'
  const style = { animationDelay: `${delayMs}ms` } as const
  const body = (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className={`mt-1 font-display text-3xl font-semibold tabular-nums tracking-tight ${valueCls}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </>
  )
  if (!onClick)
    return (
      <div className={`${base} ${activeCls}`} style={style}>
        {body}
      </div>
    )
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={`${base} ${activeCls}`}
      style={style}
    >
      {body}
    </button>
  )
}

function ExpertDashboard() {
  const { cases, user } = useApp()
  const { t } = useLocale()
  const nav = useLocalizedNavigate()
  const [filter, setFilter] = useState<ExpertQueueFilter>('all')
  const [q, setQ] = useState('')
  const queue = cases.filter((c) => c.status === 'uzman_incelemesinde' || c.status === 'manuel_inceleme')
  const approvedCount = cases.filter((c) => c.status === 'onaylandi').length
  const recent = cases
    .filter((c) => c.status === 'onaylandi' || c.status === 'revizyon' || c.status === 'reddedildi')
    .slice(0, 6)
  const urgentN = queue.filter((c) => c.priority === 'STAT' || c.priority === 'Acil').length
  const slaTight = useMemo(() => queue.filter((c) => isSlaAttention(c.reviewDueAt)), [queue])
  const trend = useMemo(() => buildTrend(cases, t), [cases, t])
  const modalityDist = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of queue) {
      const key = (c.modality || t('common.dash')).toUpperCase()
      counts[key] = (counts[key] || 0) + 1
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [queue, t])

  const filteredQueue = useMemo(() => {
    let list = queue
    if (filter === 'sla') list = list.filter((c) => isSlaAttention(c.reviewDueAt))
    if (filter === 'urgent') list = list.filter((c) => c.priority === 'STAT' || c.priority === 'Acil')
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter((c) => {
      const study = c.modality ? studyLabel(t, c.modality, c.anatomicalRegion) : c.clinical.complaint
      return [c.patient.name, c.no, study, c.patient.species, c.modality].join(' ').toLowerCase().includes(needle)
    })
  }, [filter, q, queue, t])

  const worklistHref = filter === 'sla' ? '/kuyruk?sla=az' : '/kuyruk'
  const name = user?.name ?? ''

  return (
    <div className="space-y-6">
      {/* Brand hero — editorial photography, not patient imagery */}
      <section className="vm-fade-up relative overflow-hidden rounded-2xl border border-slate-200/60 bg-[color:var(--vm-midnight,#0b1728)] text-white shadow-soft">
        <ExpertWaveAccent className="pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full opacity-80" />
        <ExpertNodeAccent className="pointer-events-none absolute -left-6 top-4 h-36 w-36 opacity-40" />
        <div className="relative grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="flex flex-col justify-center px-6 py-7 sm:px-8 sm:py-9">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-200/90">
              {t('dashboard.expertBrandTag')}
            </p>
            <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl lg:text-[2rem]">
              {expertGreeting(name, t)}
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-300">{t('dashboard.expertSubtitle')}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => nav('/kuyruk')}>
                {t('dashboard.expertHeroCta')}
              </Button>
              <Button size="sm" variant="secondary" className="border-white/20 bg-white/5 text-white hover:bg-white/10" onClick={() => setFilter('sla')}>
                {t('dashboard.expertFilterSla')} · {slaTight.length}
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
              className="absolute inset-0 h-full w-full object-cover object-[50%_20%]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[color:var(--vm-midnight,#0b1728)] via-[color:var(--vm-midnight,#0b1728)]/55 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-[color:var(--vm-midnight,#0b1728)]/70 via-transparent to-[color:var(--vm-midnight,#0b1728)]/20" />
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ExpertMetric
          label={t('dashboard.expertPendingApproval')}
          value={queue.length}
          hint={t('dashboard.expertMetricReports')}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          ariaLabel={t('dashboard.expertMetricPendingAria', { count: queue.length })}
          delayMs={40}
        />
        <ExpertMetric
          label={t('dashboard.expertStatUrgentQueue')}
          value={urgentN}
          hint={t('dashboard.expertMetricPriorityReports')}
          active={filter === 'urgent'}
          onClick={() => setFilter('urgent')}
          ariaLabel={t('dashboard.expertMetricUrgentAria', { count: urgentN })}
          delayMs={80}
        />
        <ExpertMetric
          label={t('dashboard.expertSlaLowTime')}
          value={slaTight.length}
          hint={t('dashboard.expertMetricReports')}
          active={filter === 'sla'}
          emphasize={slaTight.length > 0}
          onClick={() => setFilter('sla')}
          ariaLabel={t('dashboard.expertSlaAria', { count: slaTight.length })}
          delayMs={120}
        />
        <LocalizedLink
          to="/raporlar"
          aria-label={`${t('dashboard.expertApprovedSession')}: ${approvedCount}`}
          className="vm-expert-card vm-fade-up block px-4 py-3.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          style={{ animationDelay: '160ms' }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{t('dashboard.expertApprovedSession')}</p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums tracking-tight text-[color:var(--vm-text,#172b4d)]">
            {approvedCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">{t('dashboard.expertMetricSession')}</p>
        </LocalizedLink>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="vm-fade-up overflow-hidden border-slate-200/70 p-4 shadow-soft" style={{ animationDelay: '180ms' }}>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{t('dashboard.expertChartWorkload')}</h2>
              <p className="text-[11px] text-slate-400">{t('dashboard.expertChartWorkloadHint')}</p>
            </div>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="expertTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0D9488" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0D9488" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }}
                  labelStyle={{ color: '#64748b' }}
                />
                <Area type="monotone" dataKey="yeni" name={t('dashboard.trendNew')} stroke="#0D9488" fill="url(#expertTrendFill)" strokeWidth={2} />
                <Area type="monotone" dataKey="tamamlanan" name={t('dashboard.trendCompleted')} stroke="#102A43" fill="transparent" strokeWidth={1.5} strokeDasharray="4 3" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="vm-fade-up overflow-hidden border-slate-200/70 p-4 shadow-soft" style={{ animationDelay: '220ms' }}>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{t('dashboard.expertChartModality')}</h2>
            <p className="text-[11px] text-slate-400">{t('dashboard.expertChartModalityHint')}</p>
          </div>
          {modalityDist.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">{t('dashboard.queueEmptyTitle')}</p>
          ) : (
            <div className="flex h-44 items-center gap-4">
              <div className="h-40 w-40 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={modalityDist} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={2}>
                      {modalityDist.map((_, i) => (
                        <Cell key={modalityDist[i].name} fill={['#0D9488', '#102A43', '#5EEAD4', '#64748B'][i % 4]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-0 flex-1 space-y-2">
                {modalityDist.map((row, i) => (
                  <li key={row.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: ['#0D9488', '#102A43', '#5EEAD4', '#64748B'][i % 4] }}
                      />
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

      <Card className="vm-fade-up overflow-hidden border-slate-200/70 shadow-soft" style={{ animationDelay: '260ms' }}>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-[color:var(--vm-text,#172b4d)]">
              {t('dashboard.expertPendingReports')}
            </h2>
            <p className="text-xs text-slate-500">{t('dashboard.expertPendingSubtitle')}</p>
          </div>
          <LocalizedLink to={worklistHref} className="text-sm font-semibold text-teal-700 transition hover:text-teal-800">
            {t('dashboard.expertFullWorklist')}
          </LocalizedLink>
        </div>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('dashboard.expertFilterAria')}>
            {(
              [
                ['all', t('dashboard.expertFilterAll'), queue.length],
                ['sla', t('dashboard.expertFilterSla'), slaTight.length],
                ['urgent', t('dashboard.expertFilterUrgent'), urgentN],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                aria-pressed={filter === id}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  filter === id
                    ? 'bg-[color:var(--vm-sidebar,#102a43)] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label}
                <span className={`ml-1 tabular-nums ${filter === id ? 'text-white/65' : 'text-slate-400'}`}>{count}</span>
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="expert-dash-q">
            {t('common.search')}
          </label>
          <input
            id="expert-dash-q"
            className="input max-w-xs py-2 text-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('dashboard.expertSearchPlaceholder')}
          />
        </div>
        <ExpertWorklistTable
          compact
          items={filteredQueue}
          emptyTitle={filter === 'all' ? t('dashboard.queueEmptyTitle') : t('dashboard.expertSlaEmptyFilter')}
          emptyText={filter === 'all' ? t('dashboard.queueEmptyText') : t('dashboard.expertSlaEmptyFilterText')}
          emptyAction={
            filter !== 'all' ? (
              <Button size="sm" variant="secondary" onClick={() => setFilter('all')}>
                {t('dashboard.expertFilterAll')}
              </Button>
            ) : undefined
          }
        />
      </Card>

      {recent.length > 0 ? (
        <div className="vm-fade-up rounded-vm border border-slate-200/70 bg-white/80 px-4 py-3 shadow-soft backdrop-blur-sm" style={{ animationDelay: '300ms' }}>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
            {t('dashboard.expertActivityStrip')}
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {recent.map((c) => (
              <li key={c.id}>
                <LocalizedLink
                  to={`/vakalar/${c.id}/calisma`}
                  className="inline-flex items-center gap-2 text-sm text-[color:var(--vm-text,#172b4d)] transition hover:text-teal-700"
                >
                  <span className="font-medium">{c.patient.name}</span>
                  <StatusBadge status={c.status} />
                </LocalizedLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function ownerStatusText(status: string, t: TranslateFn) {
  const map: Record<string, string> = {
    taslak: t('dashboard.ownerStatusDraft'),
    isleniyor: t('dashboard.ownerStatusProcessing'),
    ai_analizi: t('dashboard.ownerStatusAi'),
    uzman_incelemesinde: t('dashboard.ownerStatusReview'),
    revizyon: t('dashboard.ownerStatusReview'),
    reddedildi: t('dashboard.ownerStatusRejected'),
    onaylandi: t('dashboard.ownerStatusApproved'),
  }
  return map[status] ?? map.ai_analizi
}

function ownerGreeting(name: string, t: TranslateFn) {
  const h = new Date().getHours()
  const key = h < 12 ? 'dashboard.ownerGoodMorning' : h < 18 ? 'dashboard.ownerGoodAfternoon' : 'dashboard.ownerGoodEvening'
  return t(key, { name })
}

function OwnerMetric({
  label,
  value,
  hint,
  to,
  delayMs = 0,
  emphasize,
}: {
  label: string
  value: number
  hint?: string
  to: string
  delayMs?: number
  emphasize?: boolean
}) {
  return (
    <LocalizedLink
      to={to}
      aria-label={`${label}: ${value}`}
      className={`vm-owner-card vm-fade-up block px-4 py-3.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
        emphasize && value > 0 ? 'border-emerald-300/70 ring-1 ring-emerald-100' : ''
      }`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p
        className={`mt-1 font-display text-3xl font-semibold tabular-nums tracking-tight ${
          emphasize && value > 0 ? 'text-emerald-700' : 'text-[color:var(--vm-text,#172b4d)]'
        }`}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </LocalizedLink>
  )
}

function OwnerDashboard() {
  const { cases, user, session, refreshBackendCases } = useApp()
  const { t, locale } = useLocale()
  const nav = useLocalizedNavigate()
  const [pets, setPets] = useState<BackendPet[]>([])
  const [subs, setSubs] = useState<BackendImagingSubmission[]>([])
  const [q, setQ] = useState('')

  useEffect(() => {
    void refreshBackendCases()
    void listPets().then(setPets).catch(() => setPets([]))
    void listSubmissions().then(setSubs).catch(() => setSubs([]))
  }, [refreshBackendCases])

  // Match ReportList: only this owner's pets — not every approved case in the DB.
  const mine = useMemo(
    () =>
      cases.filter((c) =>
        caseBelongsToOwner(c, { email: session?.email ?? user?.email, name: user?.name }),
      ),
    [cases, session?.email, user?.email, user?.name],
  )
  const ready = useMemo(() => mine.filter((c) => c.status === 'onaylandi'), [mine])
  const inProgress = useMemo(
    () => mine.filter((c) => c.status !== 'onaylandi' && c.status !== 'reddedildi'),
    [mine],
  )
  const pendingSubs = subs.filter((s) => s.status === 'pending_verification' || s.status === 'needs_info').length
  const trend = useMemo(() => buildTrend(mine, t), [mine, t])
  const statusDist = useMemo(() => {
    const buckets: { key: string; name: string; value: number; color: string }[] = [
      { key: 'ready', name: t('dashboard.ownerChartReady'), value: 0, color: '#059669' },
      { key: 'review', name: t('dashboard.ownerChartReview'), value: 0, color: '#0EA5E9' },
      { key: 'process', name: t('dashboard.ownerChartProcess'), value: 0, color: '#D99A32' },
      { key: 'other', name: t('dashboard.ownerChartOther'), value: 0, color: '#64748B' },
    ]
    for (const c of mine) {
      if (c.status === 'onaylandi') buckets[0].value += 1
      else if (c.status === 'uzman_incelemesinde' || c.status === 'revizyon') buckets[1].value += 1
      else if (c.status === 'isleniyor' || c.status === 'ai_analizi' || c.status === 'taslak') buckets[2].value += 1
      else buckets[3].value += 1
    }
    return buckets.filter((b) => b.value > 0)
  }, [mine, t])

  const filteredMine = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return mine
    return mine.filter((c) =>
      [c.patient.name, c.no, c.patient.species, c.patient.breed, c.clinical.complaint].join(' ').toLowerCase().includes(needle),
    )
  }, [mine, q])

  const name = user?.name ?? ''

  return (
    <div className="space-y-6">
      <section className="vm-fade-up relative overflow-hidden rounded-2xl border border-slate-200/60 bg-[color:var(--vm-midnight,#0b1a2e)] text-white shadow-soft">
        <OwnerWaveAccent className="pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full opacity-80" />
        <OwnerPawAccent className="pointer-events-none absolute -left-2 top-6 h-32 w-32 opacity-50" />
        <div className="relative grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="flex flex-col justify-center px-6 py-7 sm:px-8 sm:py-9">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-200/90">
              {t('dashboard.ownerBrandTag')}
            </p>
            <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl lg:text-[2rem]">
              {ownerGreeting(name, t)}
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-300">{t('dashboard.ownerSubtitle')}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => nav('/basvurular')} icon={<UploadCloud className="h-4 w-4" />}>
                {t('dashboard.ownerNewRequest')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="border-white/20 bg-white/5 text-white hover:bg-white/10"
                onClick={() => nav('/raporlar')}
              >
                {t('nav.myReports')}
                {ready.length > 0 ? ` · ${ready.length}` : ''}
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
              className="absolute inset-0 h-full w-full object-cover object-[52%_18%]"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[color:var(--vm-midnight,#0b1a2e)] via-[color:var(--vm-midnight,#0b1a2e)]/55 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-[color:var(--vm-midnight,#0b1a2e)]/70 via-transparent to-[color:var(--vm-midnight,#0b1a2e)]/20" />
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OwnerMetric
          label={t('dashboard.ownerStatPets')}
          value={pets.length}
          hint={t('dashboard.ownerStatPetsHint')}
          to="/hayvanlar"
          delayMs={40}
        />
        <OwnerMetric
          label={t('dashboard.ownerStatPending')}
          value={pendingSubs}
          hint={t('dashboard.ownerStatPendingHint')}
          to="/basvurular"
          delayMs={80}
        />
        <OwnerMetric
          label={t('dashboard.ownerStatInProgress')}
          value={inProgress.length}
          hint={t('dashboard.ownerStatInProgressHint')}
          to="/raporlar"
          delayMs={120}
        />
        <OwnerMetric
          label={t('dashboard.ownerStatReady')}
          value={ready.length}
          hint={t('dashboard.ownerStatReadyHint')}
          to="/raporlar"
          delayMs={160}
          emphasize
        />
      </div>

      {ready.length > 0 ? (
        <div className="vm-fade-up flex flex-col gap-3 overflow-hidden rounded-2xl border border-emerald-200/70 bg-gradient-to-r from-emerald-50 via-white to-sky-50/80 px-4 py-3.5 shadow-soft sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          </div>
          <p className="flex-1 text-sm text-emerald-950">
            <span className="font-semibold">{t('dashboard.ownerReadyBanner', { count: ready.length })}</span>{' '}
            {t('dashboard.ownerReadyBannerBody')}
          </p>
          <Button variant="success" size="sm" onClick={() => nav('/raporlar')} icon={<FileText className="h-4 w-4" />}>
            {t('nav.myReports')}
          </Button>
        </div>
      ) : null}

      {pets.length > 0 ? (
        <div className="vm-fade-up" style={{ animationDelay: '180ms' }}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{t('dashboard.ownerPets')}</h2>
            <LocalizedLink to="/hayvanlar" className="text-xs font-semibold text-sky-700 transition hover:text-sky-800">
              {t('dashboard.ownerViewAllPets')}
            </LocalizedLink>
          </div>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {pets.map((p) => (
              <li key={p.pet_id}>
                <LocalizedLink
                  to="/hayvanlar"
                  className="vm-owner-card flex min-w-[148px] items-center gap-3 px-3 py-2.5"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-sky-700" aria-hidden>
                    <PawPrint className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{p.name}</span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {p.species}
                      {p.breed ? ` · ${p.breed}` : ''}
                    </span>
                  </span>
                </LocalizedLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card className="vm-fade-up overflow-hidden border-slate-200/70 p-4 shadow-soft" style={{ animationDelay: '200ms' }}>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{t('dashboard.ownerChartActivity')}</h2>
            <p className="text-[11px] text-slate-400">{t('dashboard.ownerChartActivityHint')}</p>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="ownerTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0EA5E9" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0EA5E9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Area type="monotone" dataKey="yeni" name={t('dashboard.trendNew')} stroke="#0EA5E9" fill="url(#ownerTrendFill)" strokeWidth={2} />
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
        <Card className="vm-fade-up overflow-hidden border-slate-200/70 p-4 shadow-soft" style={{ animationDelay: '240ms' }}>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-[color:var(--vm-text,#172b4d)]">{t('dashboard.ownerChartStatus')}</h2>
            <p className="text-[11px] text-slate-400">{t('dashboard.ownerChartStatusHint')}</p>
          </div>
          {statusDist.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">{t('dashboard.ownerNoCases')}</p>
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

      <Card className="vm-fade-up overflow-hidden border-slate-200/70 shadow-soft" style={{ animationDelay: '280ms' }}>
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-[color:var(--vm-text,#172b4d)]">
              {t('dashboard.ownerCasesTitle')}
            </h2>
            <p className="text-xs text-slate-500">{t('dashboard.ownerCasesSubtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="owner-dash-q">
              {t('common.search')}
            </label>
            <input
              id="owner-dash-q"
              className="input max-w-xs py-2 text-sm"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('dashboard.ownerSearchPlaceholder')}
            />
            <Button size="sm" variant="secondary" onClick={() => nav('/basvurular')}>
              {t('dashboard.ownerNewRequest')}
            </Button>
          </div>
        </div>
        {filteredMine.length === 0 ? (
          <EmptyState
            compact
            icon={<PawPrint className="h-5 w-5" />}
            title={t('dashboard.ownerNoCases')}
            action={
              <Button size="sm" onClick={() => nav('/basvurular')} icon={<UploadCloud className="h-4 w-4" />}>
                {t('dashboard.ownerNewRequest')}
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {filteredMine.map((c) => {
              const visibleStatus = c.status === 'revizyon' ? 'uzman_incelemesinde' : c.status
              return (
                <li
                  key={c.id}
                  className="flex flex-col gap-3 px-4 py-3.5 transition hover:bg-sky-50/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-100 to-slate-100 text-sky-800"
                      aria-hidden
                    >
                      <PawPrint className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[color:var(--vm-text,#172b4d)]">{c.patient.name}</p>
                        <StatusBadge status={visibleStatus} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {c.patient.species}
                        {c.patient.breed ? ` · ${c.patient.breed}` : ''}
                        {c.patient.age != null ? ` · ${t('dashboard.ownerAgeYears', { age: c.patient.age })}` : ''}
                        {' · '}
                        {c.no} · {fmtDate(c.createdAt, locale)}
                      </p>
                      <p className="mt-1.5 text-sm text-slate-600">{ownerStatusText(c.status, t)}</p>
                      {c.clinical.complaint ? (
                        <p className="mt-1 line-clamp-1 text-xs text-slate-400">
                          <span className="font-medium text-slate-500">{t('dashboard.ownerComplaint')}</span> {c.clinical.complaint}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
                    {c.status === 'onaylandi' ? (
                      <Button size="sm" onClick={() => nav(`/raporlar/${c.id}`)} icon={<FileText className="h-4 w-4" />}>
                        {t('dashboard.ownerViewReport')}
                      </Button>
                    ) : (
                      <p className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                        {t('dashboard.ownerNotifyWhenReady')}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

export function GpuChart({ height = 180 }: { height?: number }) {
  const { t } = useLocale()
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={GPU_SERIES} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="gpuFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#12a096" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#12a096" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#64748b' }} interval={11} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} unit="%" />
        <Tooltip formatter={(v: number) => [`%${v}`, t('dashboard.gpuUsage')]} labelStyle={{ color: '#12233a' }} contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
        <Area type="monotone" dataKey="gpu" stroke="#0b807a" strokeWidth={2} fill="url(#gpuFill)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

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

function ClinicOwnerDashboard() {
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

function AdminDashboard() {
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
          <ul className="divide-y divide-amber-100/80 border-t border-amber-100/80">
            {DEPLOYMENTS.slice(0, 3).map((d) => (
              <li key={d.version} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-[color:var(--vm-text,#172b4d)]">{d.version}</p>
                  <p className="text-xs text-slate-500">
                    {d.kind} · {fmtDate(d.date, locale)}
                  </p>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  {t('dashboard.adminDemoBadge')}
                </span>
              </li>
            ))}
          </ul>
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
