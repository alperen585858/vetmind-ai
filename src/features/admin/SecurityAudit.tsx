import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Download, Filter, Loader2, LogIn, ShieldAlert, ShieldCheck, Timer } from 'lucide-react'
import { PageHeader } from '../../shared/ui/PageHeader'
import { Card, CardHeader } from '../../shared/ui/Card'
import { Button } from '../../shared/ui/Button'
import { EmptyState } from '../../shared/ui/EmptyState'
import { useLocale } from '../../shared/shell/LocaleContext'
import { useApp } from '../../shared/shell/AppContext'
import { toastErrorBody } from '../../shared/lib/apiErrors'
import {
  downloadAuditCsv,
  getAuditSummary,
  listAuditEvents,
  type AuditEventRow,
  type AuditFilters,
  type AuditSummary,
} from '../../shared/api'
import { EVENT_GROUPS, eventLabel, filtersFromSearch, filtersToSearch, toApiFilters } from './auditLib'

const OUTCOME_STYLE: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-800',
  denied: 'bg-rose-50 text-rose-800',
  error: 'bg-amber-50 text-amber-800',
  info: 'bg-slate-100 text-slate-700',
}

/**
 * Issue #106: admin security / audit log. Read-only: it never changes, locks or signs out
 * an account. Clinic owners only see their own clinic (enforced by the backend).
 */
export default function SecurityAudit() {
  const { t, locale } = useLocale()
  const { pushToast } = useApp()
  const [params, setParams] = useSearchParams()
  const applied = useMemo(() => filtersFromSearch(params), [params])
  const [draft, setDraft] = useState<AuditFilters>(applied)
  const [rows, setRows] = useState<AuditEventRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [scope, setScope] = useState<string | null>(null)
  const [summary, setSummary] = useState<AuditSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openRow, setOpenRow] = useState<string | null>(null)

  const fmt = useMemo(
    () => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'tr-TR', { dateStyle: 'short', timeStyle: 'medium' }),
    [locale],
  )

  useEffect(() => setDraft(applied), [applied])

  useEffect(() => {
    getAuditSummary()
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    listAuditEvents(toApiFilters(applied), { signal: ctrl.signal })
      .then((page) => {
        setRows(page.items)
        setCursor(page.next_cursor ?? null)
        setScope(page.scoped_to_clinic ?? null)
      })
      .catch((err) => {
        if (!ctrl.signal.aborted) setError(toastErrorBody(err, t) || t('security.loadFailed'))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [applied, t])

  const loadMore = useCallback(async () => {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const page = await listAuditEvents(toApiFilters(applied), { cursor })
      setRows((prev) => [...prev, ...page.items])
      setCursor(page.next_cursor ?? null)
    } catch (err) {
      pushToast({ tone: 'error', title: t('security.loadFailed'), body: toastErrorBody(err, t) })
    } finally {
      setLoadingMore(false)
    }
  }, [applied, cursor, pushToast, t])

  const apply = (e: FormEvent) => {
    e.preventDefault()
    setParams(filtersToSearch(draft), { replace: true })
  }

  const showActor = (actor: string) => setParams(filtersToSearch({ ...applied, actor }), { replace: true })

  const exportCsv = async () => {
    setExporting(true)
    try {
      const res = await downloadAuditCsv(toApiFilters(applied))
      pushToast({
        tone: 'success',
        title: t('security.exported', { n: res.rows }),
        body: res.truncated ? t('security.exportTruncated') : undefined,
      })
    } catch (err) {
      pushToast({ tone: 'error', title: t('security.exportFailed'), body: toastErrorBody(err, t) })
    } finally {
      setExporting(false)
    }
  }

  const cards = summary
    ? [
        { label: t('security.cardLogins'), value: summary.logins_24h, icon: <LogIn className="h-5 w-5" />, tone: 'text-emerald-700' },
        { label: t('security.cardFailed'), value: summary.failed_logins_24h, icon: <ShieldAlert className="h-5 w-5" />, tone: 'text-rose-700' },
        { label: t('security.cardRateLimited'), value: summary.rate_limited_24h, icon: <Timer className="h-5 w-5" />, tone: 'text-amber-700' },
        { label: t('security.cardSuspicious'), value: summary.suspicious.length, icon: <AlertTriangle className="h-5 w-5" />, tone: 'text-rose-700' },
      ]
    : []

  return (
    <>
      <PageHeader
        title={t('security.title')}
        subtitle={scope ? t('security.scopedSubtitle', { clinic: scope }) : t('security.subtitle')}
        crumbs={[{ label: t('admin.crumbSystem'), to: '/' }, { label: t('security.title') }]}
        actions={
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={exporting} onClick={() => void exportCsv()}>
            {exporting ? t('common.loading') : t('security.exportCsv')}
          </Button>
        }
      />

      {cards.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map((c) => (
            <Card key={c.label} className="p-4">
              <div className={`flex items-center gap-2 ${c.tone}`}>
                {c.icon}
                <span className="text-2xl font-bold tabular-nums">{c.value}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{c.label}</p>
            </Card>
          ))}
        </div>
      )}

      {summary && summary.suspicious.length > 0 && (
        <Card className="mb-5 border-rose-200 p-5">
          <CardHeader title={t('security.suspiciousTitle')} icon={<AlertTriangle className="h-5 w-5 text-rose-600" />} />
          <ul className="space-y-2">
            {summary.suspicious.map((s, i) => (
              <li key={`${s.kind}-${s.actor}-${i}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">
                <span className="min-w-0 flex-1">
                  {t(`security.suspicious.${s.kind}`, { actor: s.actor ?? '—', n: s.count })}
                  <span className="ml-2 text-xs text-rose-700">{fmt.format(new Date(s.last_at))}</span>
                </span>
                {s.actor && s.actor !== 'anonymous' && (
                  <button type="button" className="text-xs font-semibold text-rose-800 hover:underline" onClick={() => showActor(s.actor!)}>
                    {t('security.showEvents')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">{t('security.suspiciousNote')}</p>
        </Card>
      )}

      <Card className="mb-5 p-4">
        <form onSubmit={apply} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" aria-label={t('security.filters')}>
          <label className="block lg:col-span-2">
            <span className="label">{t('security.filterEvent')}</span>
            <select
              className="input"
              value={draft.event_type ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, event_type: e.target.value }))}
            >
              {EVENT_GROUPS.map((g) => (
                <option key={g || 'all'} value={g}>
                  {t(`security.groups.${g ? g.replace(/\.$/, '_all').replace(/\./g, '_') : 'all'}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">{t('security.filterActor')}</span>
            <input
              className="input"
              value={draft.actor ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, actor: e.target.value }))}
              placeholder="vet@…"
              maxLength={120}
            />
          </label>
          <label className="block">
            <span className="label">{t('security.filterOutcome')}</span>
            <select
              className="input"
              value={draft.outcome ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, outcome: e.target.value as AuditFilters['outcome'] }))}
            >
              <option value="">{t('security.outcomeAll')}</option>
              {(['success', 'denied', 'error', 'info'] as const).map((o) => (
                <option key={o} value={o}>
                  {t(`security.outcome.${o}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">{t('security.filterSince')}</span>
            <input type="date" className="input" value={draft.since ?? ''} onChange={(e) => setDraft((d) => ({ ...d, since: e.target.value }))} />
          </label>
          <label className="block">
            <span className="label">{t('security.filterUntil')}</span>
            <input type="date" className="input" value={draft.until ?? ''} onChange={(e) => setDraft((d) => ({ ...d, until: e.target.value }))} />
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
            <Button type="submit" size="sm" icon={<Filter className="h-3.5 w-3.5" />}>
              {t('security.apply')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
            >
              {t('security.clear')}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-0">
        {loading ? (
          <p className="flex items-center gap-2 p-5 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
          </p>
        ) : error ? (
          <p className="p-5 text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : rows.length === 0 ? (
          <EmptyState compact icon={<ShieldCheck className="h-5 w-5" />} title={t('security.empty')} />
        ) : (
          <ul className="divide-y divide-slate-100" aria-label={t('security.listAria')}>
            {rows.map((r) => (
              <li key={r.event_id} className={r.suspicious ? 'bg-rose-50/60' : undefined}>
                <button
                  type="button"
                  className="grid w-full grid-cols-1 gap-1 px-4 py-3 text-left text-sm hover:bg-slate-50 md:grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)_7rem] md:items-center md:gap-3"
                  aria-expanded={openRow === r.event_id}
                  onClick={() => setOpenRow((cur) => (cur === r.event_id ? null : r.event_id))}
                >
                  <span className="text-xs tabular-nums text-slate-500">{fmt.format(new Date(r.timestamp))}</span>
                  <span className="font-medium text-navy-900">
                    {eventLabel(t, r.event_type)}
                    {r.suspicious && (
                      <span className="ml-2 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                        {t('security.suspiciousBadge')}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-slate-700">{r.actor}</span>
                  <span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${OUTCOME_STYLE[r.outcome] ?? OUTCOME_STYLE.info}`}>
                      {t(`security.outcome.${r.outcome in OUTCOME_STYLE ? r.outcome : 'info'}`)}
                    </span>
                  </span>
                </button>
                {openRow === r.event_id && (
                  <dl className="grid gap-x-4 gap-y-1 bg-slate-50 px-4 pb-3 text-xs text-slate-700 sm:grid-cols-[8rem_minmax(0,1fr)]">
                    <dt className="font-semibold">{t('security.colType')}</dt>
                    <dd className="break-all font-mono">{r.event_type}</dd>
                    <dt className="font-semibold">{t('security.colResource')}</dt>
                    <dd className="break-all font-mono">{r.resource}</dd>
                    {r.detail && (
                      <>
                        <dt className="font-semibold">{t('security.colDetail')}</dt>
                        <dd className="break-all">{r.detail}</dd>
                      </>
                    )}
                    {r.clinic_id && (
                      <>
                        <dt className="font-semibold">{t('security.colClinic')}</dt>
                        <dd>{r.clinic_id}</dd>
                      </>
                    )}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
        {cursor && !loading && (
          <div className="border-t border-slate-100 p-3 text-center">
            <Button size="sm" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? t('common.loading') : t('security.loadMore')}
            </Button>
          </div>
        )}
      </Card>
    </>
  )
}
