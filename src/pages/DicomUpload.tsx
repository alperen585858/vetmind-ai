import { useCallback, useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bone,
  Brain,
  CheckCircle2,
  FileText,
  FolderOpen,
  Info,
  PanelRightClose,
  PanelRightOpen,
  Scan,
  Sparkles,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { DicomViewer } from '../components/DicomViewer'
import { SeriesExplorer, buildSeriesItems } from '../components/SeriesExplorer'
import { CLINIC } from '../data/mock'
import { buildAssessment, makeDocument } from '../data/templates'
import { localize } from '../lib/localization'
import { nowStamp, today } from '../lib/format'
import { AI_PHASE_START, PIPELINE_MS } from '../lib/pipeline'
import {
  BackendUnavailableError,
  PollingCancelledError,
  confirmDicomAndAnalyze,
  draftToSections,
  fetchDemoDicomFiles,
  pipelineToAssessment,
  uploadDicomDemo,
  uploadDicomFiles,
} from '../lib/backend'
import { buildDicomPreviews, type DicomFramePreview } from '../lib/dicomPreview'
import {
  MAX_DICOM_FILES,
  MAX_DICOM_FILE_BYTES,
  MAX_DICOM_TOTAL_BYTES,
  MAX_VIEWER_FRAMES,
  collectFilesFromDataTransfer,
  collectFilesFromFileList,
  rejectReasonLabel,
  validateDicomSelectionAsync,
} from '../lib/dicomFolder'
import {
  PHASE_LABELS,
  canStartDemoAnalysis,
  classificationConfirmationLabel,
  deriveSelectionPhase,
  phaseFromPipelineOutcome,
  validatePatientForm,
} from '../lib/dicomWorkflow'
import { caseStatusFromBackendOutcome } from '../lib/caseStatusMap'
import { cacheCaseDicomFiles } from '../lib/dicomCaseCache'
import type {
  BackendAnatomicalRegion,
  BackendModality,
  ClinicalInfo,
  DicomDemoKind,
  DicomUploadResponse,
  NeuroExam,
  Patient,
  Priority,
  VetCase,
} from '../types'

const EMPTY_NEURO: NeuroExam = {
  consciousness: 'Uyanık',
  gait: 'Normal',
  limbs: [],
  posturalThoracic: 'Normal',
  posturalPelvic: 'Normal',
  reflexThoracic: 'Normal',
  reflexPelvic: 'Normal',
  cranialNerves: [],
  deepPain: 'Değerlendirilmedi',
  hyperesthesia: 'Yok',
}

const DEMO_SETS: {
  kind: DicomDemoKind
  label: string
  hint: string
  tone: string
  Icon: typeof Brain
}[] = [
  { kind: 'brain_mri', label: 'Brain MRI', hint: 'MR · kranial', tone: 'from-teal-50 to-cyan-50 text-teal-700', Icon: Brain },
  { kind: 'cervical_mri', label: 'Cervical MRI', hint: 'MR · servikal', tone: 'from-sky-50 to-indigo-50 text-sky-700', Icon: Bone },
  { kind: 'brain_ct', label: 'Brain CT', hint: 'BT · kranial', tone: 'from-violet-50 to-slate-50 text-violet-700', Icon: Scan },
  { kind: 'thorax_xr', label: 'Thorax XR', hint: 'Röntgen · toraks', tone: 'from-amber-50 to-orange-50 text-amber-700', Icon: FileText },
]

export default function DicomUpload() {
  const { addCase, pushToast, updateCase, user } = useApp()
  const nav = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const [patientName, setPatientName] = useState('Pax')
  const [species, setSpecies] = useState<Patient['species']>('Köpek')
  const [breed, setBreed] = useState('Golden Retriever')
  const [ageYears, setAgeYears] = useState('')
  const [history, setHistory] = useState('')
  const [consent, setConsent] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [frames, setFrames] = useState<DicomFramePreview[]>([])
  const [framesLoading, setFramesLoading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [preview, setPreview] = useState<DicomUploadResponse | null>(null)
  const [acceptSuggestion, setAcceptSuggestion] = useState(true)
  const [overrideModality, setOverrideModality] = useState<BackendModality>('MR')
  const [overrideRegion, setOverrideRegion] = useState<BackendAnatomicalRegion>('BRAIN')
  const [pendingDemo, setPendingDemo] = useState<DicomDemoKind | null>(null)
  const [busy, setBusy] = useState(false)
  const [validating, setValidating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [activeSeriesKey, setActiveSeriesKey] = useState<string | null>(null)
  const [activeSopUid, setActiveSopUid] = useState<string | null>(null)
  const [focusSopUid, setFocusSopUid] = useState<string | null>(null)
  const [focusRequestId, setFocusRequestId] = useState(0)
  const [clinicalOpen, setClinicalOpen] = useState(true)
  const [lastRejectSummary, setLastRejectSummary] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const submitLockRef = useRef(false)

  const hasStudy = files.length > 0
  const viewerFiles = useMemo(() => files.slice(0, MAX_VIEWER_FRAMES), [files])
  const workspacePhase = useMemo(
    () =>
      deriveSelectionPhase({
        fileCount: files.length,
        validating,
        uploading: uploading || busy,
        previewReady: Boolean(preview && !preview.blocked),
        previewBlocked: Boolean(preview?.blocked),
        confirmed: false,
      }),
    [files.length, validating, uploading, busy, preview],
  )

  // Stop client polling / in-flight requests on leave — does not cancel backend jobs.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      submitLockRef.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!viewerFiles.length) {
      setFrames([])
      setFramesLoading(false)
      return
    }
    setFramesLoading(true)
    void buildDicomPreviews(viewerFiles).then((next) => {
      if (!cancelled) {
        setFrames(next)
        setFramesLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [viewerFiles])

  const seriesTree = useMemo(
    () => buildSeriesItems(files, frames, preview?.study),
    [files, frames, preview?.study],
  )

  const studySummary = useMemo(() => {
    const seriesCount = preview?.study?.series.length ?? seriesTree.series.length
    const imageCount =
      preview?.study?.series.reduce((n, s) => n + s.instances.length, 0) ?? files.length
    const modality =
      preview?.classification?.suggested_modality ??
      frames.find((f) => f.modality)?.modality ??
      preview?.study?.series.find((s) => s.modality)?.modality ??
      null
    const studyDescription =
      preview?.study?.study_description ??
      frames.find((f) => f.studyDescription)?.studyDescription ??
      null
    return { seriesCount, imageCount, modality, studyDescription }
  }, [preview, seriesTree.series.length, files.length, frames])

  const onActiveFrameChange = useCallback((frame: DicomFramePreview) => {
    if (frame.sopInstanceUid) setActiveSopUid(frame.sopInstanceUid)
    if (frame.seriesInstanceUid) {
      setActiveSeriesKey(frame.seriesInstanceUid)
      return
    }
    if (frame.seriesDescription) {
      setActiveSeriesKey(`desc:${frame.seriesDescription}`)
      return
    }
    setActiveSeriesKey(null)
  }, [])

  const cancelInFlight = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setValidating(false)
    setUploading(false)
    setUploadProgress(null)
    submitLockRef.current = false
    pushToast({
      tone: 'info',
      title: 'İşlem iptal edildi',
      body: 'Yükleme durduruldu; analiz başlamışsa backend iptal isteği de gönderilir.',
    })
  }, [pushToast])

  const mergeIncoming = async (incoming: File[], sourceLabel: string) => {
    if (!incoming.length) {
      pushToast({
        tone: 'warning',
        title: 'DICOM bulunamadı',
        body: `${sourceLabel}: uygun .dcm / DICOM dosyası yok.`,
      })
      return
    }
    setValidating(true)
    setUploadProgress('Dosyalar doğrulanıyor…')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await validateDicomSelectionAsync(incoming, files, {
        signal: controller.signal,
        sniff: true,
      })
      setPreview(null)
      setPendingDemo(null)
      setFiles(result.accepted)
      const rejectedCount = result.rejected.length
      if (rejectedCount > 0) {
        const sample = result.rejected
          .slice(0, 3)
          .map((r) => `${r.name}: ${rejectReasonLabel(r.reason)}`)
          .join('; ')
        setLastRejectSummary(`${rejectedCount} dosya reddedildi — ${sample}`)
        pushToast({
          tone: 'warning',
          title: `${rejectedCount} dosya reddedildi`,
          body: sample,
        })
      } else {
        setLastRejectSummary(null)
      }
      const added = result.accepted.length - files.length
      if (added > 0) {
        pushToast({
          tone: 'success',
          title: `${added} DICOM eklendi`,
          body: `${sourceLabel} · toplam ${result.accepted.length} dosya`,
        })
      } else if (!rejectedCount) {
        pushToast({
          tone: 'warning',
          title: 'Yeni dosya yok',
          body: 'Seçim zaten oturumda veya filtreye uymadı.',
        })
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      pushToast({
        tone: 'error',
        title: 'Doğrulama başarısız',
        body: err instanceof Error ? err.message : 'Dosyalar doğrulanamadı.',
      })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setValidating(false)
      setUploadProgress(null)
    }
  }

  const addFromFileList = (list: FileList | null, sourceLabel: string) => {
    void mergeIncoming(collectFilesFromFileList(list), sourceLabel)
  }

  const addFromDrop = async (dt: DataTransfer) => {
    setBusy(true)
    setUploadProgress('Dosyalar okunuyor…')
    try {
      const collected = await collectFilesFromDataTransfer(dt)
      await mergeIncoming(collected, 'Klasör / sürükle-bırak')
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Klasör okunamadı',
        body: err instanceof Error ? err.message : 'Sürüklenen klasör işlenemedi.',
      })
    } finally {
      setBusy(false)
      setUploadProgress(null)
    }
  }

  const loadDemoForViewing = async (kind: DicomDemoKind) => {
    setBusy(true)
      setUploadProgress('Örnek veri seti yükleniyor…')
    try {
      const demoFiles = await fetchDemoDicomFiles(kind)
      setPendingDemo(kind)
      setPreview(null)
      setFiles(demoFiles)
      pushToast({
        tone: 'info',
        title: 'Örnek DICOM yüklendi',
        body: 'Görüntüleyici açıldı. İsterseniz metadata önizleyebilir veya analize devam edebilirsiniz.',
      })
    } catch (err) {
      const message =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Örnek indirilemedi'
      pushToast({ tone: 'error', title: 'Örnek DICOM alınamadı', body: message })
    } finally {
      setBusy(false)
      setUploadProgress(null)
    }
  }

  const applyDefaults = (upload: DicomUploadResponse) => {
    if (!upload.classification) return
    setAcceptSuggestion(true)
    const mod = upload.classification.suggested_modality
    setOverrideModality(mod === 'CT' || mod === 'XR' || mod === 'MR' ? mod : 'MR')
    const region = upload.classification.suggested_anatomical_region
    setOverrideRegion(
      region === 'CERVICAL' || region === 'THORAX' || region === 'BRAIN' ? region : 'BRAIN',
    )
  }

  const runPreview = async (kind?: DicomDemoKind) => {
    const formErr = validatePatientForm({ patientName, species, consent: true })
    if (formErr.patientName) {
      pushToast({ tone: 'warning', title: 'Hasta adı gerekli', body: 'Yüklemeden önce hasta adını girin.' })
      return
    }
    if (!kind && files.length === 0) {
      pushToast({
        tone: 'warning',
        title: 'Dosya yok',
        body: 'Önce .dcm sürükleyin veya örnek veri setini kullanın.',
      })
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setUploading(true)
    setUploadProgress('Metadata yükleniyor / doğrulanıyor…')
    try {
      const upload = kind
        ? await uploadDicomDemo({
            kind,
            patientName,
            species,
            breed,
            clinicalHistory: history,
            signal: controller.signal,
          })
        : await uploadDicomFiles({
            files,
            patientName,
            species,
            breed,
            clinicalHistory: history,
            signal: controller.signal,
          })
      setPreview(upload)
      setPendingDemo(kind ?? null)
      applyDefaults(upload)
      if (upload.blocked) {
        pushToast({ tone: 'error', title: 'Yükleme engellendi', body: upload.block_reason ?? 'Doğrulama hatası' })
      } else {
        pushToast({
          tone: 'success',
          title: 'Metadata hazır',
          body: 'Sınıflandırmayı kontrol edip analize devam edebilirsiniz.',
        })
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const message =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Yükleme başarısız'
      pushToast({ tone: 'error', title: 'DICOM yüklenemedi', body: message })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setBusy(false)
      setUploading(false)
      setUploadProgress(null)
    }
  }

  const clearAll = () => {
    abortRef.current?.abort()
    abortRef.current = null
    submitLockRef.current = false
    setFiles([])
    setFrames([])
    setPreview(null)
    setPendingDemo(null)
    setActiveSeriesKey(null)
    setActiveSopUid(null)
    setFocusSopUid(null)
    setLastRejectSummary(null)
    setUploadProgress(null)
    setValidating(false)
    setUploading(false)
    setBusy(false)
  }

  const submit = async () => {
    if (submitLockRef.current) {
      pushToast({ tone: 'warning', title: 'İşlem sürüyor', body: 'Yinelenen gönderim engellendi.' })
      return
    }
    const formErrors = validatePatientForm({ patientName, species, consent })
    if (formErrors.patientName || formErrors.consent) {
      pushToast({
        tone: 'warning',
        title: formErrors.patientName ? 'Hasta adı gerekli' : 'Onay gerekli',
        body: formErrors.consent ?? formErrors.patientName,
      })
      return
    }
    const gate = canStartDemoAnalysis({
      phase: workspacePhase,
      consent,
      previewBlocked: Boolean(preview?.blocked),
      hasIngestOrDemo: Boolean((preview && !preview.blocked) || files.length || pendingDemo),
    })
    if (!gate.ok) {
      pushToast({
        tone: 'warning',
        title: 'Analiz başlatılamaz',
        body: gate.reason ?? 'Önkoşullar sağlanmadı',
      })
      return
    }
    submitLockRef.current = true
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setUploading(true)
    setUploadProgress('Analiz hazırlanıyor…')
    try {
      let ingestId = preview && !preview.blocked ? preview.ingest_id : undefined
      let uploadSnap = preview
      if (!ingestId) {
        if (files.length === 0 && !pendingDemo) {
          pushToast({
            tone: 'warning',
            title: 'DICOM gerekli',
            body: 'Dosya sürükleyin veya örnek veri setini kullanın.',
          })
          return
        }
        setUploadProgress('Metadata yükleniyor…')
        const upload = pendingDemo
          ? await uploadDicomDemo({
              kind: pendingDemo,
              patientName,
              species,
              breed,
              clinicalHistory: history,
              signal: controller.signal,
            })
          : await uploadDicomFiles({
              files,
              patientName,
              species,
              breed,
              clinicalHistory: history,
              signal: controller.signal,
            })
        uploadSnap = upload
        setPreview(upload)
        applyDefaults(upload)
        if (upload.blocked) {
          pushToast({ tone: 'error', title: 'Yükleme engellendi', body: upload.block_reason ?? 'Doğrulama hatası' })
          return
        }
        ingestId = upload.ingest_id
      }

      setUploadProgress('Sınıflandırma onayı + analiz…')
      const result = await confirmDicomAndAnalyze({
        ingestId,
        acceptSuggestion,
        modality: acceptSuggestion ? undefined : overrideModality,
        anatomicalRegion: acceptSuggestion ? undefined : overrideRegion,
        patientName,
        clinicalHistory: history,
        imagingSourcePermissionVerified: consent,
        imagingAnalysisConsentVerified: consent,
        signal: controller.signal,
        cancelBackendOnAbort: true,
        onJobEnqueued: () => {
          setUploadProgress('Analiz sürüyor… Durdurmak için İptal’e basın.')
        },
      })

      const parsedAge = ageYears.trim() === '' ? 0 : Number(ageYears)
      const patient: Patient = {
        name: patientName,
        species,
        breed,
        sex: 'Erkek',
        neutered: true,
        age: Number.isFinite(parsedAge) ? parsedAge : 0,
        weight: 0,
        ownerName: 'Sahip',
        ownerPhone: '',
      }
      const clinical: ClinicalInfo = {
        complaint: history.split('\n')[0] || 'DICOM inceleme',
        onset: 'Akut',
        course: 'Progresif',
        history,
        medications: '',
      }
      const neuro = EMPTY_NEURO
      const stamp = nowStamp()
      const loc = localize(neuro, clinical)
      let built = buildAssessment(loc?.template ?? 'ivdd', patient, neuro, stamp)
      if (result.report && result.findings) {
        built = {
          ...built,
          ai: pipelineToAssessment(result.findings, result.report),
          draft: draftToSections(result.report),
        }
      }

      const id = result.job.case_id
      const no = id.replace(/^case-/, 'VM-').toUpperCase()
      const priority: Priority = 'Normal'
      const instanceCount =
        uploadSnap?.study?.series.reduce((n, s) => n + s.instances.length, 0) ?? files.length

      const newCase: VetCase = {
        id,
        no,
        patient,
        clinical,
        neuro,
        documents: [
          {
            ...makeDocument(
              `${id}-dicom`,
              `DICOM study ${uploadSnap?.study?.study_instance_uid ?? 'pending'}`,
              'MR Raporu',
              patient,
              clinical,
              built.imaging,
            ),
            size: `${instanceCount} instance`,
            rawText: 'DICOM metadata ingest only. Pixel data was not analyzed.',
            extracted: [
              {
                field: 'StudyInstanceUID',
                value: uploadSnap?.study?.study_instance_uid ?? '—',
                source: 'DICOM',
              },
              {
                field: 'Classification',
                value: uploadSnap?.classification
                  ? `${uploadSnap.classification.suggested_modality} / ${uploadSnap.classification.suggested_anatomical_region}`
                  : '—',
                source: 'metadata classifier',
              },
            ],
          },
        ],
        status: caseStatusFromBackendOutcome(result.outcome),
        module: 'Nöroloji',
        priority,
        createdAt: today(),
        clinic: CLINIC,
        vetName: user?.name ?? 'Dr. Elif Kaya',
        ai: built.ai,
        aiDraft: built.draft,
        report: { ...built.draft },
        corrections: [],
        timeline: [
          { date: stamp, label: 'Giriş sonrası DICOM metadata yüklendi', by: user?.name ?? 'vet' },
          {
            date: stamp,
            label: `Analiz tamamlandı: ${result.outcome} · phase=${phaseFromPipelineOutcome(result.outcome)} (${result.job.case_id})`,
            by: 'backend',
          },
        ],
        processingStartedAt: Date.now(),
        processingMs: PIPELINE_MS,
        backendCaseId: result.job.case_id,
        backendJobId: result.job.job_id,
        backendOutcome: result.outcome,
        backendFindings: result.findings ?? undefined,
        backendDraft: result.report ?? undefined,
        fromBackend: true,
        dicomDemoKind: pendingDemo ?? undefined,
      }

      addCase(newCase)
      // Persist uploaded bytes for case-detail viewer (prefer real study over synthetic fixtures).
      if (files.length > 0) {
        void cacheCaseDicomFiles(id, files.slice(0, MAX_VIEWER_FRAMES))
      }
      // Keep a short Processing page animation; persisted status already matches backend outcome.
      if (result.outcome !== 'failed') {
        updateCase(id, { status: 'ai_analizi' })
        setTimeout(() => {
          updateCase(id, { status: caseStatusFromBackendOutcome(result.outcome) })
        }, AI_PHASE_START)
      }
      pushToast({
        tone: result.outcome === 'failed' ? 'error' : 'success',
        title: 'DICOM vaka oluşturuldu',
        body: `${patientName} · ${result.outcome}`,
      })

      nav(`/vakalar/${id}/isleme`)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (err instanceof PollingCancelledError) {
        pushToast({
          tone: 'info',
          title: 'Analiz durduruldu',
          body: 'İzleme ve backend iptal isteği uygulandı.',
        })
        return
      }
      const message =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'İşlem başarısız'
      pushToast({ tone: 'error', title: 'Analiz başlatılamadı', body: message })
    } finally {
      submitLockRef.current = false
      if (abortRef.current) abortRef.current = null
      setBusy(false)
      setUploading(false)
      setUploadProgress(null)
    }
  }

  const clinicalPanel = (
    <div className="space-y-5">
      <section className="space-y-3">
        <label className="block text-xs font-semibold text-slate-600">
          Hasta adı *
          <input
            className="input mt-1.5"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            autoComplete="off"
            placeholder="ör. Pax"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-semibold text-slate-600">
            Tür
            <select
              className="input mt-1.5"
              value={species}
              onChange={(e) => setSpecies(e.target.value as Patient['species'])}
            >
              <option value="Köpek">Köpek</option>
              <option value="Kedi">Kedi</option>
              <option value="Diğer">Diğer</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Irk
            <input className="input mt-1.5" value={breed} onChange={(e) => setBreed(e.target.value)} placeholder="Irk" />
          </label>
        </div>
        <label className="block text-xs font-semibold text-slate-600">
          Yaş (yıl)
          <input
            className="input mt-1.5"
            type="number"
            min={0}
            step={0.1}
            placeholder="—"
            value={ageYears}
            onChange={(e) => setAgeYears(e.target.value)}
          />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Klinik notlar
          <textarea
            className="input mt-1.5"
            rows={hasStudy ? 4 : 3}
            placeholder="Anamnez, şikayet, klinik gözlemler…"
            value={history}
            onChange={(e) => setHistory(e.target.value)}
          />
        </label>
      </section>

      {hasStudy && (
        <section className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">İnceleme bilgileri</h3>
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
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Onay</h3>
        <label className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-3 text-xs leading-relaxed text-navy-800 transition hover:border-teal-200 hover:bg-teal-50/30">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
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
            {preview.classification.suggested_modality} / {preview.classification.suggested_anatomical_region}
            <span className="ml-1 text-xs font-normal text-slate-600">
              · {preview.classification.confidence}
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
            <input type="checkbox" checked={acceptSuggestion} onChange={(e) => setAcceptSuggestion(e.target.checked)} />
            Öneriyi kabul et
          </label>
          {!acceptSuggestion && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select className="input" value={overrideModality} onChange={(e) => setOverrideModality(e.target.value as BackendModality)}>
                <option value="MR">MR</option>
                <option value="CT">CT</option>
                <option value="XR">XR</option>
              </select>
              <select className="input" value={overrideRegion} onChange={(e) => setOverrideRegion(e.target.value as BackendAnatomicalRegion)}>
                <option value="BRAIN">BRAIN</option>
                <option value="CERVICAL">CERVICAL</option>
                <option value="THORAX">THORAX</option>
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
              {preview?.blocked ? 'Engellendi' : preview ? 'Hazır' : files.length ? 'Bekliyor' : 'Dosya yok'}
            </span>
          </li>
          <li className="flex items-center justify-between gap-2 py-2">
            <span className="text-slate-500">Seçili analiz</span>
            <span className="max-w-[55%] truncate text-right font-semibold">
              {preview?.classification
                ? `${preview.classification.suggested_modality} / ${preview.classification.suggested_anatomical_region}`
                : studySummary.modality ?? 'Metadata sınıflandırma'}
            </span>
          </li>
          <li className="flex items-center justify-between gap-2 py-2 last:pb-0">
            <span className="text-slate-500">Dosya</span>
            <span className="font-semibold">{files.length}</span>
          </li>
        </ul>
        {preview?.blocked && (
          <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-xs text-rose-800 ring-1 ring-inset ring-rose-200">
            {preview.block_reason ?? 'Yükleme engellendi'}
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
          <Button variant="secondary" disabled={busy || files.length === 0} onClick={() => void runPreview(pendingDemo ?? undefined)}>
            Metadata önizle
          </Button>
        )}
        <Button
          size="lg"
          className="w-full shadow-md shadow-teal-700/15"
          disabled={busy || validating || Boolean(preview?.blocked) || !hasStudy || !consent}
          onClick={() => void submit()}
          icon={<Sparkles className="h-4 w-4" />}
        >
          {busy ? 'İşleniyor…' : 'Analize gönder'}
        </Button>
        {(busy || uploading) && (
          <Button variant="secondary" className="w-full" onClick={cancelInFlight}>
            Analizi / yüklemeyi durdur
          </Button>
        )}
      </div>
    </div>
  )

  const uploadZone = (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        void addFromDrop(e.dataTransfer)
      }}
      className={`flex min-h-[280px] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
        drag
          ? 'border-teal-600 bg-teal-50 shadow-inner'
          : 'border-teal-200/80 bg-gradient-to-b from-teal-50/70 via-white to-slate-50/40'
      }`}
    >
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-2xl shadow-sm ring-1 ring-inset ${
          drag ? 'bg-teal-100 text-teal-700 ring-teal-200' : 'bg-white text-teal-600 ring-teal-100'
        }`}
      >
        <UploadCloud className="h-8 w-8" strokeWidth={1.75} />
      </div>
      <p className="mt-5 text-lg font-semibold tracking-tight text-navy-900">
        {drag ? 'Dosyaları bırakın' : 'DICOM dosya veya klasör sürükleyin'}
      </p>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-500">
        .dcm / DICOM Part-10 · en fazla {MAX_DICOM_FILES} dosya · dosya başına{' '}
        {Math.round(MAX_DICOM_FILE_BYTES / (1024 * 1024))} MiB · toplam{' '}
        {Math.round(MAX_DICOM_TOTAL_BYTES / (1024 * 1024))} MiB
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button
          type="button"
          icon={<FileText className="h-4 w-4" />}
          onClick={(e) => {
            e.stopPropagation()
            fileInputRef.current?.click()
          }}
        >
          Dosya seç
        </Button>
        <Button
          type="button"
          variant="secondary"
          icon={<FolderOpen className="h-4 w-4" />}
          onClick={(e) => {
            e.stopPropagation()
            folderInputRef.current?.click()
          }}
        >
          Klasör seç
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".dcm,.dicom,application/dicom,*/*"
        className="hidden"
        onChange={(e) => {
          addFromFileList(e.target.files, 'Dosya seçimi')
          e.target.value = ''
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        className="hidden"
        multiple
        onChange={(e) => {
          addFromFileList(e.target.files, 'Klasör seçimi')
          e.target.value = ''
        }}
        {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
      />
      {(busy || uploadProgress || validating) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <p className="flex items-center gap-2 text-xs font-medium text-teal-700">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-teal-600" />
            {uploadProgress ?? 'İşleniyor…'}
          </p>
          <button
            type="button"
            onClick={cancelInFlight}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-rose-200 hover:text-rose-700"
          >
            <XCircle className="h-3.5 w-3.5" />
            Analizi durdur
          </button>
        </div>
      )}
      {files.length > 0 && (
        <p className="mt-4 flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 ring-1 ring-inset ring-teal-200">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {files.length} dosya seçili
          {files.length > MAX_VIEWER_FRAMES ? ` · görüntüleyici ilk ${MAX_VIEWER_FRAMES} kare` : ''}
        </p>
      )}
      {lastRejectSummary && <p className="mt-3 max-w-lg text-[11px] text-amber-800">{lastRejectSummary}</p>}
    </div>
  )

  const demoSection = (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-navy-900">Örnek veri setleri</h2>
          <p className="mt-0.5 text-sm text-slate-500">Hızlı deneme için hazır DICOM setleri</p>
        </div>
        {pendingDemo && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void runPreview(pendingDemo)}>
            Metadata önizle
          </Button>
        )}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {DEMO_SETS.map((d) => {
          const selected = pendingDemo === d.kind
          return (
            <div
              key={d.kind}
              className={`overflow-hidden rounded-xl border bg-white transition ${
                selected ? 'border-teal-400 shadow-md shadow-teal-700/10 ring-1 ring-teal-200' : 'border-slate-200 hover:border-teal-200 hover:shadow-sm'
              }`}
            >
              <div className={`flex h-20 items-center justify-center bg-gradient-to-br ${d.tone}`}>
                <d.Icon className="h-9 w-9 opacity-80" strokeWidth={1.5} />
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold text-navy-900">{d.label}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{d.hint}</p>
                <Button
                  size="sm"
                  variant={selected ? 'primary' : 'secondary'}
                  className="mt-3 w-full"
                  disabled={busy}
                  onClick={() => void loadDemoForViewing(d.kind)}
                >
                  {selected ? 'Seçildi' : 'Kullan'}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <>
      <PageHeader
        title="DICOM Yükleme"
        crumbs={[{ label: 'Vakalar', to: '/vakalar' }, { label: 'DICOM Yükle' }]}
        actions={
          <div className="flex items-center gap-2">
            {workspacePhase !== 'EMPTY' && (
              <span className="hidden rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-800 ring-1 ring-inset ring-teal-200 sm:inline">
                {PHASE_LABELS[workspacePhase]}
              </span>
            )}
            {hasStudy ? (
              <Button
                variant="ghost"
                size="sm"
                className="lg:hidden"
                icon={clinicalOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                onClick={() => setClinicalOpen((v) => !v)}
              >
                {clinicalOpen ? 'Paneli gizle' : 'Klinik panel'}
              </Button>
            ) : null}
          </div>
        }
      />

      {/* STATE A — before upload */}
      {!hasStudy && (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.9fr)]">
          <div className="space-y-5">
            <Card className="overflow-hidden p-5 sm:p-7">
              {uploadZone}
            </Card>
            {demoSection}
          </div>
          <Card className="overflow-hidden lg:sticky lg:top-4">
            <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4 sm:px-6">
              <h2 className="text-base font-semibold text-navy-900">Hasta ve sipariş</h2>
              <p className="mt-0.5 text-sm text-slate-500">Analiz öncesi klinik bilgiler</p>
            </div>
            <div className="p-5 sm:p-6">{clinicalPanel}</div>
          </Card>
        </div>
      )}

      {/* STATE B — imaging workspace */}
      {hasStudy && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,30%)] xl:grid-cols-[minmax(0,1fr)_minmax(300px,28%)]">
          <div className="min-w-0 space-y-3">
            {(framesLoading || frames.length > 0) && (
              <DicomViewer
                frames={frames}
                loading={framesLoading}
                onActiveFrameChange={onActiveFrameChange}
                focusSopUid={focusSopUid}
                focusRequestId={focusRequestId}
              />
            )}
            {!framesLoading && frames.length === 0 && (
              <Card className="p-5">
                <p className="text-sm text-slate-600">
                  Dosyalar seçildi; önizleme hazırlanıyor veya piksel verisi yok / desteklenmeyen transfer
                  syntax. Metadata önizleme ile devam edebilirsiniz — tanısal piksel çıkarımı yapılmaz.
                </p>
                {preview?.study && (
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div>
                      <dt className="text-slate-400">Study UID</dt>
                      <dd className="truncate font-mono text-[11px]" title={preview.study.study_instance_uid}>
                        {preview.study.study_instance_uid}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-400">Instances</dt>
                      <dd>
                        {preview.study.series.reduce((n, s) => n + s.instances.length, 0)}
                      </dd>
                    </div>
                  </dl>
                )}
                <div className="mt-4">{uploadZone}</div>
              </Card>
            )}
            <SeriesExplorer
              files={files}
              frames={frames}
              study={preview?.study}
              activeSeriesKey={activeSeriesKey}
              activeSopUid={activeSopUid}
              onRemoveFile={(file) => {
                setPreview(null)
                setFiles((fs) => fs.filter((x) => x !== file))
              }}
              onClearAll={clearAll}
              onSelectInstance={(ref) => {
                setActiveSeriesKey(ref.seriesKey)
                if (ref.sopInstanceUid) {
                  setActiveSopUid(ref.sopInstanceUid)
                  setFocusSopUid(ref.sopInstanceUid)
                  setFocusRequestId((n) => n + 1)
                }
              }}
            />
            <details className="rounded-xl border border-[#E3EAF0] bg-white">
              <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-slate-600 hover:text-[#172B45]">
                Daha fazla DICOM ekle
              </summary>
              <div className="space-y-3 border-t border-[#E3EAF0] px-4 py-3">
                {uploadZone}
                {demoSection}
              </div>
            </details>
          </div>

          <aside
            className={`${
              clinicalOpen ? 'block' : 'hidden'
            } lg:block lg:sticky lg:top-4 lg:self-start`}
          >
            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4">
                <h2 className="text-base font-semibold text-navy-900">Hasta ve sipariş</h2>
                <p className="mt-0.5 text-sm text-slate-500">Klinik bilgiler ve analiz özeti</p>
              </div>
              <div className="p-5">{clinicalPanel}</div>
            </Card>
          </aside>
        </div>
      )}
    </>
  )
}
