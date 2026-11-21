import { useEffect, useState } from 'react'
import { useLocalizedNavigate } from '../../../hooks/useLocalizedNavigate'
import { ClipboardList, History } from 'lucide-react'
import { useLocale } from '../../../context/LocaleContext'
import { Card, CardHeader } from '../../../components/Card'
import { Button } from '../../../components/Button'
import { ReportVersionCompare } from '../../../components/ReportVersionCompare'
import { fmtDate } from '../../../lib/format'
import { listCaseActivity } from '../../../lib/backend'
import type { VetCase } from '../../../types'

export function CaseHistoryPanel({ c }: { c: VetCase }) {
  const { t, locale } = useLocale()
  const nav = useLocalizedNavigate()
  const versions = c.reportVersions ?? []
  const [activity, setActivity] = useState<Array<{ event_id: string; kind: string; actor_subject: string; at: string; detail?: string | null }>>([])
  useEffect(() => {
    const key = c.backendCaseId || c.id
    if (!key.startsWith('case-')) {
      setActivity([])
      return
    }
    void listCaseActivity(key)
      .then(setActivity)
      .catch(() => setActivity([]))
  }, [c.backendCaseId, c.id])
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('cases.detail.reportVersions')} subtitle={t('cases.detail.reportVersionsSub')} icon={<History className="h-5 w-5" />} />
        {versions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">
            {t('cases.detail.noVersionsYet')}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {versions
              .slice()
              .sort((a, b) => b.version - a.version)
              .map((v) => (
                <li key={v.version} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <p className="font-semibold text-navy-900">
                      v{v.version}
                      {v.is_current ? ` · ${t('cases.detail.current')}` : ''}
                      {v.immutable ? ' · kilitli' : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {v.status} · {v.expert_review_status}
                      {v.reviewed_by ? ` · ${v.reviewed_by}` : ''} · {fmtDate(v.updated_at, locale)}
                    </p>
                    {v.revision_notes && <p className="mt-1 text-xs text-slate-600">{v.revision_notes}</p>}
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                      {v.source_kind} · {v.model_id}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={v.status !== 'approved'}
                    onClick={() => nav(`/raporlar/${c.id}?version=${v.version}`)}
                  >
                    {v.status === 'approved' ? t('cases.detail.viewPdf') : t('cases.detail.readOnly')}
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </Card>
      {c.fromBackend ? <ReportVersionCompare caseId={c.id} versions={versions} /> : null}
      <Card>
        <CardHeader title={t('cases.detail.progressDelivery')} icon={<ClipboardList className="h-5 w-5" />} />
        <dl className="grid gap-2 px-5 py-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">{t('cases.detail.reportReady')}</dt>
            <dd className="font-medium text-navy-900">{c.reportAvailableAt ? fmtDate(c.reportAvailableAt, locale) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('cases.detail.delivered')}</dt>
            <dd className="font-medium text-navy-900">{c.reportDeliveredAt ? fmtDate(c.reportDeliveredAt, locale) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t('cases.detail.viewed')}</dt>
            <dd className="font-medium text-navy-900">{c.reportViewedAt ? fmtDate(c.reportViewedAt, locale) : '—'}</dd>
          </div>
        </dl>
      </Card>
      <Card>
        <CardHeader title={t('cases.detail.activityTimeline')} subtitle={t('cases.detail.activityTimelineSub')} icon={<History className="h-5 w-5" />} />
        <ul className="divide-y divide-slate-100 px-5 py-2 text-sm">
          {activity.length === 0 && c.timeline.length === 0 ? (
            <li className="py-3 text-slate-500">{t('cases.detail.noEntries')}</li>
          ) : null}
          {activity.map((e) => (
            <li key={e.event_id} className="flex gap-3 py-2">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-600" />
              <div>
                <p className="font-medium text-navy-900">{e.kind}</p>
                <p className="text-xs text-slate-500">
                  {fmtDate(e.at, locale)} · {e.actor_subject}
                  {e.detail ? ` · ${e.detail}` : ''}
                </p>
              </div>
            </li>
          ))}
          {activity.length === 0 &&
            c.timeline.map((t, i) => (
              <li key={`${t.date}-${i}`} className="flex gap-3 py-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                <div>
                  <p className="font-medium text-navy-900">{t.label}</p>
                  <p className="text-xs text-slate-500">
                    {t.date}
                    {t.by ? ` · ${t.by}` : ''}
                  </p>
                </div>
              </li>
            ))}
        </ul>
      </Card>
    </div>
  )
}
