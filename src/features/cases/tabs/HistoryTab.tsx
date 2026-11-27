import { useEffect, useMemo, useState } from 'react'
import { useLocalizedNavigate } from '../../../shared/hooks/useLocalizedNavigate'
import { ClipboardList, History } from 'lucide-react'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { Card, CardHeader } from '../../../shared/ui/Card'
import { Button } from '../../../shared/ui/Button'
import { ReportVersionCompare } from '../../../shared/ui/ReportVersionCompare'
import { fmtDate } from '../../../shared/lib/format'
import { listCaseActivity } from '../../../shared/api'
import type { VetCase } from '../../../shared/types'
import { buildCaseTimeline, type ActivityEvent } from '../lib/caseTimeline'

function emailStatusLabel(status: VetCase['vetEmailDeliveryStatus'], t: (k: string) => string): string {
  if (status === 'sent') return t('reportEmail.sent')
  if (status === 'failed') return t('reportEmail.failed')
  if (status === 'not_configured') return t('reportEmail.notConfigured')
  if (status) return t('reportEmail.skipped')
  return '—'
}

export function CaseHistoryPanel({ c }: { c: VetCase }) {
  const { t, locale } = useLocale()
  const nav = useLocalizedNavigate()
  const versions = c.reportVersions ?? []
  const [activity, setActivity] = useState<ActivityEvent[]>([])
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
  const timeline = useMemo(() => buildCaseTimeline(c.timeline, activity, t), [c.timeline, activity, t])
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
          {/* Owners do not sign in (#67), so "viewed" is gone; the vet's report e-mail is shown. */}
          <div>
            <dt className="text-xs text-slate-500">{t('cases.detail.emailSent')}</dt>
            <dd className="font-medium text-navy-900">{emailStatusLabel(c.vetEmailDeliveryStatus, t)}</dd>
          </div>
        </dl>
      </Card>
      <Card>
        <CardHeader title={t('cases.detail.statusTimeline')} subtitle={t('cases.detail.activityTimelineSub')} icon={<History className="h-5 w-5" />} />
        <ol className="relative px-5 py-4" data-testid="case-timeline">
          {timeline.length === 0 ? <li className="text-sm text-slate-500">{t('cases.detail.noEntries')}</li> : null}
          {timeline.map((row, i) => {
            const last = i === timeline.length - 1
            return (
              <li key={row.key} className="relative flex gap-3 pb-5 last:pb-0">
                {!last && <span className="absolute left-[7px] top-4 h-full w-px bg-slate-200" />}
                <span
                  className={`relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 ${
                    last ? 'border-teal-500 bg-teal-100' : row.tone === 'status' ? 'border-slate-300 bg-white' : 'border-teal-600 bg-white'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-navy-900">{row.label}</p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(row.at, locale)} · {row.by}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </Card>
    </div>
  )
}
