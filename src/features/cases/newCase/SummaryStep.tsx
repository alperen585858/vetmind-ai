import { Brain, Sparkles, Square } from 'lucide-react'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { regionLabel, studyLabel } from '../../../shared/lib/displayClean'
import { cranialNervesText, isNeuroExamEmpty, neuroItemText } from '../../../shared/lib/neuroExam'
import type { LocalizationHint } from '../../../shared/lib/neuroLocalization'
import { Button } from '../../../shared/ui/Button'
import type {
  BackendAnatomicalRegion,
  BackendModality,
  ClinicalInfo,
  DicomUploadResponse,
  NeuroExam,
  Patient,
} from '../../../shared/types'
import type { IntakeMode } from '../lib/analysisChannel'
import { DEMO_FIXTURES_ENABLED, NOT_ENTERED, instanceCountOf, PIPELINE_OPTIONS, type PipelineMode, type UploadFile } from './constants'
import { Field, Summary } from './fields'

export interface ClassificationChoice {
  acceptSuggestion: boolean
  setAcceptSuggestion: (v: boolean) => void
  overrideModality: BackendModality
  setOverrideModality: (v: BackendModality) => void
  overrideRegion: BackendAnatomicalRegion
  setOverrideRegion: (v: BackendAnatomicalRegion) => void
}

export function SummaryStep({
  patient,
  clinical,
  radiologistQuestions,
  neuro,
  hint,
  intakeMode,
  setIntakeMode,
  files,
  dicomFiles,
  dicomPreview,
  pipeline,
  setPipeline,
  classification,
  submitting,
  patientStepReady,
  goToStep,
  onPreviewMetadata,
  onSubmit,
  onStop,
}: {
  patient: Patient
  clinical: ClinicalInfo
  radiologistQuestions: string
  neuro: NeuroExam
  hint: LocalizationHint | null
  intakeMode: IntakeMode
  setIntakeMode: (m: IntakeMode) => void
  files: UploadFile[]
  dicomFiles: File[]
  dicomPreview: DicomUploadResponse | null
  pipeline: PipelineMode
  setPipeline: (p: PipelineMode) => void
  classification: ClassificationChoice
  submitting: boolean
  patientStepReady: boolean
  goToStep: (step: number) => void
  onPreviewMetadata: () => void
  onSubmit: () => void
  onStop: () => void
}) {
  const { t } = useLocale()
  const instanceCount = instanceCountOf(dicomPreview)
  return (
    <div className="animate-fade-up space-y-5">
      <h2 className="text-lg font-semibold text-navy-900">{t('cases.stepSummary')}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <Summary title="Hasta Bilgileri" onEdit={() => goToStep(0)} rows={[
          ['Hasta', `${patient.name || '—'} (${patient.species})`],
          ['Irk', patient.breed || '—'],
          ['Cinsiyet', `${patient.sex}, ${patient.neutered ? 'kısırlaştırılmış' : 'kısırlaştırılmamış'}`],
          ['Yaş / Kilo', `${patient.age} yaş · ${patient.weight} kg`],
          ['Sahip', patient.ownerName.trim() || '—'],
        ]} />
        <Summary title="Klinik Bilgiler" onEdit={() => goToStep(1)} rows={[
          ['Şikâyet', clinical.complaint || '—'],
          ['Radyoloğa sorular', radiologistQuestions.trim() || '—'],
          ['Başlangıç / Seyir', `${clinical.onset} · ${clinical.course}`],
          ['Klinik geçmiş', clinical.history || '—'],
          ['İlaçlar', clinical.medications || '—'],
        ]} />
        <Summary title="Nörolojik Muayene" onEdit={() => goToStep(2)} rows={
          isNeuroExamEmpty(neuro)
            ? [['Muayene', 'Nörolojik muayene girilmedi']]
            : [
                ['Bilinç', neuroItemText(neuro.consciousness, NOT_ENTERED)],
                ['Yürüyüş', `${neuroItemText(neuro.gait, NOT_ENTERED)}${neuro.limbs.length ? ` (${neuro.limbs.join(', ')})` : ''}`],
                ['Postüral (ön / arka)', `${neuroItemText(neuro.posturalThoracic, NOT_ENTERED)} / ${neuroItemText(neuro.posturalPelvic, NOT_ENTERED)}`],
                ['Refleksler (torasik / pelvik)', `${neuroItemText(neuro.reflexThoracic, NOT_ENTERED)} / ${neuroItemText(neuro.reflexPelvic, NOT_ENTERED)}`],
                ['Kraniyal sinirler', cranialNervesText(neuro, NOT_ENTERED)],
                ['Derin ağrı', neuroItemText(neuro.deepPain, NOT_ENTERED)],
                ['Hiperestezi', neuroItemText(neuro.hyperesthesia, NOT_ENTERED)],
                ['Olası lokalizasyon', hint?.region ?? '—'],
              ]
        } />
        <Summary
          title={intakeMode === 'dicom' ? `DICOM (${dicomFiles.length || instanceCount || 0})` : `Tetkikler (${files.length})`}
          onEdit={() => goToStep(3)}
          rows={
            intakeMode === 'dicom'
              ? dicomPreview?.study
                ? [
                    ['Study UID', dicomPreview.study.study_instance_uid],
                    ['Series / Instance', `${dicomPreview.study.series.length} / ${instanceCount}`],
                    [
                      'Sınıflandırma',
                      dicomPreview.classification
                        ? `${dicomPreview.classification.suggested_modality} / ${dicomPreview.classification.suggested_anatomical_region} (${dicomPreview.classification.confidence})`
                        : dicomPreview.blocked
                          ? 'Engellendi'
                          : 'Henüz önizlenmedi',
                    ],
                  ]
                : dicomFiles.length
                  ? dicomFiles.map((f) => ['DICOM', f.name])
                  : [['—', 'DICOM yüklenmedi']]
              : files.length
                ? files.map((f) => [f.type, f.name])
                : [['—', 'Belge yüklenmedi']]
          }
        />
      </div>
      {/* Test scenarios (model failure, conflicting outputs …) are demo/dev only (#80).
          For vets the channel follows the upload: DICOM → DICOM path, documents → document path. */}
      {DEMO_FIXTURES_ENABLED && (
        <div className="rounded-xl border border-dashed border-slate-300 p-4">
          <p className="mb-2 text-sm font-semibold text-navy-900">{t('newCase.pipelineTitle')}</p>
          <p className="mb-3 text-xs text-slate-500">{t('newCase.pipelineHint')}</p>
          <div className="flex flex-wrap gap-2">
            {PIPELINE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setPipeline(opt.id)
                  if (opt.id === 'dicom_metadata') setIntakeMode('dicom')
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${pipeline === opt.id ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-navy-700 ring-slate-300 hover:bg-slate-50'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {pipeline === 'dicom_metadata' && (
        <ClassificationPanel
          dicomPreview={dicomPreview}
          canPreview={!submitting && dicomFiles.length > 0}
          onPreviewMetadata={onPreviewMetadata}
          choice={classification}
        />
      )}
      <div className="flex flex-col items-start gap-4 rounded-xl border border-navy-100 bg-navy-50/60 p-5 md:flex-row md:items-center">
        <Brain className="h-8 w-8 shrink-0 text-teal-600" />
        <p className="flex-1 text-sm text-navy-800">
          Gönderdiğinizde AI ön değerlendirme çalışır ve taslak <strong>uzman veteriner hekim onayına</strong> iletilir.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="lg"
            onClick={onSubmit}
            disabled={
              !patientStepReady ||
              submitting ||
              (pipeline === 'dicom_metadata' && Boolean(dicomPreview?.blocked))
            }
            icon={<Sparkles className="h-4 w-4" />}
          >
            {submitting ? t('dicom.processing') : pipeline === 'dicom_metadata' ? t('cases.submitAnalyze') : t('cases.submitAiReview')}
          </Button>
          {!patientStepReady && (
            <button type="button" className="text-xs font-medium text-rose-700 hover:underline" onClick={() => goToStep(0)}>
              {t('cases.fillRequired')}
            </button>
          )}
          {submitting && (
            <Button size="lg" variant="secondary" icon={<Square className="h-4 w-4" />} onClick={onStop}>
              {t('cases.processing.stopAnalysis')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function ClassificationPanel({
  dicomPreview,
  canPreview,
  onPreviewMetadata,
  choice,
}: {
  dicomPreview: DicomUploadResponse | null
  canPreview: boolean
  onPreviewMetadata: () => void
  choice: ClassificationChoice
}) {
  const { t } = useLocale()
  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-4">
      <p className="mb-2 text-sm font-semibold text-navy-900">{t('newCase.classificationTitle')}</p>
      <p className="mb-3 text-xs text-slate-600">{t('newCase.classificationHint')}</p>
      {!dicomPreview && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!canPreview} onClick={onPreviewMetadata}>
            {t('newCase.previewMetadata')}
          </Button>
        </div>
      )}
      {dicomPreview?.classification && !dicomPreview.blocked && (
        <>
          <label className="mb-3 flex items-center gap-2 text-sm text-navy-800">
            <input type="checkbox" checked={choice.acceptSuggestion} onChange={(e) => choice.setAcceptSuggestion(e.target.checked)} />
            {t('newCase.acceptSuggestion')} ({studyLabel(t, dicomPreview.classification.suggested_modality, dicomPreview.classification.suggested_anatomical_region)})
          </label>
          {!choice.acceptSuggestion && (
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <Field label={t('newCase.overrideModality')}>
                <select className="input" value={choice.overrideModality} onChange={(e) => choice.setOverrideModality(e.target.value as BackendModality)}>
                  <option value="MR">MR</option>
                  <option value="CT">CT</option>
                  <option value="XR">XR</option>
                </select>
              </Field>
              <Field label={t('newCase.overrideRegion')}>
                <select className="input" value={choice.overrideRegion} onChange={(e) => choice.setOverrideRegion(e.target.value as BackendAnatomicalRegion)}>
                  {(['BRAIN', 'CERVICAL', 'THORAX', 'THORACOLUMBAR'] as const).map((r) => (
                    <option key={r} value={r}>
                      {regionLabel(t, r)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
            {dicomPreview.classification.rationale.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      )}
      {dicomPreview?.blocked && (
        <p className="text-sm text-rose-700">{dicomPreview.block_reason ?? 'Ingest engellendi; onaylanamaz.'}</p>
      )}
    </div>
  )
}
