import { useCallback, useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  FileText,
  FolderOpen,
  Info,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  UploadCloud,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { AIDisclaimer } from '../components/AIDisclaimer'
import { DicomViewer } from '../components/DicomViewer'
import { SeriesExplorer, buildSeriesItems } from '../components/SeriesExplorer'
import { CLINIC } from '../data/mock'
import { buildAssessment, makeDocument } from '../data/templates'
import { localize } from '../lib/localization'
import { nowStamp, today } from '../lib/format'
import { AI_PHASE_START, PIPELINE_MS } from '../lib/pipeline'
import {
  BackendUnavailableError,
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
  MAX_VIEWER_FRAMES,
  capFiles,
  collectFilesFromDataTransfer,
  collectFilesFromFileList,
} from '../lib/dicomFolder'
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

const DEMO_SETS: { kind: DicomDemoKind; label: string; hint: string }[] = [
  { kind: 'brain_mri', label: 'Brain MRI', hint: 'MR · kranial' },
  { kind: 'cervical_mri', label: 'Cervical MRI', hint: 'MR · servikal' },
  { kind: 'brain_ct', label: 'Brain CT', hint: 'BT · kranial' },
  { kind: 'thorax_xr', label: 'Thorax XR', hint: 'Röntgen · toraks' },
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
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [activeSeriesKey, setActiveSeriesKey] = useState<string | null>(null)
  const [clinicalOpen, setClinicalOpen] = useState(true)

  const hasStudy = files.length > 0
  const viewerFiles = useMemo(() => files.slice(0, MAX_VIEWER_FRAMES), [files])

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

  const mergeIncoming = (incoming: File[], sourceLabel: string) => {
    const filtered = incoming
    if (!filtered.length) {
      pushToast({
        tone: 'warning',
        title: 'DICOM bulunamadı',
        body: `${sourceLabel}: uygun .dcm / DICOM dosyası yok.`,
      })
      return
    }
    setPreview(null)
    setPendingDemo(null)
    setFiles((prev) => {
      const merged = [...prev, ...filtered]
      const { files: capped, truncated } = capFiles(merged, MAX_DICOM_FILES)
      if (truncated > 0) {
        pushToast({
          tone: 'warning',
          title: `En fazla ${MAX_DICOM_FILES} dosya`,
          body: `${truncated} dosya atlandı (yükleme limiti).`,
        })
      } else {
        pushToast({
          tone: 'success',
          title: `${filtered.length} DICOM eklendi`,
          body: sourceLabel,
        })
      }
      return capped
    })
  }

  const addFromFileList = (list: FileList | null, sourceLabel: string) => {
    mergeIncoming(collectFilesFromFileList(list), sourceLabel)
  }

  const addFromDrop = async (dt: DataTransfer) => {
    setBusy(true)
    setUploadProgress('Dosyalar okunuyor…')
    try {
      const collected = await collectFilesFromDataTransfer(dt)
      mergeIncoming(collected, 'Klasör / sürükle-bırak')
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
    setUploadProgress('Demo veri seti yükleniyor…')
    try {
      const demoFiles = await fetchDemoDicomFiles(kind)
      setPendingDemo(kind)
      setPreview(null)
      setFiles(demoFiles)
      pushToast({
        tone: 'info',
        title: 'Demo DICOM yüklendi',
        body: 'Görüntüleyici açıldı. İsterseniz metadata önizleyebilir veya analize devam edebilirsiniz.',
      })
    } catch (err) {
      const message =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Demo indirilemedi'
      pushToast({ tone: 'error', title: 'Demo DICOM alınamadı', body: message })
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
    if (!patientName.trim()) {
      pushToast({ tone: 'warning', title: 'Hasta adı gerekli', body: 'Yüklemeden önce hasta adını girin.' })
      return
    }
    if (!kind && files.length === 0) {
      pushToast({
        tone: 'warning',
        title: 'Dosya yok',
        body: 'Önce .dcm sürükleyin veya demo veri setini kullanın.',
      })
      return
    }
    setBusy(true)
    setUploadProgress('Metadata doğrulanıyor…')
    try {
      const upload = kind
        ? await uploadDicomDemo({ kind, patientName, species, breed, clinicalHistory: history })
        : await uploadDicomFiles({ files, patientName, species, breed, clinicalHistory: history })
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
      const message =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Yükleme başarısız'
      pushToast({ tone: 'error', title: 'DICOM yüklenemedi', body: message })
    } finally {
      setBusy(false)
      setUploadProgress(null)
    }
  }

  const clearAll = () => {
    setFiles([])
    setFrames([])
    setPreview(null)
    setPendingDemo(null)
    setActiveSeriesKey(null)
    setUploadProgress(null)
  }

  const submit = async () => {
    if (!patientName.trim()) {
      pushToast({ tone: 'warning', title: 'Hasta adı gerekli' })
      return
    }
    if (!consent) {
      pushToast({
        tone: 'warning',
        title: 'Onay gerekli',
        body: 'Analize devam etmeden önce klinik kullanım onayını işaretleyin.',
      })
      return
    }
    setBusy(true)
    setUploadProgress('Analiz hazırlanıyor…')
    try {
      let ingestId = preview && !preview.blocked ? preview.ingest_id : undefined
      let uploadSnap = preview
      if (!ingestId) {
        if (files.length === 0 && !pendingDemo) {
          setBusy(false)
          setUploadProgress(null)
          pushToast({
            tone: 'warning',
            title: 'DICOM gerekli',
            body: 'Dosya sürükleyin veya demo veri setini kullanın.',
          })
          return
        }
        const upload = pendingDemo
          ? await uploadDicomDemo({ kind: pendingDemo, patientName, species, breed, clinicalHistory: history })
          : await uploadDicomFiles({ files, patientName, species, breed, clinicalHistory: history })
        uploadSnap = upload
        setPreview(upload)
        applyDefaults(upload)
        if (upload.blocked) {
          setBusy(false)
          setUploadProgress(null)
          pushToast({ tone: 'error', title: 'Yükleme engellendi', body: upload.block_reason ?? 'Doğrulama hatası' })
          return
        }
        ingestId = upload.ingest_id
      }

      const result = await confirmDicomAndAnalyze({
        ingestId,
        acceptSuggestion,
        modality: acceptSuggestion ? undefined : overrideModality,
        anatomicalRegion: acceptSuggestion ? undefined : overrideRegion,
        patientName,
        clinicalHistory: history,
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
        ownerName: 'Demo Sahip',
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
        status: 'isleniyor',
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
            label: `Analiz başlatıldı: ${result.outcome} (${result.job.case_id})`,
            by: 'backend',
          },
        ],
        processingStartedAt: Date.now(),
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
      setTimeout(() => updateCase(id, { status: 'ai_analizi' }), AI_PHASE_START)
      setTimeout(() => {
        const done = nowStamp()
        const nextStatus = caseStatusFromBackendOutcome(result.outcome)
        updateCase(id, (c) => ({
          status: nextStatus,
          processingMs: PIPELINE_MS,
          timeline: [
            ...c.timeline,
            {
              date: done,
              label: 'Ön değerlendirme tamamlandı — uzman incelemesine bırakıldı',
              by: 'pipeline',
            },
          ],
        }))
        pushToast({
          tone: result.outcome === 'failed' ? 'error' : 'success',
          title: 'DICOM vaka oluşturuldu',
          body: `${patientName} · ${result.outcome}`,
        })
      }, PIPELINE_MS)

      nav(`/vakalar/${id}/isleme`)
    } catch (err) {
      const message =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'İşlem başarısız'
      pushToast({ tone: 'error', title: 'Analiz başlatılamadı', body: message })
    } finally {
      setBusy(false)
      setUploadProgress(null)
    }
  }

  const clinicalPanel = (
    <div className="space-y-4">
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hasta Bilgileri</h3>
        <div className="mt-2 space-y-3">
          <label className="block text-xs font-medium text-slate-600">
            Hasta adı *
            <input
              className="input mt-1"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-slate-600">
              Tür
              <select
                className="input mt-1"
                value={species}
                onChange={(e) => setSpecies(e.target.value as Patient['species'])}
              >
                <option value="Köpek">Köpek</option>
                <option value="Kedi">Kedi</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Irk
              <input className="input mt-1" value={breed} onChange={(e) => setBreed(e.target.value)} />
            </label>
          </div>
          <label className="block text-xs font-medium text-slate-600">
            Yaş (opsiyonel)
            <input
              className="input mt-1"
              type="number"
              min={0}
              step={0.1}
              placeholder="—"
              value={ageYears}
              onChange={(e) => setAgeYears(e.target.value)}
            />
          </label>
        </div>
      </section>

      {hasStudy && (
        <section className="rounded-xl border border-[#E3EAF0] bg-[#F4F7FA] px-3 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            İnceleme Bilgileri
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="text-slate-500">Modalite</dt>
              <dd className="font-medium text-[#172B45]">{studySummary.modality ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Görüntü</dt>
              <dd className="font-medium text-[#172B45]">{studySummary.imageCount}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Seri</dt>
              <dd className="font-medium text-[#172B45]">{studySummary.seriesCount || '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-slate-500">Study</dt>
              <dd className="truncate font-medium text-[#172B45]" title={studySummary.studyDescription ?? undefined}>
                {studySummary.studyDescription ?? '—'}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Klinik Notlar</h3>
        <textarea
          className="input mt-2"
          rows={hasStudy ? 4 : 3}
          placeholder="Anamnez, şikayet, klinik gözlemler…"
          value={history}
          onChange={(e) => setHistory(e.target.value)}
        />
      </section>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Onay</h3>
        <label className="mt-2 flex items-start gap-2 rounded-lg border border-[#E3EAF0] bg-white px-3 py-2.5 text-xs text-[#172B45]">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            DICOM verisinin klinik ön değerlendirme amacıyla işlenmesine ve sonucun uzman veteriner hekim
            onayı gerektiren bir AI taslağı olduğuna dair bilgilendirmeyi kabul ediyorum.
          </span>
        </label>
      </section>

      {preview?.classification && !preview.blocked && (
        <section className="rounded-xl border border-teal-200 bg-teal-50/60 p-3 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-800">Sınıflandırma</p>
          <p className="mt-1 text-sm font-medium text-navy-900">
            {preview.classification.suggested_modality} / {preview.classification.suggested_anatomical_region}
            <span className="ml-1 text-xs font-normal text-slate-600">
              · {preview.classification.confidence}
            </span>
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={acceptSuggestion}
              onChange={(e) => setAcceptSuggestion(e.target.checked)}
            />
            Öneriyi kabul et
          </label>
          {!acceptSuggestion && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select
                className="input"
                value={overrideModality}
                onChange={(e) => setOverrideModality(e.target.value as BackendModality)}
              >
                <option value="MR">MR</option>
                <option value="CT">CT</option>
                <option value="XR">XR</option>
              </select>
              <select
                className="input"
                value={overrideRegion}
                onChange={(e) => setOverrideRegion(e.target.value as BackendAnatomicalRegion)}
              >
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

      <section className="rounded-xl border border-[#E3EAF0] bg-white px-3 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Analiz Özeti</h3>
        <ul className="mt-2 space-y-1.5 text-xs text-[#172B45]">
          <li className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Doğrulama</span>
            <span className="font-medium">
              {preview?.blocked
                ? 'Engellendi'
                : preview
                  ? 'Hazır'
                  : files.length
                    ? 'Bekliyor'
                    : 'Dosya yok'}
            </span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Seçili analiz</span>
            <span className="font-medium">
              {preview?.classification
                ? `${preview.classification.suggested_modality} / ${preview.classification.suggested_anatomical_region}`
                : studySummary.modality ?? 'Metadata sınıflandırma'}
            </span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="text-slate-500">Dosya</span>
            <span className="font-medium">{files.length}</span>
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
            {preview.issues.filter((i) => i.severity === 'warning').length} uyarı — incelemeye devam
            edilebilir.
          </p>
        )}
      </section>

      <div className="flex flex-col gap-2">
        {hasStudy && (
          <Button
            variant="secondary"
            disabled={busy || files.length === 0}
            onClick={() => void runPreview(pendingDemo ?? undefined)}
          >
            Metadata önizle
          </Button>
        )}
        <Button
          size="lg"
          className="w-full"
          disabled={busy || Boolean(preview?.blocked) || !hasStudy || !consent}
          onClick={() => void submit()}
          icon={<Sparkles className="h-4 w-4" />}
        >
          {busy ? 'İşleniyor…' : 'Analize Devam Et'}
        </Button>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Sonuç bir AI ön değerlendirmesidir; kesin tanı değildir. Uzman veteriner hekim onayı zorunludur.
          Piksel tabanlı tanı şu ortamda etkin değildir.
        </p>
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
      className={`flex min-h-[240px] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
        drag
          ? 'border-[#0D827B] bg-teal-50'
          : 'border-[#E3EAF0] bg-gradient-to-b from-[#F4F7FA] to-white'
      }`}
    >
      <div
        className={`rounded-full p-3 ${drag ? 'bg-teal-100 text-[#0D827B]' : 'bg-teal-50 text-teal-700'}`}
      >
        <UploadCloud className="h-8 w-8" />
      </div>
      <p className="mt-4 text-base font-semibold text-[#172B45]">
        {drag ? 'Dosyaları bırakın' : 'DICOM dosya veya klasör sürükleyin'}
      </p>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        .dcm / DICOM · klasör seçimi alt dizinleri tarar · en fazla {MAX_DICOM_FILES} dosya
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          variant="secondary"
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
      {(busy || uploadProgress) && (
        <p className="mt-4 flex items-center gap-2 text-xs font-medium text-[#0D827B]">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#0D827B]" />
          {uploadProgress ?? 'İşleniyor…'}
        </p>
      )}
      {files.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-600">
          <CheckCircle2 className="h-3.5 w-3.5 text-[#0D827B]" />
          {files.length} dosya seçili
          {files.length > MAX_VIEWER_FRAMES
            ? ` · görüntüleyici ilk ${MAX_VIEWER_FRAMES} kareyi gösterir`
            : ''}
        </p>
      )}
    </div>
  )

  const demoSection = (
    <div className="rounded-xl border border-[#E3EAF0] bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Demo veri setleri</p>
      <p className="mt-1 text-xs text-slate-500">Sunucudaki örnek MRI, CT ve X-ray çalışmaları</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {DEMO_SETS.map((d) => (
          <button
            key={d.kind}
            type="button"
            disabled={busy}
            onClick={() => void loadDemoForViewing(d.kind)}
            className="rounded-lg border border-[#E3EAF0] bg-[#F4F7FA] px-3 py-2.5 text-left transition hover:border-teal-300 hover:bg-teal-50/50 disabled:opacity-50"
          >
            <p className="text-sm font-medium text-[#172B45]">{d.label}</p>
            <p className="text-[11px] text-slate-500">{d.hint}</p>
          </button>
        ))}
      </div>
      {pendingDemo && (
        <Button
          className="mt-3"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => void runPreview(pendingDemo)}
        >
          Demo metadata önizle
        </Button>
      )}
    </div>
  )

  return (
    <>
      <PageHeader
        title="DICOM Yükleme"
        subtitle="Görüntüleme çalışma alanı · metadata sınıflandırma · AI ön değerlendirme"
        breadcrumb="Vakalar / DICOM Yükle"
        actions={
          hasStudy ? (
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              icon={clinicalOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              onClick={() => setClinicalOpen((v) => !v)}
            >
              {clinicalOpen ? 'Paneli gizle' : 'Klinik panel'}
            </Button>
          ) : undefined
        }
      />
      <AIDisclaimer className="mb-4" />

      {/* STATE A — before upload */}
      {!hasStudy && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
          <div className="space-y-4">
            <Card className="p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-[#172B45]">DICOM yükle</h2>
              <p className="mt-1 text-sm text-slate-500">
                Study klasörü veya tek tek DICOM dosyaları ekleyin. Desteklenen: MR, CT, XR.
              </p>
              <div className="mt-4">{uploadZone}</div>
            </Card>
            {demoSection}
          </div>
          <Card className="h-fit p-5 sm:p-6 lg:sticky lg:top-4">
            <h2 className="text-lg font-semibold text-[#172B45]">Hasta ve sipariş</h2>
            <p className="mt-1 text-sm text-slate-500">Analiz öncesi klinik bilgiler</p>
            <div className="mt-4">{clinicalPanel}</div>
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
              />
            )}
            {!framesLoading && frames.length === 0 && (
              <Card className="p-5">
                <p className="text-sm text-slate-600">
                  Dosyalar seçildi; önizleme hazırlanıyor veya piksel verisi yok. Metadata önizleme ile
                  devam edebilirsiniz.
                </p>
                <div className="mt-4">{uploadZone}</div>
              </Card>
            )}
            <SeriesExplorer
              files={files}
              frames={frames}
              study={preview?.study}
              activeSeriesKey={activeSeriesKey}
              onRemoveFile={(file) => {
                setPreview(null)
                setFiles((fs) => fs.filter((x) => x !== file))
              }}
              onClearAll={clearAll}
            />
            <details className="rounded-xl border border-[#E3EAF0] bg-white">
              <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-slate-600 hover:text-[#172B45]">
                Daha fazla DICOM ekle / demo
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
            <Card className="p-4 sm:p-5">
              <h2 className="text-base font-semibold text-[#172B45]">Klinik panel</h2>
              <div className="mt-3">{clinicalPanel}</div>
            </Card>
          </aside>
        </div>
      )}
    </>
  )
}
