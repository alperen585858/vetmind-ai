import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronRight, Clock, MessageSquare, RefreshCw, Stethoscope, UserRound, UsersRound } from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import { getClinicStats } from '../../shared/api'
import { modalityLabel, regionLabel } from '../../shared/lib/displayClean'
import { formatSlaRemaining, slaBadgeClass, slaLabelsFromT, slaTone } from '../../shared/lib/reviewSla'
import { reviewerInitials } from '../../shared/lib/reviewer'
import type { BackendClinicStats, VetCase } from '../../shared/types'
import { CardWave } from '../../shared/ui/CardWave'
import { HoloOrgan } from '../../shared/ui/HoloOrgan'
import { SpeciesIcon3D } from '../../shared/ui/SpeciesIcon3D'
import { StatusBadge } from '../../shared/ui/StatusBadge'
import { OVERDUE_FILTER } from '../cases/lib/caseStatusMap'
import { radiologistRows, vetRows, type TeamCounts } from './lib/clinicTeam'

type Tab = 'radyolog' | 'veteriner'

const STAT_STYLE = {
  teal: { card: 'from-teal-50/90 via-white to-white ring-teal-100', wave: '#5eead4' },
  sky: { card: 'from-sky-50 via-white to-white ring-sky-100', wave: '#7dd3fc' },
  amber: { card: 'from-amber-50 via-amber-50/40 to-white ring-amber-100', wave: '#fcd34d' },
  rose: { card: 'from-rose-50 via-white to-white ring-rose-100', wave: '#fda4af' },
} as const

/** Clinic manager: the radiologists reading this clinic's cases and the clinic's vets, with their workload. */
export default function ClinicTeam() {
  const { cases, refreshBackendCases, backendSyncing } = useApp()
  const { t, intlLocale } = useLocale()
  const nav = useLocalizedNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('sekme') === 'veteriner' ? 'veteriner' : 'radyolog'
  const [stats, setStats] = useState<BackendClinicStats | null>(null)

  const load = () => {
    void refreshBackendCases()
    void getClinicStats()
      .then(setStats)
      .catch(() => setStats(null))
  }
  useEffect(load, [refreshBackendCases]) // eslint-disable-line react-hooks/exhaustive-deps

  const rad = useMemo(() => radiologistRows(cases, t, intlLocale), [cases, t, intlLocale])
  const vets = useMemo(() => vetRows(cases, stats?.staff ?? [], intlLocale), [cases, stats, intlLocale])
  const openTotal = rad.rows.reduce((n, r) => n + r.open, 0) + rad.unassigned.length

  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params)
    if (next === 'veteriner') p.set('sekme', 'veteriner')
    else p.delete('sekme')
    setParams(p, { replace: true })
  }

  const statCards: { label: string; value: number; hint: string; tone: keyof typeof STAT_STYLE; onClick?: () => void }[] = [
    { label: t('team.statRadiologists'), value: rad.rows.length, hint: t('team.statRadiologistsHint'), tone: 'teal', onClick: () => setTab('radyolog') },
    { label: t('team.statVets'), value: vets.length, hint: t('team.statVetsHint'), tone: 'sky', onClick: () => setTab('veteriner') },
    { label: t('team.statOpen'), value: openTotal, hint: t('team.statOpenHint'), tone: 'amber', onClick: () => nav('/vakalar?durum=rapor-bekleyen') },
    {
      label: t('team.statOverdue'),
      value: rad.overdue,
      hint: rad.overdue ? t('team.statOverdueHint') : t('team.statOverdueNone'),
      tone: 'rose',
      onClick: () => nav(`/vakalar?durum=${OVERDUE_FILTER}`),
    },
  ]

  return (
    <div className="vm-fade-up space-y-5 text-slate-800">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-[#102a43] sm:text-4xl">{t('team.title')}</h1>
          <p className="mt-1.5 text-sm text-slate-500">{t('team.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={backendSyncing}
          className="inline-flex items-center gap-2 self-start rounded-xl bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${backendSyncing ? 'animate-spin' : ''}`} aria-hidden />
          {t('common.refresh')}
        </button>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((s) => {
          const st = STAT_STYLE[s.tone]
          return (
            <button
              key={s.label}
              type="button"
              onClick={s.onClick}
              className={`relative flex min-h-[120px] items-start overflow-hidden rounded-3xl bg-gradient-to-br px-4 pb-5 pt-4 text-left shadow-[0_4px_18px_-8px_rgba(15,23,42,0.15)] ring-1 transition duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${st.card}`}
            >
              <CardWave color={st.wave} />
              <span className="relative min-w-0">
                <span className="block text-sm font-semibold leading-snug text-slate-700">{s.label}</span>
                <span className="mt-1 block font-display text-4xl font-bold leading-none tabular-nums text-[#102a43]">{s.value}</span>
                <span className="mt-2.5 block text-xs font-medium leading-snug text-slate-500">{s.hint}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div role="tablist" aria-label={t('team.title')} className="inline-flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
        <TabButton active={tab === 'radyolog'} onClick={() => setTab('radyolog')} icon={<Stethoscope className="h-4 w-4" aria-hidden />}>
          {t('team.tabRadiologists')} <span className="tabular-nums opacity-70">({rad.rows.length})</span>
        </TabButton>
        <TabButton active={tab === 'veteriner'} onClick={() => setTab('veteriner')} icon={<UsersRound className="h-4 w-4" aria-hidden />}>
          {t('team.tabVets')} <span className="tabular-nums opacity-70">({vets.length})</span>
        </TabButton>
      </div>

      {tab === 'radyolog' ? (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {rad.rows.map((r) => (
            <PersonCard
              key={r.id}
              name={r.name}
              role={t('team.roleRadiologist')}
              avatarClass="bg-teal-50 text-teal-700 ring-teal-100"
              counts={r}
              alert={r.overdue > 0}
              onOpenAll={() => nav(`/vakalar?uzman=${encodeURIComponent(r.id)}`)}
              onOverdue={r.overdue ? () => nav(`/vakalar?uzman=${encodeURIComponent(r.id)}&durum=${OVERDUE_FILTER}`) : undefined}
              listTitle={t('team.assignedOpen')}
              emptyText={t('team.noOpenAssigned')}
            >
              {r.openCases.slice(0, 4).map((c) => (
                <CaseLine key={c.id} c={c} withDue />
              ))}
              {r.openCases.length > 4 ? <MoreLine n={r.openCases.length - 4} onClick={() => nav(`/vakalar?uzman=${encodeURIComponent(r.id)}`)} /> : null}
            </PersonCard>
          ))}

          {rad.unassigned.length ? (
            <section className="rounded-3xl bg-amber-50/60 p-5 ring-1 ring-amber-200">
              <h2 className="flex items-center gap-2 font-display text-base font-semibold text-amber-900">
                <UserRound className="h-4 w-4" aria-hidden />
                {t('team.unassignedTitle', { count: rad.unassigned.length })}
              </h2>
              <p className="mt-1 text-xs text-amber-800/80">{t('team.unassignedHint')}</p>
              <ul className="mt-3 space-y-1.5">
                {rad.unassigned.slice(0, 5).map((c) => (
                  <CaseLine key={c.id} c={c} withDue />
                ))}
              </ul>
            </section>
          ) : null}

          {!rad.rows.length && !rad.unassigned.length ? <EmptyCard text={t('team.emptyRadiologists')} /> : null}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {vets.map((v) => (
            <PersonCard
              key={v.email}
              name={v.name}
              role={v.name === v.email ? t('team.roleVet') : v.email}
              avatarClass="bg-sky-50 text-sky-700 ring-sky-100"
              badge={
                v.active == null ? null : (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                      v.active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-50 text-slate-500 ring-slate-200'
                    }`}
                  >
                    {v.active ? t('admin.activeStaff') : t('admin.inactiveStaff')}
                  </span>
                )
              }
              counts={v}
              totalLabel={t('team.colSent')}
              alert={v.overdue > 0}
              onOpenAll={() => nav(`/vakalar?veteriner=${encodeURIComponent(v.email)}`)}
              onMessage={v.active ? () => nav(`/mesajlar?yeni=${encodeURIComponent(v.email)}`) : undefined}
              listTitle={t('team.recentSent')}
              emptyText={t('team.noCasesSent')}
            >
              {v.recent.slice(0, 4).map((c) => (
                <CaseLine key={c.id} c={c} />
              ))}
              {v.recent.length > 4 ? <MoreLine n={v.recent.length - 4} onClick={() => nav(`/vakalar?veteriner=${encodeURIComponent(v.email)}`)} /> : null}
            </PersonCard>
          ))}
          {!vets.length ? <EmptyCard text={t('team.emptyVets')} /> : null}
        </div>
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
        active ? 'bg-teal-600 text-white shadow-[0_4px_12px_-4px_rgba(13,148,136,0.7)]' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function PersonCard({
  name,
  role,
  avatarClass,
  badge,
  counts,
  totalLabel,
  alert,
  onOpenAll,
  onOverdue,
  onMessage,
  listTitle,
  emptyText,
  children,
}: {
  name: string
  role: string
  avatarClass: string
  badge?: ReactNode
  counts: TeamCounts
  totalLabel?: string
  alert: boolean
  onOpenAll: () => void
  onOverdue?: () => void
  onMessage?: () => void
  listTitle: string
  emptyText: string
  children: ReactNode
}) {
  const { t } = useLocale()
  const hasItems = Array.isArray(children) ? children.some(Boolean) : Boolean(children)
  const tiles: { label: string; value: number; cls: string; onClick?: () => void }[] = [
    ...(totalLabel ? [{ label: totalLabel, value: counts.total, cls: 'from-sky-50 text-sky-800 ring-sky-100' }] : []),
    { label: t('team.colOpen'), value: counts.open, cls: 'from-teal-50 text-teal-800 ring-teal-100' },
    { label: t('team.colOverdue'), value: counts.overdue, cls: counts.overdue ? 'from-rose-50 text-rose-700 ring-rose-200' : 'from-slate-50 text-slate-400 ring-slate-100', onClick: onOverdue },
    ...(totalLabel ? [] : [{ label: t('team.colDueSoon'), value: counts.dueSoon, cls: counts.dueSoon ? 'from-amber-50 text-amber-800 ring-amber-100' : 'from-slate-50 text-slate-400 ring-slate-100' }]),
    { label: t('team.colApproved'), value: counts.approved, cls: 'from-emerald-50 text-emerald-800 ring-emerald-100' },
  ]
  return (
    <section className={`flex flex-col rounded-3xl bg-white p-5 shadow-[0_4px_18px_-10px_rgba(15,23,42,0.2)] ring-1 ${alert ? 'ring-rose-200' : 'ring-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold ring-1 ${avatarClass}`}>{reviewerInitials(name)}</span>
          <div className="min-w-0">
            <h2 className="truncate font-display text-base font-semibold text-[#102a43]">{name}</h2>
            <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="truncate">{role}</span>
              {badge}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
        {onMessage ? (
          <button
            type="button"
            onClick={onMessage}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-teal-700 ring-1 ring-inset ring-teal-200 transition hover:bg-teal-50"
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            {t('team.sendMessage')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenAll}
          aria-label={`${name} — ${t('team.allCases')}`}
          title={t('team.allCases')}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white shadow-[0_4px_12px_-4px_rgba(13,148,136,0.7)] transition hover:bg-teal-700"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
        </div>
      </div>

      <dl className={`mt-4 grid gap-2 ${tiles.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {tiles.map((m) => {
          const body = (
            <>
              <dd className="font-display text-2xl font-bold leading-none tabular-nums">{m.value}</dd>
              <dt className="mt-1 truncate text-[10px] font-semibold text-slate-500">{m.label}</dt>
            </>
          )
          return m.onClick ? (
            <button key={m.label} type="button" onClick={m.onClick} className={`rounded-xl bg-gradient-to-b to-white px-2.5 py-2 text-left ring-1 transition hover:ring-2 ${m.cls}`}>
              {body}
            </button>
          ) : (
            <div key={m.label} className={`rounded-xl bg-gradient-to-b to-white px-2.5 py-2 ring-1 ${m.cls}`}>
              {body}
            </div>
          )
        })}
      </dl>

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{listTitle}</p>
      {hasItems ? <ul className="mt-2 space-y-1.5">{children}</ul> : <p className="mt-2 text-sm text-slate-400">{emptyText}</p>}
    </section>
  )
}

function CaseLine({ c, withDue = false }: { c: VetCase; withDue?: boolean }) {
  const { t } = useLocale()
  const nav = useLocalizedNavigate()
  return (
    <li>
      <button
        type="button"
        onClick={() => nav(`/vakalar/${c.id}`)}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-slate-50"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-sky-50 to-slate-100 ring-1 ring-slate-200" aria-hidden>
          <SpeciesIcon3D species={c.patient.species} size={26} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-900">{c.patient.name}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="font-bold text-sky-800">{(c.modality || '').toUpperCase() === 'CT' ? modalityLabel(t, 'CT') : c.modality}</span>
            <HoloOrgan region={c.anatomicalRegion} size={14} />
            <span className="truncate">{regionLabel(t, c.anatomicalRegion) || t('common.dash')}</span>
          </span>
        </span>
        {withDue && c.reviewDueAt ? (
          <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${slaBadgeClass(slaTone(c.reviewDueAt))}`}>
            <Clock className="h-3 w-3" aria-hidden />
            {formatSlaRemaining(c.reviewDueAt, Date.now(), slaLabelsFromT(t))}
          </span>
        ) : (
          <span className="shrink-0">
            <StatusBadge status={c.status} />
          </span>
        )}
      </button>
    </li>
  )
}

function MoreLine({ n, onClick }: { n: number; onClick: () => void }) {
  const { t } = useLocale()
  return (
    <li>
      <button type="button" onClick={onClick} className="px-2 py-1 text-xs font-semibold text-teal-700 hover:underline">
        {t('team.moreCases', { count: n })}
      </button>
    </li>
  )
}

function EmptyCard({ text }: { text: string }) {
  return <p className="rounded-3xl bg-white px-5 py-10 text-center text-sm text-slate-400 ring-1 ring-slate-200 lg:col-span-2">{text}</p>
}
