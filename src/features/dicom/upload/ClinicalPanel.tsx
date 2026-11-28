import { Info, Sparkles } from 'lucide-react'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { confidenceLabel, modalityLabel, regionLabel, studyLabel } from '../../../shared/lib/displayClean'
import { Button } from '../../../shared/ui/Button'
import { OwnerNameField } from '../../../shared/ui/OwnerNameField'
import type { BackendAnatomicalRegion, BackendModality, DicomUploadResponse, Patient } from '../../../shared/types'
import { classificationConfirmationLabel } from '../lib/dicomWorkflow'

export interface UploadPatientForm {
  patientName: string
  species: Patient['species']
  breed: string
  ageYears: string
  history: string
  ownerName: string
  consent: boolean
}

export interface UploadPatientFormSetters {
  setPatientName: (v: string) => void
  setSpecies: (v: Patient['species']) => void
  setBreed: (v: string) => void
  setAgeYears: (v: string) => void
  setHistory: (v: string) => void
  setOwnerName: (v: string) => void
  setConsent: (v: boolean) => void
}

export interface StudySummary {
  modality: string | null | undefined
  imageCount: number
  seriesCount: number
  studyDescription: string | null | undefined
}

/** Right-hand panel: patient form, study info, consent, classification and the analysis summary. */
export function ClinicalPanel({
  form,
  onForm,
  hasStudy,
  studySummary,
  preview,
  fileCount,
  classification,
  busy,
  uploading,
  validating,
  uploadProgress,
  onPreview,
  onSubmit,
  onCancel,
}: {
  form: UploadPatientForm
  onForm: UploadPatientFormSetters
  hasStudy: boolean
  studySummary: StudySummary
  preview: DicomUploadResponse | null
  fileCount: number
  classification: {
    acceptSuggestion: boolean
    setAcceptSuggestion: (v: boolean) => void
    overrideModality: BackendModality
    setOverrideModality: (v: BackendModality) => void
    overrideRegion: BackendAnatomicalRegion
    setOverrideRegion: (v: BackendAnatomicalRegion) => void
  }
  busy: boolean
  uploading: boolean
  validating: boolean
  uploadProgress: string | null
  onPreview: () => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const { t } = useLocale()
  return (
  <div className="space-y-5">
    <section className="space-y-3">
      <label className="block text-xs font-semibold text-slate-600">
        {t('dicomUpload.patientName')} *
        <input
          className="input mt-1.5"
          value={form.patientName}
          onChange={(e) => onForm.setPatientName(e.target.value)}
          autoComplete="off"
          placeholder={t('dicomUpload.patientNamePlaceholder')}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-semibold text-slate-600">
          {t('dicomUpload.species')}
          <select
            className="input mt-1.5"
            value={form.species}
            onChange={(e) => onForm.setSpecies(e.target.value as Patient['species'])}
          >
            <option value="Köpek">{t('species.dog')}</option>
            <option value="Kedi">{t('species.cat')}</option>
            <option value="Diğer">{t('species.other')}</option>
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          {t('dicomUpload.breed')}
          <input
            className="input mt-1.5"
            value={form.breed}
            onChange={(e) => onForm.setBreed(e.target.value)}
            placeholder={t('dicomUpload.breedPlaceholder')}
          />
        </label>
      </div>
      <label className="block text-xs font-semibold text-slate-600">
        {t('dicomUpload.ageYears')}
        <input
          className="input mt-1.5"
          type="number"
          min={0}
          step={0.1}
          placeholder={t('common.dash')}
          value={form.ageYears}
          onChange={(e) => onForm.setAgeYears(e.target.value)}
        />
      </label>
      <label className="block text-xs font-semibold text-slate-600">
        {t('dicomUpload.clinicalNotes')}
        <textarea
          className="input mt-1.5"
          rows={hasStudy ? 4 : 3}
          placeholder={t('dicomUpload.clinicalNotesPlaceholder')}
          value={form.history}
          onChange={(e) => onForm.setHistory(e.target.value)}
        />
      </label>
      <OwnerNameField value={form.ownerName} onChange={onForm.setOwnerName} disabled={busy || uploading} />
    </section>

    {hasStudy && (
      <section className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {t('dicomUpload.studyInfo')}
        </h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt className="text-slate-500">Modalite</dt>
            <dd className="font-medium text-navy-900">{studySummary.modality ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Görüntü</dt>
            <dd className="font-medium text-navy-900">{studySummary.imageCount}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Seri</dt>
            <dd className="font-medium text-navy-900">{studySummary.seriesCount || '—'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-slate-500">Study</dt>
            <dd className="truncate font-medium text-navy-900" title={studySummary.studyDescription ?? undefined}>
              {studySummary.studyDescription ?? '—'}
            </dd>
          </div>
        </dl>
      </section>
    )}

    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t('dicom.confirmSection')}</h3>
      <label className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-3 text-xs leading-relaxed text-navy-800 transition hover:border-teal-200 hover:bg-teal-50/30">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          checked={form.consent}
          onChange={(e) => onForm.setConsent(e.target.checked)}
        />
        <span>
          AI sonucunun ön değerlendirme olduğunu ve uzman veteriner hekim onayının zorunlu olduğunu kabul ediyorum.
        </span>
      </label>
    </section>

    {preview?.classification && !preview.blocked && (
      <section className="rounded-xl border border-teal-200 bg-teal-50/50 p-3.5 text-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-800">Sınıflandırma</p>
        <p className="mt-1 text-sm font-medium text-navy-900">
          {studyLabel(t, preview.classification.suggested_modality, preview.classification.suggested_anatomical_region)}
          <span className="ml-1 text-xs font-normal text-slate-600">
            · {confidenceLabel(t, preview.classification.confidence)}
            {preview.classification.disagreement ? ' · disagreement' : ''}
          </span>
        </p>
        {(preview.classification.signals?.length ?? 0) > 0 && (
          <ul className="mt-2 space-y-1 rounded-lg bg-white/80 p-2 text-[11px] text-slate-700 ring-1 ring-inset ring-teal-100">
            {preview.classification.signals!.map((s) => (
              <li key={s.name}>
                <span className="font-semibold text-teal-900">{s.name}</span>
                {': '}
                {[s.modality, s.anatomical_region].filter(Boolean).join(' / ') || '—'}
                <span className="text-slate-500"> · {s.confidence}</span>
                {s.note ? <span className="block text-slate-500">{s.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={classification.acceptSuggestion} onChange={(e) => classification.setAcceptSuggestion(e.target.checked)} />
          Öneriyi kabul et
        </label>
        {!classification.acceptSuggestion && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select className="input" value={classification.overrideModality} onChange={(e) => classification.setOverrideModality(e.target.value as BackendModality)}>
              <option value="MR">MR</option>
              <option value="CT">CT</option>
              <option value="XR">XR</option>
            </select>
            <select className="input" value={classification.overrideRegion} onChange={(e) => classification.setOverrideRegion(e.target.value as BackendAnatomicalRegion)}>
              {(['BRAIN', 'CERVICAL', 'THORAX', 'THORACOLUMBAR'] as const).map((r) => (
                <option key={r} value={r}>
                  {regionLabel(t, r)}
                </option>
              ))}
            </select>
          </div>
        )}
        {preview.classification.rationale.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-slate-600">
            {preview.classification.rationale.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </section>
    )}

    <section className="rounded-xl border border-slate-200 bg-white px-3.5 py-3.5 shadow-sm">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Analiz özeti</h3>
      <ul className="mt-2.5 divide-y divide-slate-100 text-xs text-navy-900">
        <li className="flex items-center justify-between gap-2 py-2 first:pt-0">
          <span className="text-slate-500">Sınıflandırma</span>
          <span className="font-semibold">
            {classificationConfirmationLabel({
              blocked: preview?.blocked,
              needsConfirmation: preview?.classification?.needs_confirmation,
              ingestAccepted: false,
            })}
          </span>
        </li>
        <li className="flex items-center justify-between gap-2 py-2">
          <span className="text-slate-500">Doğrulama</span>
          <span className="font-semibold">
            {preview?.blocked ? 'Engellendi' : preview ? 'Hazır' : fileCount ? 'Bekliyor' : 'Dosya yok'}
          </span>
        </li>
        <li className="flex items-center justify-between gap-2 py-2">
          <span className="text-slate-500">Seçili analiz</span>
          <span className="max-w-[55%] truncate text-right font-semibold">
            {preview?.classification
              ? studyLabel(t, preview.classification.suggested_modality, preview.classification.suggested_anatomical_region)
              : studySummary.modality ? modalityLabel(t, studySummary.modality) : 'DICOM sınıflandırma'}
          </span>
        </li>
        <li className="flex items-center justify-between gap-2 py-2 last:pb-0">
          <span className="text-slate-500">Dosya</span>
          <span className="font-semibold">{fileCount}</span>
        </li>
      </ul>
      {preview?.blocked && (
        <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-xs text-rose-800 ring-1 ring-inset ring-rose-200">
          {preview.block_reason ?? t('dicom.uploadBlocked')}
        </p>
      )}
      {preview?.issues?.some((i) => i.severity === 'warning') && !preview.blocked && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-800">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {preview.issues.filter((i) => i.severity === 'warning').length} uyarı — incelemeye devam edilebilir.
        </p>
      )}
    </section>

    <div className="flex flex-col gap-2 pt-1">
      {hasStudy && (
        <Button variant="secondary" disabled={busy || fileCount === 0} onClick={onPreview}>
          Metadata önizle
        </Button>
      )}
      <Button
        size="lg"
        className="w-full shadow-md shadow-teal-700/15"
        disabled={validating || Boolean(preview?.blocked) || !hasStudy || !form.consent}
        onClick={onSubmit}
        icon={<Sparkles className="h-4 w-4" />}
      >
        {t('dicom.sendToAnalysis')}
      </Button>
      {(busy || uploading) && (
        <p className="text-center text-xs text-slate-500">{uploadProgress ?? t('dicom.processing')}</p>
      )}
      {(busy || uploading) && (
        <Button variant="secondary" className="w-full" onClick={onCancel}>
          Analizi / yüklemeyi durdur
        </Button>
      )}
    </div>
  </div>
  )
}
