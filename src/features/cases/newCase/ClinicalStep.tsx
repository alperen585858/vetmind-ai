import { useLocale } from '../../../shared/shell/LocaleContext'
import type { ClinicalInfo } from '../../../shared/types'
import { Field, Pills } from './fields'

export function ClinicalStep({
  clinical,
  setField,
  radiologistQuestions,
  setRadiologistQuestions,
}: {
  clinical: ClinicalInfo
  setField: <K extends keyof ClinicalInfo>(k: K, v: ClinicalInfo[K]) => void
  radiologistQuestions: string
  setRadiologistQuestions: (v: string) => void
}) {
  const { t } = useLocale()
  const C = setField
  return (
    <div className="animate-fade-up">
      <h2 className="mb-5 text-lg font-semibold text-navy-900">{t('cases.stepClinical')}</h2>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label={t('newCase.complaint')} className="md:col-span-2">
          <textarea rows={3} className="input" value={clinical.complaint} onChange={(e) => C('complaint', e.target.value)} placeholder={t('newCase.complaintPlaceholder')} />
        </Field>
        <Field label={t('newCase.onset')}>
          <Pills options={['Akut', 'Kronik'] as const} value={clinical.onset} onChange={(v) => C('onset', v)} />
        </Field>
        <Field label={t('newCase.course')}>
          <Pills options={['Progresif', 'Stabil', 'İyileşen'] as const} value={clinical.course} onChange={(v) => C('course', v)} />
        </Field>
        <Field label={t('newCase.history')}>
          <textarea rows={3} className="input" value={clinical.history} onChange={(e) => C('history', e.target.value)} />
        </Field>
        <Field label={t('newCase.medications')}>
          <textarea rows={3} className="input" value={clinical.medications} onChange={(e) => C('medications', e.target.value)} />
        </Field>
        <Field label={t('newCase.radiologistQuestions')} className="md:col-span-2">
          <textarea
            rows={3}
            className="input"
            value={radiologistQuestions}
            onChange={(e) => setRadiologistQuestions(e.target.value)}
            placeholder={t('newCase.radiologistQuestionsPlaceholder')}
            maxLength={4000}
          />
          <span className="mt-1 block text-xs text-slate-500">{t('newCase.radiologistQuestionsHint')}</span>
        </Field>
      </div>
    </div>
  )
}
