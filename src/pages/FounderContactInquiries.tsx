import { useEffect, useMemo, useState } from 'react'
import { Loader2, Mail, MessageSquare } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { useLocale } from '../context/LocaleContext'
import { listContactInquiries, updateContactInquiry } from '../lib/backend'
import { fmtDate } from '../lib/format'
import type { BackendContactInquiry, BackendContactStatus, BackendContactTopic } from '../types'

export default function FounderContactInquiries() {
  const { t, locale } = useLocale()
  const [rows, setRows] = useState<BackendContactInquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | BackendContactStatus>('all')

  const load = async () => {
    setLoading(true)
    try {
      const data = await listContactInquiries()
      setRows(data)
      setError(null)
      if (selected && !data.some((r) => r.inquiry_id === selected)) {
        setSelected(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('founder.contactLoadFail'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter((r) => r.status === filter)
  }, [rows, filter])

  const active = filtered.find((r) => r.inquiry_id === selected) ?? filtered[0] ?? null

  const topicLabel = (topic: BackendContactTopic) => {
    if (topic === 'license') return t('founder.contactTopicLicense')
    if (topic === 'demo') return t('founder.contactTopicDemo')
    if (topic === 'partnership') return t('founder.contactTopicPartnership')
    return t('founder.contactTopicOther')
  }

  const statusLabel = (status: BackendContactStatus) => {
    if (status === 'new') return t('founder.contactStatusNew')
    if (status === 'read') return t('founder.contactStatusRead')
    return t('founder.contactStatusClosed')
  }

  const onSetStatus = async (row: BackendContactInquiry, status: BackendContactStatus) => {
    setBusyId(row.inquiry_id)
    setError(null)
    try {
      await updateContactInquiry(row.inquiry_id, status)
      await load()
      setSelected(row.inquiry_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('founder.updateFail'))
    } finally {
      setBusyId(null)
    }
  }

  const openRow = async (row: BackendContactInquiry) => {
    setSelected(row.inquiry_id)
    if (row.status === 'new') {
      await onSetStatus(row, 'read')
    }
  }

  return (
    <>
      <PageHeader
        title={t('founder.contactTitle')}
        subtitle={t('founder.contactSubtitle')}
        crumbs={[{ label: t('nav.founderHome'), to: '/' }, { label: t('nav.contactInquiries') }]}
      />
      {error && (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', 'new', 'read', 'closed'] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? 'primary' : 'secondary'} onClick={() => setFilter(f)}>
            {f === 'all'
              ? t('common.all')
              : f === 'new'
                ? t('founder.contactStatusNew')
                : f === 'read'
                  ? t('founder.contactStatusRead')
                  : t('founder.contactStatusClosed')}
          </Button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader
            title={t('founder.contactInbox')}
            subtitle={t('founder.contactCount', { count: filtered.length })}
            icon={<Mail className="h-5 w-5" />}
          />
          {loading ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
            </p>
          ) : filtered.length === 0 ? (
            <EmptyState compact icon={<MessageSquare className="h-5 w-5" />} title={t('founder.contactEmpty')} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map((row) => {
                const isActive = active?.inquiry_id === row.inquiry_id
                return (
                  <li key={row.inquiry_id}>
                    <button
                      type="button"
                      onClick={() => void openRow(row)}
                      className={`flex w-full flex-col gap-1 px-5 py-3 text-left transition hover:bg-slate-50 ${
                        isActive ? 'bg-teal-50/70' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-navy-900">{row.name}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                            row.status === 'new'
                              ? 'bg-amber-100 text-amber-900'
                              : row.status === 'read'
                                ? 'bg-sky-100 text-sky-900'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {statusLabel(row.status)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        {topicLabel(row.topic)} · {fmtDate(row.created_at, locale)}
                      </p>
                      <p className="line-clamp-2 text-xs text-slate-600">{row.message}</p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5 xl:col-span-3">
          {!active ? (
            <EmptyState
              compact
              icon={<Mail className="h-5 w-5" />}
              title={t('founder.contactSelect')}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-navy-900">{active.name}</h2>
                  <p className="text-sm text-slate-600">
                    <a className="text-teal-700 hover:underline" href={`mailto:${active.email}`}>
                      {active.email}
                    </a>
                    {active.phone ? ` · ${active.phone}` : ''}
                  </p>
                  {active.organization ? (
                    <p className="mt-1 text-sm text-slate-500">{active.organization}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {active.status !== 'read' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === active.inquiry_id}
                      onClick={() => void onSetStatus(active, 'read')}
                    >
                      {t('founder.contactMarkRead')}
                    </Button>
                  ) : null}
                  {active.status !== 'closed' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === active.inquiry_id}
                      onClick={() => void onSetStatus(active, 'closed')}
                    >
                      {t('founder.contactMarkClosed')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === active.inquiry_id}
                      onClick={() => void onSetStatus(active, 'read')}
                    >
                      {t('founder.contactReopen')}
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-slate-100 px-2 py-1">{topicLabel(active.topic)}</span>
                <span className="rounded-full bg-slate-100 px-2 py-1">{statusLabel(active.status)}</span>
                <span className="rounded-full bg-slate-100 px-2 py-1">{fmtDate(active.created_at, locale)}</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-navy-900">{active.message}</p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
