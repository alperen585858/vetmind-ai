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
import { AlertTriangle, ArrowRight, Clock, Search } from 'lucide-react'
import { useApp } from '../../../shared/shell/AppContext'
import { useLocale } from '../../../shared/shell/LocaleContext'
import type { TranslateFn } from '../../../i18n'
import { studyLabel } from '../../../shared/lib/displayClean'
import { Card } from '../../../shared/ui/Card'
import { ExpertNodeAccent, ExpertWaveAccent } from '../../../shared/ui/ExpertBrandMark'
import { ExpertWorklistTable, isUrgentCase } from '../ExpertWorklistTable'
import { Button } from '../../../shared/ui/Button'
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
  danger,
  onClick,
  ariaLabel,
  delayMs = 0,
}: {
  label: string
  value: number
  hint?: string
  active?: boolean
  emphasize?: boolean
  /** Solid red card (urgent queue). */
  danger?: boolean
  onClick?: () => void
  ariaLabel: string
  delayMs?: number
}) {
  const base =
    'vm-expert-card vm-fade-up px-4 py-3.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600'
  const activeCls = danger
    ? `!border-rose-700 !bg-rose-600 text-white hover:!bg-rose-700 ${active ? 'ring-4 ring-rose-300' : ''}`
    : active
      ? 'border-teal-400 bg-accent-soft ring-1 ring-teal-200/60'
      : emphasize && value > 0
        ? 'border-[color:var(--vm-danger)]/35 bg-white'
        : ''
  const valueCls = danger
    ? 'text-white'
    : emphasize && value > 0
      ? 'text-[color:var(--vm-danger)]'
      : 'text-[color:var(--vm-text,#172b4d)]'
  const labelCls = danger ? 'text-rose-50' : 'text-slate-500'
  const hintCls = danger ? 'text-rose-100' : 'text-slate-400'
  const style = { animationDelay: `${delayMs}ms` } as const
  const body = (
    <>
      <p className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${labelCls}`}>
        {danger ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : null}
        {label}
      </p>
      <p className={`mt-1 font-display text-3xl font-semibold tabular-nums tracking-tight ${valueCls}`}>{value}</p>
      {hint ? <p className={`mt-1 text-[11px] ${hintCls}`}>{hint}</p> : null}
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
  const urgentN = queue.filter(isUrgentCase).length
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
    if (filter === 'urgent') list = list.filter(isUrgentCase)
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list.filter((c) => {
      const study = c.modality ? studyLabel(t, c.modality, c.anatomicalRegion) : c.clinical.complaint
      return [c.patient.name, c.no, study, c.patient.species, c.modality].join(' ').toLowerCase().includes(needle)
    })
  }, [filter, q, queue, t])

  const worklistHref = filter === 'sla' ? '/kuyruk?sla=az' : filter === 'urgent' ? '/kuyruk?acil=1' : '/kuyruk'
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
          hint={urgentN > 0 ? t('dashboard.expertMetricPriorityReports') : t('dashboard.expertUrgentHintNone')}
          danger
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
          to="/vakalar?durum=onaylandi"
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

      <section
        className="vm-fade-up overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        style={{ animationDelay: '260ms' }}
        aria-labelledby="expert-queue-title"
      >
        <div className="flex flex-col gap-1 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="expert-queue-title" className="flex items-center gap-2 font-display text-lg font-semibold text-slate-900">
              {t('dashboard.expertPendingReports')}
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">{queue.length}</span>
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{t('dashboard.expertPendingSubtitle')}</p>
          </div>
          <LocalizedLink
            to={worklistHref}
            className="inline-flex items-center gap-1 self-start rounded-lg px-2 py-1 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 hover:text-teal-800"
          >
            {t('dashboard.expertFullWorklist')}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </LocalizedLink>
        </div>
        <div className="mt-4 flex flex-col gap-3 border-b border-slate-200 px-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('dashboard.expertFilterAria')}>
            {(
              [
                ['all', t('dashboard.expertFilterAll'), queue.length, null],
                ['urgent', t('dashboard.expertFilterUrgent'), urgentN, <AlertTriangle key="i" className="h-4 w-4" aria-hidden />],
                ['sla', t('dashboard.expertFilterSla'), slaTight.length, <Clock key="i" className="h-4 w-4" aria-hidden />],
              ] as const
            ).map(([id, label, count, icon]) => {
              const active = filter === id
              const urgentTab = id === 'urgent' && count > 0
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(id)}
                  className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-3 pt-1 text-sm font-semibold transition ${
                    active ? 'border-teal-600 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
                  } ${urgentTab && !active ? 'text-rose-700' : ''}`}
                >
                  {icon}
                  {label}
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
                      urgentTab ? 'bg-rose-600 text-white' : active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
          <label className="relative mb-3 block w-full sm:max-w-xs" htmlFor="expert-dash-q">
            <span className="sr-only">{t('common.search')}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              id="expert-dash-q"
              type="search"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('dashboard.expertSearchPlaceholder')}
            />
          </label>
        </div>
        <ExpertWorklistTable
          compact
          items={filteredQueue}
          order={filter === 'sla' ? 'urgent' : 'newest'}
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
      </section>

    </div>
  )
}
