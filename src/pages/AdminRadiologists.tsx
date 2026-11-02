import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Stethoscope, Wallet } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { useLocale } from '../context/LocaleContext'
import {
  fetchRadiologistPayoutDetail,
  fetchRadiologistPayoutLedger,
  markRadiologistPaid,
} from '../lib/backend'
import type {
  BackendRadiologistCasePayout,
  BackendRadiologistPayoutLedger,
  BackendRadiologistPayoutSummary,
} from '../types'

function money(amount: number, currency: string) {
  return `${amount} ${currency}`
}

export default function AdminRadiologists() {
  const { t } = useLocale()
  const [ledger, setLedger] = useState<BackendRadiologistPayoutLedger | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [payouts, setPayouts] = useState<BackendRadiologistCasePayout[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [busyEmail, setBusyEmail] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    void fetchRadiologistPayoutLedger()
      .then((data) => {
        setLedger(data)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('admin.radiologistsLoadFail')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openDetail = async (email: string) => {
    setSelected(email)
    setDetailLoading(true)
    try {
      const detail = await fetchRadiologistPayoutDetail(email)
      setPayouts(detail.payouts)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.radiologistsLoadFail'))
    } finally {
      setDetailLoading(false)
    }
  }

  const onMarkPaid = async (row: BackendRadiologistPayoutSummary) => {
    if (row.unpaid_cases <= 0) return
    setBusyEmail(row.radiologist_subject)
    setError(null)
    try {
      const detail = await markRadiologistPaid(row.radiologist_subject)
      setPayouts(detail.payouts)
      load()
      if (selected === row.radiologist_subject) {
        setSelected(row.radiologist_subject)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('admin.radiologistsMarkFail'))
    } finally {
      setBusyEmail(null)
    }
  }

  const fee = ledger?.fee_per_case ?? 40
  const currency = ledger?.currency ?? 'EUR'

  return (
    <>
      <PageHeader
        title={t('admin.radiologistsTitle')}
        subtitle={t('admin.radiologistsSubtitle', { fee: money(fee, currency) })}
        crumbs={[
          { label: t('admin.crumbSystem'), to: '/' },
          { label: t('admin.crumbRadiologists') },
        ]}
      />
      {error && (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('admin.radiologistsFee')}</p>
          <p className="mt-1 text-2xl font-semibold text-navy-900">{money(fee, currency)}</p>
          <p className="mt-0.5 text-xs text-slate-500">{t('admin.radiologistsFeeHint')}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('admin.radiologistsUnpaidCases')}</p>
          <p className="mt-1 text-2xl font-semibold text-navy-900">{ledger?.total_unpaid_cases ?? '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('admin.radiologistsTotalOwed')}</p>
          <p className="mt-1 text-2xl font-semibold text-amber-800">
            {ledger ? money(ledger.total_amount_owed, currency) : '—'}
          </p>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            title={t('admin.radiologistsList')}
            subtitle={t('admin.radiologistsCount', { count: ledger?.radiologists.length ?? 0 })}
            icon={<Stethoscope className="h-5 w-5" />}
          />
          {loading ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
            </p>
          ) : !ledger || ledger.radiologists.length === 0 ? (
            <EmptyState
              compact
              icon={<Stethoscope className="h-5 w-5" />}
              title={t('admin.radiologistsEmpty')}
              text={t('admin.radiologistsEmptyText')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className="th">{t('admin.radiologist')}</th>
                    <th className="th">{t('admin.radiologistsApproved')}</th>
                    <th className="th">{t('admin.radiologistsUnpaid')}</th>
                    <th className="th">{t('admin.radiologistsOwed')}</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ledger.radiologists.map((row) => {
                    const active = selected === row.radiologist_subject
                    return (
                      <tr
                        key={row.radiologist_subject}
                        className={active ? 'bg-teal-50/60' : undefined}
                      >
                        <td className="td">
                          <button
                            type="button"
                            className="text-left text-sm font-medium text-navy-900 hover:underline"
                            onClick={() => void openDetail(row.radiologist_subject)}
                          >
                            {row.display_name || row.radiologist_subject}
                          </button>
                          <p className="text-[11px] text-slate-500">{row.radiologist_subject}</p>
                        </td>
                        <td className="td text-sm">{row.approved_cases}</td>
                        <td className="td text-sm font-semibold text-amber-800">{row.unpaid_cases}</td>
                        <td className="td text-sm font-semibold">{money(row.amount_owed, row.currency)}</td>
                        <td className="td">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void openDetail(row.radiologist_subject)}
                            >
                              {t('admin.radiologistsDetail')}
                            </Button>
                            <Button
                              size="sm"
                              disabled={row.unpaid_cases <= 0 || busyEmail === row.radiologist_subject}
                              onClick={() => void onMarkPaid(row)}
                              icon={
                                busyEmail === row.radiologist_subject ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Wallet className="h-3.5 w-3.5" />
                                )
                              }
                            >
                              {t('admin.radiologistsMarkPaid')}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title={selected ? t('admin.radiologistsCaseList') : t('admin.radiologistsPick')}
            subtitle={selected || undefined}
            icon={<CheckCircle2 className="h-5 w-5" />}
          />
          {!selected ? (
            <p className="px-5 pb-5 text-sm text-slate-500">{t('admin.radiologistsPickHint')}</p>
          ) : detailLoading ? (
            <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
            </p>
          ) : payouts.length === 0 ? (
            <EmptyState
              compact
              icon={<CheckCircle2 className="h-5 w-5" />}
              title={t('admin.radiologistsNoCases')}
            />
          ) : (
            <ul className="max-h-[28rem] space-y-2 overflow-y-auto px-5 pb-5">
              {payouts.map((p) => (
                <li
                  key={p.payout_id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-navy-900">{p.case_id}</p>
                    <p className="text-[11px] text-slate-500">
                      {new Date(p.approved_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold">{money(p.amount, p.currency)}</p>
                    <p
                      className={`text-[11px] font-medium ${
                        p.status === 'owed' ? 'text-amber-700' : 'text-teal-700'
                      }`}
                    >
                      {p.status === 'owed'
                        ? t('admin.radiologistsStatusOwed')
                        : t('admin.radiologistsStatusPaid')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
