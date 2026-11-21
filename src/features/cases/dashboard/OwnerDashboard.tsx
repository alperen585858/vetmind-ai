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
  CheckCircle2,
  Clock,
  FileText,
  PawPrint,
  UploadCloud,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../../context/AppContext'
import { useLocale } from '../../../context/LocaleContext'
import type { TranslateFn } from '../../../i18n'
import { Card } from '../../../components/Card'
import { OwnerPawAccent, OwnerWaveAccent } from '../../../components/ExpertBrandMark'
import { Button } from '../../../components/Button'
import { StatusBadge } from '../../../components/StatusBadge'
import { EmptyState } from '../../../components/EmptyState'
import { listPets, listSubmissions } from '../../../lib/backend'
import { fmtDate } from '../../../lib/format'
import { caseBelongsToOwner } from '../../../lib/caseMapper'
import type { BackendPet, BackendImagingSubmission } from '../../../types'

import { buildTrend } from '../../dashboard/trend'

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

export function OwnerDashboard() {
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
