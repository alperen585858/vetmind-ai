import { useMemo, useRef, useState } from 'react'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { Card } from '../../shared/ui/Card'
import { PageHeader } from '../../shared/ui/PageHeader'
import { Button } from '../../shared/ui/Button'
import { StepIndicator } from '../../shared/ui/StepIndicator'
import { SAMPLE_FORM } from '../../shared/demo/clinic'
import { neuroPriority } from '../../shared/lib/neuroExam'
import { buildAssessment } from '../../shared/demo/caseTemplates'
import { localize } from '../../shared/lib/neuroLocalization'
import { nowStamp } from '../../shared/lib/format'
import { AI_PHASE_START, PIPELINE_MS } from '../../shared/lib/pipeline'
import { toastErrorBody } from '../../shared/lib/apiErrors'
import { isLikelyDicomFile } from '../../shared/lib/dicomFolder'
import { setAnalyzeHandoff } from '../../shared/lib/analyzeHandoff'
import { patientFormFromRecord } from '../patients/patientLib'
import {
  PollingCancelledError,
  createAndAnalyzeCase,
  draftToSections,
  pipelineToAssessment,
  confirmDocumentAndAnalyze,
  createPatient,
  toBackendSpecies,
  uploadDicomDemo,
  uploadDicomFiles,
  uploadDocuments,
} from '../../shared/api'
import { caseStatusFromBackendOutcome } from './lib/caseStatusMap'
import { autoAnalysisChannel, type IntakeMode } from './lib/analysisChannel'
import {
  BRAIN_BACKEND_FORM,
  CERVICAL_BACKEND_FORM,
  DEMO_FIXTURES_ENABLED,
  EMPTY_CLINICAL,
  EMPTY_NEURO,
  EMPTY_PATIENT,
  STEP_KEYS,
  formatFileSize,
  guessType,
  instanceCountOf,
  type PipelineMode,
  type UploadFile,
} from './newCase/constants'
import { PatientStep } from './newCase/PatientStep'
import { ClinicalStep } from './newCase/ClinicalStep'
import { NeuroStep } from './newCase/NeuroStep'
import { DocumentIntake } from './newCase/DocumentIntake'
import { DemoQuickFill, UploadStep } from './newCase/UploadStep'
import { DicomIntake } from './newCase/DicomIntake'
import { SummaryStep } from './newCase/SummaryStep'
import { useDicomViewerState } from './newCase/useDicomViewerState'
import { buildPendingDicomCase, buildStructuredHistory, buildSubmittedCase, completionMessages, failedAssessment } from './newCase/submittedCase'
import type {
  BackendAnatomicalRegion,
  BackendModality,
  ClinicalInfo,
  DicomDemoKind,
  DicomUploadResponse,
  NeuroExam,
  BackendPatient,
  Patient,
  Priority,
  VetCase,
} from '../../shared/types'

export default function NewCase() {
  const { addCase, pushToast, updateCase } = useApp()
  const { t, locale } = useLocale()
  const nav = useLocalizedNavigate()
  const steps = useMemo(() => STEP_KEYS.map((key) => t(key)), [t])
  const [step, setStep] = useState(0)
  const [patient, setPatient] = useState<Patient>(EMPTY_PATIENT)
  // Questions the referring vet wants the radiologist to answer (issue #89).
  const [radiologistQuestions, setRadiologistQuestions] = useState('')
  const [clinical, setClinical] = useState<ClinicalInfo>(EMPTY_CLINICAL)
  const [neuro, setNeuro] = useState<NeuroExam>(EMPTY_NEURO)
  const [files, setFiles] = useState<UploadFile[]>([])
  const [intakeMode, setIntakeMode] = useState<IntakeMode>('dicom')
  const [dicomFiles, setDicomFiles] = useState<File[]>([])
  const [dicomPreview, setDicomPreview] = useState<DicomUploadResponse | null>(null)
  const [pendingDemoKind, setPendingDemoKind] = useState<DicomDemoKind | null>(null)
  const [acceptSuggestion, setAcceptSuggestion] = useState(true)
  const [overrideModality, setOverrideModality] = useState<BackendModality>('MR')
  const [overrideRegion, setOverrideRegion] = useState<BackendAnatomicalRegion>('BRAIN')
  const [pipeline, setPipeline] = useState<PipelineMode>('dicom_metadata')
  const [submitting, setSubmitting] = useState(false)
  // Same acknowledgement the old "DICOM Yükle" page required before AI analysis (#79).
  const [imagingConsent, setImagingConsent] = useState(false)
  const submitAbortRef = useRef<AbortController | null>(null)

  const P = <K extends keyof Patient>(k: K, v: Patient[K]) => setPatient((p) => ({ ...p, [k]: v }))
  // Issue #108: clinic patient record this study belongs to (null = create one on submit).
  const [linkedPatient, setLinkedPatient] = useState<BackendPatient | null>(null)
  const pickPatient = (record: BackendPatient | null) => {
    setLinkedPatient(record)
    if (record) setPatient((p) => patientFormFromRecord(p, record))
  }
  /** Chosen patient, or a new record for this animal. Never blocks the case if it fails. */
  const ensurePatientId = async (): Promise<string | null> => {
    if (linkedPatient) return linkedPatient.patient_id
    try {
      const created = await createPatient({
        name: patient.name.trim(),
        species: toBackendSpecies(patient.species),
        breed: patient.breed.trim() || null,
        sex: patient.sex,
      })
      setLinkedPatient(created)
      return created.patient_id
    } catch {
      return null
    }
  }
  const C = <K extends keyof ClinicalInfo>(k: K, v: ClinicalInfo[K]) => setClinical((c) => ({ ...c, [k]: v }))

  const hint = localize(neuro, clinical, locale)

  const viewer = useDicomViewerState(dicomFiles)

  const clearDicomFiles = () => {
    setDicomPreview(null)
    setDicomFiles([])
    viewer.resetSelection()
  }

  /** Demo fixture: fill the form and switch to the document / scenario channel. */
  const applyDemoForm = (
    form: { patient: Patient; clinical: ClinicalInfo; neuro: NeuroExam },
    mode: PipelineMode,
    demoFiles: UploadFile[],
    toast: { title: string; body: string },
  ) => {
    setPipeline(mode)
    setIntakeMode('documents')
    setDicomPreview(null)
    setDicomFiles([])
    setPatient(form.patient)
    setClinical(form.clinical)
    setNeuro(form.neuro)
    setFiles(demoFiles)
    pushToast({ tone: 'info', ...toast })
  }

  const fillSample = () =>
    applyDemoForm(SAMPLE_FORM, 'document_context', SAMPLE_FORM.files.map((f, i) => ({ ...f, id: `s${i}` })), {
      title: 'Form örnek vaka ile dolduruldu',
      body: 'Fındık — Beagle, akut pelvik parezi (doküman kanalı)',
    })

  const fillBrainBackend = () =>
    applyDemoForm(
      BRAIN_BACKEND_FORM,
      'brain_mri_suspected',
      [{ id: 'brain-placeholder', name: 'synthetic_brain_mri_metadata.json', type: 'MR Raporu', size: '1 KB' }],
      { title: 'Brain MRI vakası', body: 'Form örnek verilerle dolduruldu.' },
    )

  const fillCervicalBackend = () =>
    applyDemoForm(
      CERVICAL_BACKEND_FORM,
      'cervical_mri_suspected',
      [{ id: 'cerv-placeholder', name: 'synthetic_cervical_mri_metadata.json', type: 'MR Raporu', size: '1 KB' }],
      { title: 'Cervical MRI vakası', body: 'Form örnek verilerle dolduruldu.' },
    )

  const fillDicomDemo = (kind: DicomDemoKind) => {
    setPipeline('dicom_metadata')
    setIntakeMode('dicom')
    setDicomFiles([])
    setDicomPreview(null)
    setPendingDemoKind(kind)
    if (kind === 'cervical_mri') {
      setPatient(CERVICAL_BACKEND_FORM.patient)
      setClinical(CERVICAL_BACKEND_FORM.clinical)
      setNeuro(CERVICAL_BACKEND_FORM.neuro)
    } else {
      setPatient(BRAIN_BACKEND_FORM.patient)
      setClinical(BRAIN_BACKEND_FORM.clinical)
      setNeuro(BRAIN_BACKEND_FORM.neuro)
      if (kind === 'thorax_xr') {
        setClinical({
          ...BRAIN_BACKEND_FORM.clinical,
          complaint: 'Toraks radyografi şüphesi.',
          history: 'Toraks radyografi değerlendirmesi için örnek kayıt.',
        })
      } else if (kind === 'brain_ct') {
        setClinical({
          ...BRAIN_BACKEND_FORM.clinical,
          complaint: 'Beyin BT şüphesi.',
          history: 'Beyin BT değerlendirmesi için örnek kayıt.',
        })
      }
    }
    setFiles([])
    const titles: Record<DicomDemoKind, string> = {
      brain_mri: 'DICOM · Brain MRI',
      cervical_mri: 'DICOM · Cervical MRI',
      thoracolumbar_mri: 'DICOM · Thoracolumbar MRI',
      brain_ct: 'DICOM · Brain CT',
      thorax_xr: 'DICOM · Thorax XR',
    }
    pushToast({
      tone: 'info',
      title: titles[kind],
      body: 'Özet adımında “Onayla ve Analiz Çalıştır” ile devam edin.',
    })
    setStep(4)
  }

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const added = Array.from(list).map((f) => ({
      id: `${f.name}-${f.lastModified}-${Math.random()}`,
      name: f.name,
      type: guessType(f.name),
      size: formatFileSize(f.size),
      file: f,
    }))
    setFiles((fs) => [...fs, ...added])
  }

  const addDicomFiles = (list: FileList | null) => {
    if (!list) return
    setDicomPreview(null)
    // Folder picks include .DS_Store, thumbnails, reports… keep likely DICOM only.
    const picked = Array.from(list).filter((f) => isLikelyDicomFile(f))
    setDicomFiles((prev) => [...prev, ...picked])
  }

  const applyClassificationDefaults = (upload: DicomUploadResponse) => {
    if (!upload.classification) return
    setAcceptSuggestion(true)
    const mod = upload.classification.suggested_modality
    setOverrideModality(mod === 'CT' || mod === 'XR' || mod === 'MR' ? mod : 'MR')
    const region = upload.classification.suggested_anatomical_region
    setOverrideRegion(
      region === 'CERVICAL' || region === 'THORAX' || region === 'BRAIN' || region === 'THORACOLUMBAR' ? region : 'BRAIN',
    )
  }

  const previewDicomMetadata = async (kind?: DicomDemoKind) => {
    if (!patient.name.trim()) {
      pushToast({ tone: 'warning', title: t('newCase.patientNameRequired'), body: t('newCase.patientNameRequiredBody') })
      return
    }
    setSubmitting(true)
    try {
      const history = `${clinical.complaint}\n${clinical.history}`.trim()
      const upload = kind
        ? await uploadDicomDemo({
            kind,
            patientName: patient.name,
            species: patient.species,
            breed: patient.breed,
            clinicalHistory: history,
          })
        : await uploadDicomFiles({
            files: dicomFiles,
            patientName: patient.name,
            species: patient.species,
            breed: patient.breed,
            clinicalHistory: history,
          })
      setDicomPreview(upload)
      applyClassificationDefaults(upload)
      if (upload.blocked) {
        pushToast({ tone: 'error', title: 'DICOM yüklemesi engellendi', body: upload.block_reason ?? 'Doğrulama hatası' })
      } else {
        pushToast({
          tone: 'success',
          title: 'Metadata sınıflandırması hazır',
          body: 'Öneri klinik tanı değildir. Onayladıktan sonra analiz çalışır.',
        })
      }
    } catch (err) {
      pushToast({ tone: 'error', title: t('dicom.uploadFailed'), body: toastErrorBody(err, t) })
    } finally {
      setSubmitting(false)
    }
  }

  // Only the patient's name and species are required; owner details are optional (issue #88).
  const patientStepReady = Boolean(patient.name.trim() && patient.species)
  const canNext = step !== 0 || patientStepReady

  const submit = async () => {
    const stamp = nowStamp()
    const loc = localize(neuro, clinical, locale)
    const triage = neuroPriority(neuro)
    const priority: Priority =
      triage === 'stat' ? 'STAT' : triage === 'urgent' ? 'Acil' : triage === 'high' ? 'Yüksek' : 'Normal'

    let built = buildAssessment(loc?.template ?? 'ivdd', patient, neuro, stamp, locale)
    let backendCaseId = ''
    let backendJobId: string | undefined
    let backendOutcome: VetCase['backendOutcome']
    let backendFindings: VetCase['backendFindings']
    let backendDraft: VetCase['backendDraft']

    submitAbortRef.current?.abort()
    const controller = new AbortController()
    submitAbortRef.current = controller
    setSubmitting(true)
    try {
      const questions = radiologistQuestions.trim()
      const history = [clinical.complaint, clinical.history, questions ? `Radyoloğa sorular:\n${questions}` : '']
        .filter((part) => part.trim())
        .join('\n')
        .trim()
      const ownerName = patient.ownerName.trim() || undefined
      const patientId = await ensurePatientId()
      let result
      if (pipeline === 'dicom_metadata') {
        if (dicomFiles.length === 0 && !pendingDemoKind && !(dicomPreview && !dicomPreview.blocked)) {
          setSubmitting(false)
          pushToast({ tone: 'warning', title: t('newCase.dicomRequired'), body: t('dicom.needDcmFirst') })
          return
        }
        if (!imagingConsent) {
          setSubmitting(false)
          pushToast({ tone: 'warning', title: t('dicom.confirmRequired'), body: t('newCase.consentRequired') })
          setStep(3)
          return
        }
        // Hand off to the background analysis task (#98): upload → confirm → enqueue keep
        // running when the vet leaves the page; progress shows in the top bar.
        const pendingId = `pending-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
        const instanceCount =
          (instanceCountOf(dicomPreview) ?? dicomFiles.length) || 1
        setAnalyzeHandoff({
          pendingId,
          files: dicomFiles.slice(),
          pendingDemo: pendingDemoKind,
          ingestId: dicomPreview && !dicomPreview.blocked ? dicomPreview.ingest_id : undefined,
          uploadSnap: dicomPreview && !dicomPreview.blocked ? dicomPreview : null,
          patientName: patient.name,
          species: patient.species,
          breed: patient.breed,
          ageYears: patient.age ? String(patient.age) : '',
          history,
          consent: imagingConsent,
          acceptSuggestion,
          overrideModality,
          overrideRegion,
          vetName: 'Dr. Elif Kaya',
          ownerName: patient.ownerName.trim(),
          patientId,
        })
        addCase(
          buildPendingDicomCase({ pendingId, patient, clinical, neuro, priority, stamp, instanceCount, demoKind: pendingDemoKind, built }),
        )
        setSubmitting(false)
        nav(`/vakalar/${pendingId}/isleme`, { replace: true })
        return
      }
      if (pipeline === 'document_context') {
        const blobs = files.map((f) => f.file).filter((f): f is File => Boolean(f))
        const payloadFiles =
          blobs.length > 0
            ? blobs
            : [
                new File(
                  [
                    `SYNTHETIC CLINICAL NOTE\nPatient: ${patient.name}\nSpecies: ${patient.species}\n\n${history}\n\nNot a real clinical document.`,
                  ],
                  'clinical_note.txt',
                  { type: 'text/plain' },
                ),
              ]
        const upload = await uploadDocuments({
          files: payloadFiles,
          patientName: patient.name,
          species: patient.species,
          breed: patient.breed,
          clinicalHistory: history,
        })
        if (upload.blocked) {
          setSubmitting(false)
          pushToast({ tone: 'error', title: 'Belge yüklemesi engellendi', body: upload.block_reason ?? 'Yükleme hatası' })
          return
        }
        result = await confirmDocumentAndAnalyze(upload.ingest_id, {
          signal: controller.signal,
          cancelBackendOnAbort: true,
          ownerName,
          patientId,
        })
      } else {
        result = await createAndAnalyzeCase({
          patientId,
          patientName: patient.name,
          species: patient.species,
          breed: patient.breed,
          clinicalHistory: history,
          scenario: pipeline,
          patientAgeYears: patient.age || undefined,
          ownerName,
          priority: triage,
          clinicalHistoryStructured: buildStructuredHistory(patient, clinical, neuro, questions),
          signal: controller.signal,
          cancelBackendOnAbort: true,
        })
      }
      backendCaseId = result.job.case_id
      backendJobId = result.job.job_id
      backendOutcome = result.outcome
      backendFindings = result.findings ?? undefined
      backendDraft = result.report ?? undefined
      if (result.report && result.findings) {
        const sections = draftToSections(result.report)
        built = {
          ...built,
          ai: pipelineToAssessment(result.findings, result.report),
          draft: sections,
        }
      } else if (result.outcome === 'failed') {
        built = failedAssessment(built, result.job.error_message, stamp)
      }
    } catch (err) {
      setSubmitting(false)
      if (submitAbortRef.current === controller) submitAbortRef.current = null
      if (err instanceof PollingCancelledError || (err instanceof DOMException && err.name === 'AbortError')) {
        pushToast({ tone: 'info', title: 'Analiz durduruldu' })
        return
      }
      pushToast({ tone: 'error', title: t('apiErrors.unexpected'), body: toastErrorBody(err, t) })
      return
    }
    if (submitAbortRef.current === controller) submitAbortRef.current = null
    setSubmitting(false)

    const id = backendCaseId
    addCase(
      buildSubmittedCase({
        backendCaseId,
        backendJobId,
        backendOutcome,
        backendFindings,
        backendDraft,
        patient,
        clinical,
        neuro,
        priority,
        intakeMode,
        dicomPreview,
        dicomFiles,
        files,
        built,
        stamp,
        t,
      }),
    )
    setTimeout(() => updateCase(id, { status: 'ai_analizi' }), AI_PHASE_START)
    setTimeout(() => {
      const done = nowStamp()
      const nextStatus = caseStatusFromBackendOutcome(backendOutcome)
      const { statusNote, timelineLabel, tone, title } = completionMessages(backendOutcome)
      updateCase(id, (c) => ({
        status: nextStatus,
        processingMs: PIPELINE_MS,
        statusNote: statusNote ?? c.statusNote,
        timeline: [
          ...c.timeline,
          { date: done, label: 'Analiz tamamlandı', by: 'Sistem' },
          { date: done, label: timelineLabel, by: 'Sistem' },
        ],
      }))
      pushToast({ tone, title, body: `${patient.name} vakası güncellendi.` })
    }, PIPELINE_MS)
    nav(`/vakalar/${id}/isleme`)
  }

  return (
    <>
      <PageHeader
        title={t('cases.newCaseTitle')}
        subtitle={t('cases.newCaseSubtitle')}
        crumbs={[{ label: t('nav.cases'), to: '/vakalar' }, { label: t('cases.newCaseTitle') }]}
        actions={
          <div className="flex flex-wrap gap-2">
            {DEMO_FIXTURES_ENABLED && (
              <Button variant="secondary" icon={<Sparkles className="h-4 w-4 text-teal-600" />} onClick={fillSample}>
                {t('cases.fillSampleShort')}
              </Button>
            )}
          </div>
        }
      />
      <div className="mb-5 overflow-hidden rounded-[1.25rem] bg-gradient-to-r from-navy-950 to-teal-900 px-5 py-4 text-white shadow-soft">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-300/90">{t('cases.newCaseTitle')}</p>
        <p className="mt-1 text-sm text-slate-300">{t('cases.newCaseSubtitle')}</p>
      </div>
      {DEMO_FIXTURES_ENABLED && (
        <DemoQuickFill onBrain={fillBrainBackend} onCervical={fillCervicalBackend} onDicomDemo={fillDicomDemo} />
      )}
      <Card className="mb-6 p-5">
        <StepIndicator steps={steps} current={step} onSelect={setStep} />
      </Card>

      <Card className="p-6">
        {step === 0 && <PatientStep patient={patient} setField={P} linkedPatient={linkedPatient} onPickPatient={pickPatient} />}

        {step === 1 && (
          <ClinicalStep
            clinical={clinical}
            setField={C}
            radiologistQuestions={radiologistQuestions}
            setRadiologistQuestions={setRadiologistQuestions}
          />
        )}

        {step === 2 && <NeuroStep neuro={neuro} setNeuro={setNeuro} hint={hint} />}

        {step === 3 && (
          <UploadStep
            intakeMode={intakeMode}
            onSelectDocuments={() => {
              setIntakeMode('documents')
              setPipeline((p) => (DEMO_FIXTURES_ENABLED && p !== 'dicom_metadata' ? p : autoAnalysisChannel('documents')))
              setDicomPreview(null)
            }}
            onSelectDicom={() => {
              setIntakeMode('dicom')
              setPipeline(autoAnalysisChannel('dicom'))
            }}
            documents={<DocumentIntake files={files} setFiles={setFiles} onAddFiles={addFiles} />}
            dicom={
              <DicomIntake
                species={patient.species}
                dicomFiles={dicomFiles}
                dicomPreview={dicomPreview}
                viewer={viewer}
                submitting={submitting}
                imagingConsent={imagingConsent}
                setImagingConsent={setImagingConsent}
                onAddFiles={addDicomFiles}
                onRemoveFile={(file) => {
                  setDicomPreview(null)
                  setDicomFiles((fs) => fs.filter((x) => x !== file))
                }}
                onClearAll={clearDicomFiles}
                onPreviewMetadata={(kind) => void previewDicomMetadata(kind)}
              />
            }
          />
        )}

        {step === 4 && (
          <SummaryStep
            patient={patient}
            clinical={clinical}
            radiologistQuestions={radiologistQuestions}
            neuro={neuro}
            hint={hint}
            intakeMode={intakeMode}
            setIntakeMode={setIntakeMode}
            files={files}
            dicomFiles={dicomFiles}
            dicomPreview={dicomPreview}
            pipeline={pipeline}
            setPipeline={setPipeline}
            classification={{ acceptSuggestion, setAcceptSuggestion, overrideModality, setOverrideModality, overrideRegion, setOverrideRegion }}
            submitting={submitting}
            patientStepReady={patientStepReady}
            goToStep={setStep}
            onPreviewMetadata={() => void previewDicomMetadata()}
            onSubmit={() => void submit()}
            onStop={() => submitAbortRef.current?.abort()}
          />
        )}

        {step < 4 && (
          <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)} icon={<ArrowLeft className="h-4 w-4" />}>{t('common.back')}</Button>
            <div className="flex items-center gap-3">
              {!canNext && <span className="text-xs text-slate-500">{t('cases.fillRequired')}</span>}
              <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                {t('common.next')} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        {step === 4 && (
          <div className="mt-6">
            <Button variant="ghost" onClick={() => setStep(3)} icon={<ArrowLeft className="h-4 w-4" />}>{t('common.back')}</Button>
          </div>
        )}
      </Card>
    </>
  )
}
