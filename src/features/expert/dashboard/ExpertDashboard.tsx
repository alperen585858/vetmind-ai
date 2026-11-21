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
import { useMemo, useState } from 'react'
import { useApp } from '../../../shared/shell/AppContext'
import { useLocale } from '../../../shared/shell/LocaleContext'
import type { TranslateFn } from '../../../i18n'
import { studyLabel } from '../../../shared/lib/displayClean'
import { Card } from '../../../shared/ui/Card'
import { ExpertNodeAccent, ExpertWaveAccent } from '../../../shared/ui/ExpertBrandMark'
import { ExpertWorklistTable } from '../ExpertWorklistTable'
import { Button } from '../../../shared/ui/Button'
import { StatusBadge } from '../../../shared/ui/StatusBadge'
import { isSlaAttention } from '../../../shared/lib/reviewSla'

import { buildTrend } from '../../../shared/lib/trend'

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

export function ExpertDashboard() {
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
