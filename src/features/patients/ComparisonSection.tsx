import { useEffect, useState } from 'react'
import { History, Save } from 'lucide-react'
import { Card, CardHeader } from '../../shared/ui/Card'
import { Button } from '../../shared/ui/Button'
import { LocalizedLink } from '../../shared/shell/LocalizedLink'
import { useLocale } from '../../shared/shell/LocaleContext'
import { useApp } from '../../shared/shell/AppContext'
import { toastErrorBody } from '../../shared/lib/apiErrors'
import { saveReportComparison } from '../../shared/api'
import type { BackendDraftReport, BackendReportComparison } from '../../shared/types'

/** DICOM YYYYMMDD → locale date; anything else as-is. */
function priorDateLabel(value: string | null | undefined, locale: string): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null
  const d = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))))
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'tr-TR', { dateStyle: 'medium', timeZone: 'UTC' }).format(d)
}

/**
 * Issue #108: "Change since the prior study" report section. Read-only once the report is
 * approved; otherwise the radiologist can rewrite it (saved with the draft).
 */
export function ComparisonSection({
  caseId,
  comparison,
  editable,
  onSaved,
}: {
  caseId: string
  comparison: BackendReportComparison
  editable: boolean
  onSaved?: (draft: BackendDraftReport) => void
}) {
  const { t, locale } = useLocale()
  const { pushToast } = useApp()
  const [text, setText] = useState(comparison.text)
  const [saving, setSaving] = useState(false)
  useEffect(() => setText(comparison.text), [comparison.text])

  const dirty = text.trim() !== comparison.text.trim()
  const date = priorDateLabel(comparison.prior_study_date, locale)

  const save = async () => {
    setSaving(true)
    try {
      const draft = await saveReportComparison(caseId, text)
      onSaved?.(draft)
      pushToast({ tone: 'success', title: t('patients.comparisonSaved') })
    } catch (err) {
      pushToast({ tone: 'error', title: t('patients.comparisonSaveFailed'), body: toastErrorBody(err, t) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-5">
      <CardHeader
        title={t('patients.comparisonTitle')}
        icon={<History className="h-5 w-5" />}
        subtitle={
          comparison.prior_case_id ? (
            <span>
              [P1] {t('patients.comparisonPrior', { date: date ?? '—', version: comparison.prior_report_version ?? '—' })}{' '}
              <LocalizedLink to={`/vakalar/${comparison.prior_case_id}`} className="font-medium text-teal-700 hover:underline">
                {t('patients.openCase')}
              </LocalizedLink>
            </span>
          ) : undefined
        }
      />
      {editable && comparison.prior_case_id ? (
        <>
          <textarea
            className="input min-h-[140px] w-full font-sans text-sm leading-relaxed"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            aria-label={t('patients.comparisonTitle')}
          />
          <div className="mt-2 flex items-center gap-3">
            <Button size="sm" variant="secondary" disabled={!dirty || saving} onClick={() => void save()} icon={<Save className="h-3.5 w-3.5" />}>
              {saving ? t('common.loading') : t('patients.comparisonSave')}
            </Button>
            {comparison.source === 'expert' && <span className="text-xs text-slate-500">{t('patients.comparisonEdited')}</span>}
          </div>
        </>
      ) : (
        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{comparison.text}</p>
      )}
      {comparison.prior_case_id && (
        <p className="mt-3 text-xs text-slate-500">{t('patients.comparisonNote')}</p>
      )}
    </Card>
  )
}
