import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Brain, FileText, Lightbulb, Pencil, Sparkles, Square, Trash2, UploadCloud } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { StepIndicator } from '../components/StepIndicator'
import { CLINIC, EMPTY_NEURO, SAMPLE_FORM } from '../data/mock'
import { buildAssessment, makeDocument } from '../data/templates'
import { localize } from '../lib/localization'
import { nowStamp, today } from '../lib/format'
import { AI_PHASE_START, PIPELINE_MS } from '../lib/pipeline'
import {
  BackendUnavailableError,
  PollingCancelledError,
  confirmDicomAndAnalyze,
  createAndAnalyzeCase,
  draftToSections,
  pipelineToAssessment,
  confirmDocumentAndAnalyze,
  uploadDicomDemo,
  uploadDicomFiles,
  uploadDocuments,
} from '../lib/backend'
import { caseStatusFromBackendOutcome } from '../lib/caseStatusMap'
import type {
  BackendAnatomicalRegion,
  BackendModality,
  BackendScenario,
  ClinicalInfo,
  DicomDemoKind,
  DicomUploadResponse,
  DocType,
  NeuroExam,
  Patient,
  Priority,
  VetCase,
} from '../types'

const STEPS = ['Hasta Bilgileri', 'Klinik Bilgiler', 'Nörolojik Muayene', 'Tetkik Yükleme', 'Özet ve Gönder']
const DOC_TYPES: DocType[] = ['MR Raporu', 'BT Raporu', 'Laboratuvar Sonucu', 'Önceki Rapor']
const LIMBS = ['Sol ön', 'Sağ ön', 'Sol arka', 'Sağ arka']
const CN = ['Baş eğikliği', 'Nistagmus', 'Anizokori', 'Fasiyal paralizi', 'Tehdit refleksi kaybı']

const EMPTY_PATIENT: Patient = { name: '', species: 'Köpek', breed: '', sex: 'Erkek', neutered: false, age: 0, weight: 0, ownerName: '', ownerPhone: '' }
const EMPTY_CLINICAL: ClinicalInfo = { complaint: '', onset: 'Akut', course: 'Progresif', history: '', medications: '' }

type IntakeMode = 'documents' | 'dicom'
type PipelineMode = BackendScenario | 'dicom_metadata'

const PIPELINE_OPTIONS: { id: PipelineMode; label: string }[] = [
  { id: 'dicom_metadata', label: 'DICOM metadata' },
  { id: 'brain_mri_suspected', label: 'Brain MRI' },
  { id: 'cervical_mri_suspected', label: 'Cervical MRI' },
  { id: 'ct_brain_suspected', label: 'Brain CT' },
  { id: 'xr_thorax_suspected', label: 'Thorax XR' },
  { id: 'document_context', label: 'Doküman / multimodal' },
  { id: 'no_findings', label: 'Bulgu yok' },
  { id: 'unsupported', label: 'Desteklenmeyen' },
  { id: 'model_failure', label: 'Model hatası' },
  { id: 'conflicting', label: 'Çelişen çıktılar' },
]

const BRAIN_BACKEND_FORM = {
  patient: { name: 'Pax', species: 'Köpek' as const, breed: 'Golden Retriever', sex: 'Erkek' as const, neutered: true, age: 7, weight: 32, ownerName: 'Mehmet Yılmaz', ownerPhone: '0555 000 00 01' },
  clinical: {
    complaint: 'Nöbet şüphesi.',
    onset: 'Akut' as const,
    course: 'Progresif' as const,
    history: 'Akut başlangıçlı nöbet öyküsü.',
    medications: 'Yok',
  },
  neuro: { ...EMPTY_NEURO, cranialNerves: ['Nistagmus'] },
}

const CERVICAL_BACKEND_FORM = {
  patient: { name: 'Mila', species: 'Köpek' as const, breed: 'Fransız Bulldog', sex: 'Dişi' as const, neutered: true, age: 4, weight: 11, ownerName: 'Mehmet Yılmaz', ownerPhone: '0555 000 00 01' },
  clinical: {
    complaint: 'Boyun ağrısı şüphesi.',
    onset: 'Akut' as const,
    course: 'Progresif' as const,
    history: 'Boyun ağrısı ve hareket kısıtlılığı öyküsü.',
    medications: 'Yok',
  },
  neuro: { ...EMPTY_NEURO, hyperesthesia: 'Servikal' as const },
}

interface UploadFile {
  id: string
  name: string
  type: DocType
  size: string
  /** Browser File blob when user selected a real document (for backend document ingest). */
  file?: File
}

function guessType(name: string): DocType {
  const n = name.toLocaleLowerCase('tr')
  if (n.includes('mr')) return 'MR Raporu'
  if (n.includes('bt') || n.includes('ct') || n.includes('tomo')) return 'BT Raporu'
  if (n.includes('lab') || n.includes('kan') || n.includes('hemogram') || n.includes('biyokimya')) return 'Laboratuvar Sonucu'
  return 'Önceki Rapor'
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

function Pills<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
            value === o ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-navy-700 ring-slate-300 hover:bg-slate-50'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function Checks({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
              on ? 'bg-teal-600 text-white ring-teal-600' : 'bg-white text-navy-700 ring-slate-300 hover:bg-slate-50'
            }`}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

export default function NewCase() {
  const { addCase, pushToast, updateCase } = useApp()
  const nav = useNavigate()
  const [step, setStep] = useState(0)
  const [patient, setPatient] = useState<Patient>(EMPTY_PATIENT)
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
  const [drag, setDrag] = useState(false)
  const [pipeline, setPipeline] = useState<PipelineMode>('dicom_metadata')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dicomInputRef = useRef<HTMLInputElement>(null)
  const submitAbortRef = useRef<AbortController | null>(null)

  const P = <K extends keyof Patient>(k: K, v: Patient[K]) => setPatient((p) => ({ ...p, [k]: v }))
  const C = <K extends keyof ClinicalInfo>(k: K, v: ClinicalInfo[K]) => setClinical((c) => ({ ...c, [k]: v }))
  const N = <K extends keyof NeuroExam>(k: K, v: NeuroExam[K]) => setNeuro((n) => ({ ...n, [k]: v }))

  const hint = localize(neuro, clinical)

  const fillSample = () => {
    setPipeline('document_context')
    setIntakeMode('documents')
    setDicomPreview(null)
    setDicomFiles([])
    setPatient(SAMPLE_FORM.patient)
    setClinical(SAMPLE_FORM.clinical)
    setNeuro(SAMPLE_FORM.neuro)
    setFiles(SAMPLE_FORM.files.map((f, i) => ({ ...f, id: `s${i}` })))
    pushToast({ tone: 'info', title: 'Form örnek vaka ile dolduruldu', body: 'Fındık — Beagle, akut pelvik parezi (doküman kanalı)' })
  }

  const fillBrainBackend = () => {
    setPipeline('brain_mri_suspected')
    setIntakeMode('documents')
    setDicomPreview(null)
    setDicomFiles([])
    setPatient(BRAIN_BACKEND_FORM.patient)
    setClinical(BRAIN_BACKEND_FORM.clinical)
    setNeuro(BRAIN_BACKEND_FORM.neuro)
    setFiles([{ id: 'brain-placeholder', name: 'synthetic_brain_mri_metadata.json', type: 'MR Raporu', size: '1 KB' }])
    pushToast({ tone: 'info', title: 'Brain MRI vakası', body: 'Form örnek verilerle dolduruldu.' })
  }

  const fillCervicalBackend = () => {
    setPipeline('cervical_mri_suspected')
    setIntakeMode('documents')
    setDicomPreview(null)
    setDicomFiles([])
    setPatient(CERVICAL_BACKEND_FORM.patient)
    setClinical(CERVICAL_BACKEND_FORM.clinical)
    setNeuro(CERVICAL_BACKEND_FORM.neuro)
    setFiles([{ id: 'cerv-placeholder', name: 'synthetic_cervical_mri_metadata.json', type: 'MR Raporu', size: '1 KB' }])
    pushToast({ tone: 'info', title: 'Cervical MRI vakası', body: 'Form örnek verilerle dolduruldu.' })
  }

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
      size: f.size > 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`,
      file: f,
    }))
    setFiles((fs) => [...fs, ...added])
  }

  const addDicomFiles = (list: FileList | null) => {
    if (!list) return
    setDicomPreview(null)
    setDicomFiles((prev) => [...prev, ...Array.from(list)])
  }

  const applyClassificationDefaults = (upload: DicomUploadResponse) => {
    if (!upload.classification) return
    setAcceptSuggestion(true)
    const mod = upload.classification.suggested_modality
    setOverrideModality(mod === 'CT' || mod === 'XR' || mod === 'MR' ? mod : 'MR')
    const region = upload.classification.suggested_anatomical_region
    setOverrideRegion(
      region === 'CERVICAL' || region === 'THORAX' || region === 'BRAIN' ? region : 'BRAIN',
    )
  }

  const previewDicomMetadata = async (kind?: DicomDemoKind) => {
    if (!patient.name.trim()) {
      pushToast({ tone: 'warning', title: 'Hasta adı gerekli', body: 'DICOM yüklemeden önce hasta adını girin.' })
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
        pushToast({ tone: 'error', title: 'DICOM ingest engellendi', body: upload.block_reason ?? 'Doğrulama hatası' })
      } else {
        pushToast({
          tone: 'success',
          title: 'Metadata sınıflandırması hazır',
          body: 'Öneri klinik tanı değildir. Onayladıktan sonra analiz çalışır.',
        })
      }
    } catch (err) {
      const message = err instanceof BackendUnavailableError ? err.message : err instanceof Error ? err.message : 'DICOM yükleme başarısız.'
      pushToast({ tone: 'error', title: 'DICOM metadata yüklenemedi', body: message })
    } finally {
      setSubmitting(false)
    }
  }

  const canNext = step !== 0 || (patient.name.trim() && patient.breed.trim() && patient.ownerName.trim())

  const submit = async () => {
    const stamp = nowStamp()
    const loc = localize(neuro, clinical)
    const priority: Priority =
      neuro.deepPain === 'Yok'
        ? 'STAT'
        : neuro.gait === 'Pleji'
          ? 'Acil'
          : neuro.gait === 'Parezi' || neuro.consciousness !== 'Uyanık'
            ? 'Yüksek'
            : 'Normal'

    let built = buildAssessment(loc?.template ?? 'ivdd', patient, neuro, stamp)
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
      const history = `${clinical.complaint}\n${clinical.history}`.trim()
      let result
      if (pipeline === 'dicom_metadata') {
        let ingestId = dicomPreview && !dicomPreview.blocked ? dicomPreview.ingest_id : undefined
        if (!ingestId) {
          if (dicomFiles.length === 0 && !pendingDemoKind) {
            setSubmitting(false)
            pushToast({
              tone: 'warning',
              title: 'DICOM gerekli',
              body: 'Önce .dcm dosyası yükleyin veya DICOM demo / sunucu fixture kullanın.',
            })
            return
          }
          const upload = pendingDemoKind
            ? await uploadDicomDemo({
                kind: pendingDemoKind,
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
            setSubmitting(false)
            pushToast({ tone: 'error', title: 'DICOM ingest engellendi', body: upload.block_reason ?? 'Doğrulama hatası' })
            return
          }
          ingestId = upload.ingest_id
        }
        result = await confirmDicomAndAnalyze({
          ingestId,
          acceptSuggestion,
          modality: acceptSuggestion ? undefined : overrideModality,
          anatomicalRegion: acceptSuggestion ? undefined : overrideRegion,
          patientName: patient.name,
          clinicalHistory: history,
          signal: controller.signal,
          cancelBackendOnAbort: true,
        })
      } else if (pipeline === 'document_context') {
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
          pushToast({ tone: 'error', title: 'Doküman ingest engellendi', body: upload.block_reason ?? 'Yükleme hatası' })
          return
        }
        result = await confirmDocumentAndAnalyze(upload.ingest_id, {
          signal: controller.signal,
          cancelBackendOnAbort: true,
        })
      } else {
        result = await createAndAnalyzeCase({
          patientName: patient.name,
          species: patient.species,
          breed: patient.breed,
          clinicalHistory: history,
          scenario: pipeline,
          patientAgeYears: patient.age || undefined,
          priority:
            neuro.deepPain === 'Yok'
              ? 'stat'
              : neuro.gait === 'Pleji'
                ? 'urgent'
                : neuro.gait === 'Parezi' || neuro.consciousness !== 'Uyanık'
                  ? 'high'
                  : 'normal',
          clinicalHistoryStructured: {
            complaint: clinical.complaint || undefined,
            onset: clinical.onset || undefined,
            course: clinical.course || undefined,
            medications: clinical.medications || undefined,
            relevant_history: clinical.history || undefined,
            handoff_notes: `Klinik→radyolog handoff · ${patient.species} · ${patient.breed || '—'} · ${patient.sex}${patient.neutered ? ' (kısır)' : ''} · ${patient.weight || '?'} kg`,
            sex: patient.sex || undefined,
            weight_kg: patient.weight > 0 ? patient.weight : undefined,
            neutered: patient.neutered,
            neuro_exam: {
              consciousness: neuro.consciousness,
              gait: neuro.gait,
              limbs: neuro.limbs,
              posturalThoracic: neuro.posturalThoracic,
              posturalPelvic: neuro.posturalPelvic,
              reflexThoracic: neuro.reflexThoracic,
              reflexPelvic: neuro.reflexPelvic,
              cranialNerves: neuro.cranialNerves,
              deepPain: neuro.deepPain,
              hyperesthesia: neuro.hyperesthesia,
            },
          },
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
        built = {
          ...built,
          ai: {
            summary: `Analiz başarısız: ${result.job.error_message ?? 'unknown error'}.`,
            findings: [],
            differentials: [],
            recommendedTests: ['Backend günlüklerini kontrol edip yeniden deneyin. Uzman incelemesi zorunludur.'],
            validation: [{ kind: 'unsupported', text: 'Analiz başarısız', detail: result.job.error_message ?? 'failed' }],
            model: 'pipeline',
            generatedAt: stamp,
          },
          draft: {
            klinikOzet: 'Analiz tamamlanamadı; taslak üretilemedi.',
            bulgular: 'Yapılandırılmış bulgu yok.',
            degerlendirme: result.job.error_message ?? 'failed',
            ayiriciTanilar: 'Üretilmedi.',
            oneriler: 'Klinik kullanım için uygun değildir.',
          },
        }
      }
    } catch (err) {
      setSubmitting(false)
      if (submitAbortRef.current === controller) submitAbortRef.current = null
      if (err instanceof PollingCancelledError || (err instanceof DOMException && err.name === 'AbortError')) {
        pushToast({ tone: 'info', title: 'Analiz durduruldu' })
        return
      }
      const message = err instanceof BackendUnavailableError ? err.message : err instanceof Error ? err.message : 'Backend isteği başarısız.'
      pushToast({ tone: 'error', title: 'FastAPI backend yanıt vermedi', body: message })
      return
    }
    if (submitAbortRef.current === controller) submitAbortRef.current = null
    setSubmitting(false)

    const id = backendCaseId
    const no = backendCaseId.replace(/^case-/, 'VM-').toUpperCase()

    const newCase: VetCase = {
      id,
      no,
      patient,
      clinical,
      neuro,
      documents:
        intakeMode === 'dicom'
          ? (dicomPreview?.study
              ? [
                  {
                    ...makeDocument(
                      `${id}-dicom`,
                      `DICOM study ${dicomPreview.study.study_instance_uid}`,
                      'MR Raporu',
                      patient,
                      clinical,
                      built.imaging,
                    ),
                    size: `${dicomPreview.study.series.reduce((n, s) => n + s.instances.length, 0)} instance`,
                    rawText:
                      'DICOM metadata ingest. Pixel data klinik olarak yorumlanmamıştır.',
                    extracted: [
                      { field: 'StudyInstanceUID', value: dicomPreview.study.study_instance_uid, source: 'DICOM' },
                      {
                        field: 'Classification',
                        value: dicomPreview.classification
                          ? `${dicomPreview.classification.suggested_modality} / ${dicomPreview.classification.suggested_anatomical_region} (${dicomPreview.classification.confidence})`
                          : 'n/a',
                        source: 'metadata classifier',
                      },
                    ],
                  },
                ]
              : [])
          : files.map((f, i) => ({ ...makeDocument(`${id}-d${i}`, f.name, f.type, patient, clinical, built.imaging), size: f.size })),
      status: 'isleniyor',
      module: 'Nöroloji',
      priority,
      createdAt: today(),
      clinic: CLINIC,
      vetName: 'Dr. Elif Kaya',
      ai: built.ai,
      aiDraft: built.draft,
      report: { ...built.draft },
      corrections: [],
      timeline: [
        { date: stamp, label: 'Vaka oluşturuldu', by: 'Dr. Elif Kaya' },
        {
          date: stamp,
          label:
            intakeMode === 'dicom'
              ? `DICOM metadata ingest (${dicomPreview?.study?.series.reduce((n, s) => n + s.instances.length, 0) ?? dicomFiles.length} instance)`
              : `${files.length} tetkik belgesi yüklendi`,
          by: 'Dr. Elif Kaya',
        },
        { date: stamp, label: `Analiz: ${backendOutcome} (${backendCaseId})`, by: 'backend' },
      ],
      processingStartedAt: Date.now(),
      backendCaseId,
      backendJobId,
      backendOutcome,
      backendFindings,
      backendDraft,
      fromBackend: true,
    }
    addCase(newCase)
    setTimeout(() => updateCase(id, { status: 'ai_analizi' }), AI_PHASE_START)
    setTimeout(() => {
      const done = nowStamp()
      const nextStatus = caseStatusFromBackendOutcome(backendOutcome)
      const statusNote =
        backendOutcome === 'failed'
          ? 'Analiz başarısız. Bu uzman revizyon talebi değildir; onaylanabilir AI taslak yoktur.'
          : backendOutcome === 'unsupported'
            ? 'Desteklenmeyen görüntüleme kombinasyonu. Manuel radyolog incelemesi gerekir; AI draft onayı kapalıdır.'
            : undefined
      const timelineLabel =
        backendOutcome === 'failed'
          ? 'Analiz başarısız — AI draft üretilmedi'
          : backendOutcome === 'unsupported'
            ? 'Analiz: unsupported → manuel inceleme (AI draft yok)'
            : `Analiz tamamlandı (${backendOutcome}) — uzman incelemesine bırakıldı`
      updateCase(id, (c) => ({
        status: nextStatus,
        processingMs: PIPELINE_MS,
        statusNote: statusNote ?? c.statusNote,
        timeline: [
          ...c.timeline,
          { date: done, label: 'Analiz tamamlandı', by: 'Sistem' },
          { date: done, label: timelineLabel, by: 'pipeline' },
        ],
      }))
      const tone = backendOutcome === 'failed' ? 'error' : backendOutcome === 'unsupported' ? 'warning' : 'success'
      const title =
        backendOutcome === 'failed'
          ? 'Analiz başarısız'
          : backendOutcome === 'unsupported'
            ? 'Manuel incelemeye yönlendirildi'
            : 'AI ön değerlendirmesi hazır'
      pushToast({ tone, title, body: `${patient.name} vakası güncellendi.` })
    }, PIPELINE_MS)
    nav(`/vakalar/${id}/isleme`)
  }

  return (
    <>
      <PageHeader
        title="Yeni Vaka"
        subtitle="Klinik öykü → görüntüleme → gönder · Nöroloji"
        crumbs={[{ label: 'Vakalar', to: '/vakalar' }, { label: 'Yeni Vaka' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<UploadCloud className="h-4 w-4" />} onClick={() => nav('/dicom-yukle')}>
              DICOM ile başla
            </Button>
            <Button variant="secondary" icon={<Sparkles className="h-4 w-4 text-teal-600" />} onClick={fillSample}>
              Örnek doldur
            </Button>
          </div>
        }
      />
      <details className="mb-4 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-navy-800">Hızlı doldurma</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<Brain className="h-3.5 w-3.5 text-teal-600" />} onClick={fillBrainBackend}>
            Brain MRI
          </Button>
          <Button size="sm" variant="secondary" onClick={fillCervicalBackend}>
            Cervical MRI
          </Button>
          <Button size="sm" variant="secondary" onClick={() => fillDicomDemo('brain_mri')}>
            DICOM · Brain
          </Button>
          <Button size="sm" variant="secondary" onClick={() => fillDicomDemo('cervical_mri')}>
            DICOM · Cervical
          </Button>
          <Button size="sm" variant="secondary" onClick={() => fillDicomDemo('brain_ct')}>
            DICOM · CT
          </Button>
          <Button size="sm" variant="secondary" onClick={() => fillDicomDemo('thorax_xr')}>
            DICOM · XR
          </Button>
        </div>
      </details>
      <Card className="mb-6 p-5">
        <StepIndicator steps={STEPS} current={step} onSelect={setStep} />
      </Card>

      <Card className="p-6">
        {step === 0 && (
          <div className="animate-fade-up">
            <h2 className="mb-5 text-lg font-semibold text-navy-900">Hasta Bilgileri</h2>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Hasta adı *"><input className="input" value={patient.name} onChange={(e) => P('name', e.target.value)} placeholder="ör. Paşa" /></Field>
              <Field label="Tür"><Pills options={['Köpek', 'Kedi', 'Diğer'] as const} value={patient.species} onChange={(v) => P('species', v)} /></Field>
              <Field label="Irk *"><input className="input" value={patient.breed} onChange={(e) => P('breed', e.target.value)} placeholder="ör. Dachshund" /></Field>
              <Field label="Cinsiyet"><Pills options={['Erkek', 'Dişi'] as const} value={patient.sex} onChange={(v) => P('sex', v)} /></Field>
              <Field label="Kısırlaştırma durumu"><Pills options={['Kısırlaştırılmış', 'Kısırlaştırılmamış'] as const} value={patient.neutered ? 'Kısırlaştırılmış' : 'Kısırlaştırılmamış'} onChange={(v) => P('neutered', v === 'Kısırlaştırılmış')} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Yaş (yıl)"><input type="number" min={0} className="input" value={patient.age || ''} onChange={(e) => P('age', Number(e.target.value))} /></Field>
                <Field label="Kilo (kg)"><input type="number" min={0} step="0.1" className="input" value={patient.weight || ''} onChange={(e) => P('weight', Number(e.target.value))} /></Field>
              </div>
              <Field label="Sahip adı soyadı *"><input className="input" value={patient.ownerName} onChange={(e) => P('ownerName', e.target.value)} placeholder="ör. Mehmet Yılmaz" /></Field>
              <Field label="Sahip telefon"><input className="input" value={patient.ownerPhone} onChange={(e) => P('ownerPhone', e.target.value)} placeholder="05xx xxx xx xx" /></Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="animate-fade-up">
            <h2 className="mb-5 text-lg font-semibold text-navy-900">Klinik Bilgiler</h2>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Başvuru şikâyeti" className="md:col-span-2"><textarea rows={3} className="input" value={clinical.complaint} onChange={(e) => C('complaint', e.target.value)} placeholder="Sahibin bildirdiği ana şikâyet" /></Field>
              <Field label="Belirtilerin başlangıcı"><Pills options={['Akut', 'Kronik'] as const} value={clinical.onset} onChange={(v) => C('onset', v)} /></Field>
              <Field label="Seyir"><Pills options={['Progresif', 'Stabil', 'İyileşen'] as const} value={clinical.course} onChange={(v) => C('course', v)} /></Field>
              <Field label="Klinik geçmiş"><textarea rows={3} className="input" value={clinical.history} onChange={(e) => C('history', e.target.value)} /></Field>
              <Field label="Mevcut ilaçlar"><textarea rows={3} className="input" value={clinical.medications} onChange={(e) => C('medications', e.target.value)} /></Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid animate-fade-up gap-6 xl:grid-cols-3">
            <div className="space-y-6 xl:col-span-2">
              <h2 className="text-lg font-semibold text-navy-900">Nörolojik Muayene Formu</h2>
              <Field label="Bilinç durumu"><Pills options={['Uyanık', 'Depresif', 'Stupor', 'Koma'] as const} value={neuro.consciousness} onChange={(v) => N('consciousness', v)} /></Field>
              <div className="grid gap-6 md:grid-cols-2">
                <Field label="Yürüyüş"><Pills options={['Normal', 'Ataksi', 'Parezi', 'Pleji'] as const} value={neuro.gait} onChange={(v) => N('gait', v)} /></Field>
                <Field label="Etkilenen bacaklar"><Checks options={LIMBS} value={neuro.limbs} onChange={(v) => N('limbs', v)} /></Field>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <Field label="Postüral reaksiyonlar — ön bacaklar"><Pills options={['Normal', 'Azalmış', 'Yok'] as const} value={neuro.posturalThoracic} onChange={(v) => N('posturalThoracic', v)} /></Field>
                <Field label="Postüral reaksiyonlar — arka bacaklar"><Pills options={['Normal', 'Azalmış', 'Yok'] as const} value={neuro.posturalPelvic} onChange={(v) => N('posturalPelvic', v)} /></Field>
                <Field label="Spinal refleksler — torasik"><Pills options={['Normal', 'Azalmış', 'Artmış'] as const} value={neuro.reflexThoracic} onChange={(v) => N('reflexThoracic', v)} /></Field>
                <Field label="Spinal refleksler — pelvik"><Pills options={['Normal', 'Azalmış', 'Artmış'] as const} value={neuro.reflexPelvic} onChange={(v) => N('reflexPelvic', v)} /></Field>
              </div>
              <Field label="Kraniyal sinir bulguları (yoksa boş bırakın)"><Checks options={CN} value={neuro.cranialNerves} onChange={(v) => N('cranialNerves', v)} /></Field>
              <div className="grid gap-6 md:grid-cols-2">
                <Field label="Ağrı algısı (derin ağrı)"><Pills options={['Var', 'Yok', 'Değerlendirilmedi'] as const} value={neuro.deepPain} onChange={(v) => N('deepPain', v)} /></Field>
                <Field label="Spinal hiperestezi bölgesi"><Pills options={['Yok', 'Servikal', 'Torakolomber', 'Lumbosakral'] as const} value={neuro.hyperesthesia} onChange={(v) => N('hyperesthesia', v)} /></Field>
              </div>
            </div>
            <div>
              <div className="sticky top-24 rounded-xl border border-teal-200 bg-gradient-to-b from-teal-50 to-white p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
                  <Lightbulb className="h-4 w-4" /> Olası lezyon lokalizasyonu
                </div>
                {hint ? (
                  <>
                    <p className="mt-3 text-2xl font-bold text-navy-900">{hint.region}</p>
                    <p className="mt-2 text-sm text-navy-700">{hint.text}</p>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">Muayene bulgularını işaretledikçe olası lokalizasyon burada gösterilecek.</p>
                )}
                {neuro.deepPain === 'Değerlendirilmedi' && (
                  <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">Derin ağrı algısı değerlendirilmedi olarak işaretli. Bu bilgi prognoz için önemlidir.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="animate-fade-up">
            <h2 className="mb-1 text-lg font-semibold text-navy-900">Tetkik Yükleme</h2>
            <p className="mb-4 text-sm text-slate-500">
              Belge yolu dosyaları backend doküman kanalına gönderir. DICOM yolu metadata ingest kullanır; piksel tabanlı tanı yoktur.
            </p>
            <div className="mb-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setIntakeMode('documents')
                  setPipeline((p) => (p === 'dicom_metadata' ? 'document_context' : p))
                  setDicomPreview(null)
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${intakeMode === 'documents' ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-navy-700 ring-slate-300'}`}
              >
                Belge (PDF)
              </button>
              <button
                type="button"
                onClick={() => {
                  setIntakeMode('dicom')
                  setPipeline('dicom_metadata')
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${intakeMode === 'dicom' ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-navy-700 ring-slate-300'}`}
              >
                DICOM metadata
              </button>
            </div>

            {intakeMode === 'documents' ? (
              <>
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDrag(true)
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDrag(false)
                    addFiles(e.dataTransfer.files)
                  }}
                  onClick={() => inputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
                    drag ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50/50 hover:border-teal-400 hover:bg-teal-50/40'
                  }`}
                >
                  <UploadCloud className="h-10 w-10 text-teal-600" />
                  <p className="mt-3 font-medium text-navy-900">Dosyaları buraya sürükleyin veya seçmek için tıklayın</p>
                  <p className="mt-1 text-xs text-slate-500">
                    PDF, JPG, PNG, TXT · backend quarantine + metin çıkarma · tanı değil (pipeline: Doküman / multimodal)
                  </p>
                  <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
                </div>
                {files.length > 0 && (
                  <ul className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {files.map((f) => (
                      <li key={f.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                        <div className="flex flex-1 items-center gap-3">
                          <div className="rounded-lg bg-rose-50 p-2 text-rose-600"><FileText className="h-5 w-5" /></div>
                          <div>
                            <p className="text-sm font-medium text-navy-900">{f.name}</p>
                            <p className="text-xs text-slate-500">{f.size}</p>
                          </div>
                        </div>
                        <select className="input sm:w-52" value={f.type} onChange={(e) => setFiles((fs) => fs.map((x) => (x.id === f.id ? { ...x, type: e.target.value as DocType } : x)))}>
                          {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                        <button onClick={() => setFiles((fs) => fs.filter((x) => x.id !== f.id))} className="self-end rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:self-auto">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
                  DICOM dosyaları metadata sınıflandırması için kullanılır; kesin tanı değildir.
                </div>
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDrag(true)
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDrag(false)
                    addDicomFiles(e.dataTransfer.files)
                  }}
                  onClick={() => dicomInputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
                    drag ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-slate-50/50 hover:border-teal-400 hover:bg-teal-50/40'
                  }`}
                >
                  <UploadCloud className="h-10 w-10 text-teal-600" />
                  <p className="mt-3 font-medium text-navy-900">DICOM (.dcm) dosyalarını sürükleyin</p>
                  <p className="mt-1 text-xs text-slate-500">Tek study · birden fazla instance · en fazla 25 MB / dosya</p>
                  <input
                    ref={dicomInputRef}
                    type="file"
                    multiple
                    accept=".dcm,application/dicom,*/*"
                    className="hidden"
                    onChange={(e) => addDicomFiles(e.target.files)}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={submitting || dicomFiles.length === 0} onClick={() => void previewDicomMetadata()}>
                    {submitting ? 'Yükleniyor…' : 'Metadata önizle'}
                  </Button>
                  <Button variant="secondary" disabled={submitting} onClick={() => void previewDicomMetadata('brain_mri')}>
                    Brain MRI
                  </Button>
                  <Button variant="secondary" disabled={submitting} onClick={() => void previewDicomMetadata('cervical_mri')}>
                    Cervical MRI
                  </Button>
                  <Button variant="secondary" disabled={submitting} onClick={() => void previewDicomMetadata('brain_ct')}>
                    Brain CT
                  </Button>
                  <Button variant="secondary" disabled={submitting} onClick={() => void previewDicomMetadata('thorax_xr')}>
                    Thorax XR
                  </Button>
                </div>
                {dicomFiles.length > 0 && (
                  <ul className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {dicomFiles.map((f) => (
                      <li key={`${f.name}-${f.lastModified}`} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="rounded-lg bg-teal-50 p-2 text-teal-700"><FileText className="h-5 w-5" /></div>
                          <div>
                            <p className="text-sm font-medium text-navy-900">{f.name}</p>
                            <p className="text-xs text-slate-500">{f.size > 1024 ? `${Math.round(f.size / 1024)} KB` : `${f.size} B`}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setDicomPreview(null)
                            setDicomFiles((fs) => fs.filter((x) => x !== f))
                          }}
                          className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {dicomPreview && (
                  <div className={`mt-5 rounded-xl border p-4 text-sm ${dicomPreview.blocked ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-teal-200 bg-teal-50/60 text-navy-900'}`}>
                    <p className="font-semibold">{dicomPreview.blocked ? 'Ingest engellendi' : 'Metadata önizlemesi hazır'}</p>
                    <p className="mt-1 text-xs opacity-80">ingest_id: {dicomPreview.ingest_id}</p>
                    {dicomPreview.classification && (
                      <p className="mt-2">
                        Öneri: <strong>{dicomPreview.classification.suggested_modality}</strong> /{' '}
                        <strong>{dicomPreview.classification.suggested_anatomical_region}</strong> · güven:{' '}
                        {dicomPreview.classification.confidence}
                        {dicomPreview.classification.needs_confirmation ? ' · onay gerekli' : ''}
                      </p>
                    )}
                    {dicomPreview.issues.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                        {dicomPreview.issues.slice(0, 6).map((issue, i) => (
                          <li key={`${issue.code}-${i}`}>
                            [{issue.severity}] {issue.code}: {issue.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="animate-fade-up space-y-5">
            <h2 className="text-lg font-semibold text-navy-900">Özet ve Gönder</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <Summary title="Hasta Bilgileri" onEdit={() => setStep(0)} rows={[
                ['Hasta', `${patient.name || '—'} (${patient.species})`],
                ['Irk', patient.breed || '—'],
                ['Cinsiyet', `${patient.sex}, ${patient.neutered ? 'kısırlaştırılmış' : 'kısırlaştırılmamış'}`],
                ['Yaş / Kilo', `${patient.age} yaş · ${patient.weight} kg`],
                ['Sahip', `${patient.ownerName || '—'} ${patient.ownerPhone ? `· ${patient.ownerPhone}` : ''}`],
              ]} />
              <Summary title="Klinik Bilgiler" onEdit={() => setStep(1)} rows={[
                ['Şikâyet', clinical.complaint || '—'],
                ['Başlangıç / Seyir', `${clinical.onset} · ${clinical.course}`],
                ['Klinik geçmiş', clinical.history || '—'],
                ['İlaçlar', clinical.medications || '—'],
              ]} />
              <Summary title="Nörolojik Muayene" onEdit={() => setStep(2)} rows={[
                ['Bilinç', neuro.consciousness],
                ['Yürüyüş', `${neuro.gait}${neuro.limbs.length ? ` (${neuro.limbs.join(', ')})` : ''}`],
                ['Postüral (ön / arka)', `${neuro.posturalThoracic} / ${neuro.posturalPelvic}`],
                ['Refleksler (torasik / pelvik)', `${neuro.reflexThoracic} / ${neuro.reflexPelvic}`],
                ['Kraniyal sinirler', neuro.cranialNerves.join(', ') || 'Normal'],
                ['Derin ağrı', neuro.deepPain],
                ['Hiperestezi', neuro.hyperesthesia],
                ['Olası lokalizasyon', hint?.region ?? '—'],
              ]} />
              <Summary
                title={intakeMode === 'dicom' ? `DICOM (${dicomFiles.length || dicomPreview?.study?.series.reduce((n, s) => n + s.instances.length, 0) || 0})` : `Tetkikler (${files.length})`}
                onEdit={() => setStep(3)}
                rows={
                  intakeMode === 'dicom'
                    ? dicomPreview?.study
                      ? [
                          ['Study UID', dicomPreview.study.study_instance_uid],
                          ['Series / Instance', `${dicomPreview.study.series.length} / ${dicomPreview.study.series.reduce((n, s) => n + s.instances.length, 0)}`],
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
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="mb-2 text-sm font-semibold text-navy-900">Analiz kanalı</p>
              <p className="mb-3 text-xs text-slate-500">
                Seçilen kanal üzerinden AI ön değerlendirme çalışır; sonuç uzman onayına iletilir.
              </p>
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
            {pipeline === 'dicom_metadata' && (
              <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-4">
                <p className="mb-2 text-sm font-semibold text-navy-900">DICOM sınıflandırma onayı</p>
                <p className="mb-3 text-xs text-slate-600">
                  Metadata önerisidir; anatomik tanı değildir. Onaylanmadan analiz çalışmaz.
                </p>
                {!dicomPreview && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={submitting || dicomFiles.length === 0} onClick={() => void previewDicomMetadata()}>
                      Yüklenen .dcm ile önizle
                    </Button>
                    <Button variant="secondary" disabled={submitting} onClick={() => void previewDicomMetadata('brain_mri')}>
                      Brain MRI
                    </Button>
                    <Button variant="secondary" disabled={submitting} onClick={() => void previewDicomMetadata('cervical_mri')}>
                      Cervical MRI
                    </Button>
                    <Button variant="secondary" disabled={submitting} onClick={() => void previewDicomMetadata('brain_ct')}>
                      Brain CT
                    </Button>
                    <Button variant="secondary" disabled={submitting} onClick={() => void previewDicomMetadata('thorax_xr')}>
                      Thorax XR
                    </Button>
                  </div>
                )}
                {dicomPreview?.classification && !dicomPreview.blocked && (
                  <>
                    <label className="mb-3 flex items-center gap-2 text-sm text-navy-800">
                      <input type="checkbox" checked={acceptSuggestion} onChange={(e) => setAcceptSuggestion(e.target.checked)} />
                      Öneriyi kabul et ({dicomPreview.classification.suggested_modality} / {dicomPreview.classification.suggested_anatomical_region})
                    </label>
                    {!acceptSuggestion && (
                      <div className="mb-3 grid gap-3 sm:grid-cols-2">
                        <Field label="Modality override">
                          <select className="input" value={overrideModality} onChange={(e) => setOverrideModality(e.target.value as BackendModality)}>
                            <option value="MR">MR</option>
                            <option value="CT">CT</option>
                            <option value="XR">XR</option>
                          </select>
                        </Field>
                        <Field label="Anatomik bölge override">
                          <select className="input" value={overrideRegion} onChange={(e) => setOverrideRegion(e.target.value as BackendAnatomicalRegion)}>
                            <option value="BRAIN">BRAIN</option>
                            <option value="CERVICAL">CERVICAL</option>
                            <option value="THORAX">THORAX</option>
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
            )}
            <div className="flex flex-col items-start gap-4 rounded-xl border border-navy-100 bg-navy-50/60 p-5 md:flex-row md:items-center">
              <Brain className="h-8 w-8 shrink-0 text-teal-600" />
              <p className="flex-1 text-sm text-navy-800">
                Gönderdiğinizde AI ön değerlendirme çalışır ve taslak <strong>uzman veteriner hekim onayına</strong> iletilir.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="lg"
                  onClick={() => void submit()}
                  disabled={
                    !patient.name.trim() ||
                    submitting ||
                    (pipeline === 'dicom_metadata' && Boolean(dicomPreview?.blocked))
                  }
                  icon={<Sparkles className="h-4 w-4" />}
                >
                  {submitting ? 'İşleniyor…' : pipeline === 'dicom_metadata' ? 'Onayla ve Analiz Çalıştır' : 'Yapay Zekâ Değerlendirmesine Gönder'}
                </Button>
                {submitting && (
                  <Button
                    size="lg"
                    variant="secondary"
                    icon={<Square className="h-4 w-4" />}
                    onClick={() => submitAbortRef.current?.abort()}
                  >
                    Analizi durdur
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {step < 4 && (
          <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)} icon={<ArrowLeft className="h-4 w-4" />}>Geri</Button>
            <div className="flex items-center gap-3">
              {!canNext && <span className="text-xs text-slate-500">Zorunlu alanları doldurun</span>}
              <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                İleri <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        {step === 4 && (
          <div className="mt-6">
            <Button variant="ghost" onClick={() => setStep(3)} icon={<ArrowLeft className="h-4 w-4" />}>Geri</Button>
          </div>
        )}
      </Card>
    </>
  )
}

function Summary({ title, rows, onEdit }: { title: string; rows: string[][]; onEdit: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <p className="text-sm font-semibold text-navy-900">{title}</p>
        <button onClick={onEdit} className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"><Pencil className="h-3 w-3" /> Düzenle</button>
      </div>
      <dl className="divide-y divide-slate-50 px-4 py-1">
        {rows.map(([k, v], i) => (
          <div key={i} className="grid grid-cols-5 gap-3 py-2 text-sm">
            <dt className="col-span-2 text-slate-500">{k}</dt>
            <dd className="col-span-3 text-navy-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
