import { useLocale } from '../../../shared/shell/LocaleContext'
import { OwnerNameField } from '../../../shared/ui/OwnerNameField'
import { PatientPicker } from '../../patients/PatientPicker'
import type { BackendPatient, Patient } from '../../../shared/types'
import { Field, Pills } from './fields'

export function PatientStep({
  patient,
  setField,
  linkedPatient,
  onPickPatient,
}: {
  patient: Patient
  setField: <K extends keyof Patient>(k: K, v: Patient[K]) => void
  linkedPatient: BackendPatient | null
  onPickPatient: (record: BackendPatient | null) => void
}) {
  const { t } = useLocale()
  const P = setField
  return (
    <div className="animate-fade-up">
      <h2 className="mb-5 text-lg font-semibold text-navy-900">{t('newCase.patientSection')}</h2>
      <div className="mb-5">
        <PatientPicker
          selected={linkedPatient}
          onSelect={onPickPatient}
          typedName={patient.name}
          typedSpecies={patient.species}
        />
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Field label={`${t('newCase.patientName')} *`}>
          <input className="input" value={patient.name} onChange={(e) => P('name', e.target.value)} placeholder={t('newCase.patientNamePlaceholder')} />
        </Field>
        <Field label={`${t('newCase.species')} *`}>
          <Pills options={['Köpek', 'Kedi', 'Diğer'] as const} value={patient.species} onChange={(v) => P('species', v)} />
        </Field>
        <Field label={`${t('newCase.breed')} (${t('newCase.optional')})`}>
          <input className="input" value={patient.breed} onChange={(e) => P('breed', e.target.value)} placeholder={t('newCase.breedPlaceholder')} />
        </Field>
        <Field label={t('newCase.sex')}>
          <Pills options={['Erkek', 'Dişi'] as const} value={patient.sex} onChange={(v) => P('sex', v)} />
        </Field>
        <Field label={t('newCase.neutered')}>
          <Pills
            options={['Kısırlaştırılmış', 'Kısırlaştırılmamış'] as const}
            value={patient.neutered ? 'Kısırlaştırılmış' : 'Kısırlaştırılmamış'}
            onChange={(v) => P('neutered', v === 'Kısırlaştırılmış')}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('newCase.ageYears')}>
            <input type="number" min={0} className="input" value={patient.age || ''} onChange={(e) => P('age', Number(e.target.value))} />
          </Field>
          <Field label={t('newCase.weightKg')}>
            <input type="number" min={0} step="0.1" className="input" value={patient.weight || ''} onChange={(e) => P('weight', Number(e.target.value))} />
          </Field>
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <OwnerNameField value={patient.ownerName} onChange={(v) => P('ownerName', v)} />
        </div>
      </div>
    </div>
  )
}
