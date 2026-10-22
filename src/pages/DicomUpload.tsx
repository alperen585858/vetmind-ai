import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, FolderOpen, Sparkles, Trash2, UploadCloud } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { AIDisclaimer } from '../components/AIDisclaimer'
import { DicomViewer } from '../components/DicomViewer'
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
  displayPath,
} from '../lib/dicomFolder'
import { caseStatusFromBackendOutcome } from '../lib/caseStatusMap'
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

export default function DicomUpload() {
  const { addCase, pushToast, updateCase, user } = useApp()
  const nav = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const [patientName, setPatientName] = useState('Pax')
  const [species, setSpecies] = useState<Patient['species']>('Köpek')
  const [breed, setBreed] = useState('Golden Retriever')
  const [history, setHistory] = useState('Sentetik demo. DICOM metadata ingest; piksel tanısı yok.')
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
          body: `${truncated} dosya atlandı (backend limiti).`,
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
    }
  }

  const loadDemoForViewing = async (kind: DicomDemoKind) => {
    setBusy(true)
    try {
      const demoFiles = await fetchDemoDicomFiles(kind)
      setPendingDemo(kind)
      setPreview(null)
      setFiles(demoFiles)
      pushToast({
        tone: 'info',
        title: 'Demo DICOM yüklendi',
        body: 'Görüntüleyici solda açılır. Metadata için “Metadata önizle” veya doğrudan analiz.',
      })
    } catch (err) {
      const message = err instanceof BackendUnavailableError ? err.message : err instanceof Error ? err.message : 'Demo indirilemedi'
      pushToast({ tone: 'error', title: 'Demo DICOM alınamadı', body: message })
    } finally {
      setBusy(false)
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
      pushToast({ tone: 'warning', title: 'Dosya yok', body: 'Önce .dcm sürükleyin veya sunucu demosunu kullanın.' })
      return
    }
    setBusy(true)
    try {
      const upload = kind
        ? await uploadDicomDemo({ kind, patientName, species, breed, clinicalHistory: history })
        : await uploadDicomFiles({ files, patientName, species, breed, clinicalHistory: history })
      setPreview(upload)
      setPendingDemo(kind ?? null)
      applyDefaults(upload)
      if (upload.blocked) {
        pushToast({ tone: 'error', title: 'Ingest engellendi', body: upload.block_reason ?? 'Doğrulama hatası' })
      } else {
        pushToast({ tone: 'success', title: 'Metadata hazır', body: 'Sınıflandırmayı onaylayıp mock analizi başlatabilirsiniz.' })
      }
    } catch (err) {
      const message = err instanceof BackendUnavailableError ? err.message : err instanceof Error ? err.message : 'Yükleme başarısız'
      pushToast({ tone: 'error', title: 'DICOM yüklenemedi', body: message })
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!patientName.trim()) {
      pushToast({ tone: 'warning', title: 'Hasta adı gerekli' })
      return
    }
    setBusy(true)
    try {
      let ingestId = preview && !preview.blocked ? preview.ingest_id : undefined
      let uploadSnap = preview
      if (!ingestId) {
        if (files.length === 0 && !pendingDemo) {
          setBusy(false)
          pushToast({ tone: 'warning', title: 'DICOM gerekli', body: 'Dosya sürükleyin veya demo butonunu kullanın.' })
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
          pushToast({ tone: 'error', title: 'Ingest engellendi', body: upload.block_reason ?? 'Doğrulama hatası' })
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

      const patient: Patient = {
        name: patientName,
        species,
        breed,
        sex: 'Erkek',
        neutered: true,
        age: 0,
        weight: 0,
        ownerName: 'Demo Sahip',
        ownerPhone: '',
      }
      const clinical: ClinicalInfo = {
        complaint: history.split('\n')[0] || 'DICOM metadata demo',
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
            ...makeDocument(`${id}-dicom`, `DICOM study ${uploadSnap?.study?.study_instance_uid ?? 'pending'}`, 'MR Raporu', patient, clinical, built.imaging),
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
          { date: stamp, label: `FastAPI mock analiz: ${result.outcome} (${result.job.case_id})`, by: 'backend' },
        ],
        processingStartedAt: Date.now(),
        backendCaseId: result.job.case_id,
        backendJobId: result.job.job_id,
        backendOutcome: result.outcome,
        backendFindings: result.findings ?? undefined,
        backendDraft: result.report ?? undefined,
        fromBackend: true,
      }

      addCase(newCase)
      setTimeout(() => updateCase(id, { status: 'ai_analizi' }), AI_PHASE_START)
      setTimeout(() => {
        const done = nowStamp()
        const nextStatus = caseStatusFromBackendOutcome(result.outcome)
        updateCase(id, (c) => ({
          status: nextStatus,
          processingMs: PIPELINE_MS,
          timeline: [
            ...c.timeline,
            { date: done, label: 'Senkron mock analiz tamamlandı — uzman incelemesine bırakıldı', by: 'mock-pipeline' },
          ],
        }))
        pushToast({ tone: result.outcome === 'failed' ? 'error' : 'success', title: 'DICOM vaka oluşturuldu', body: `${patientName} · ${result.outcome}` })
      }, PIPELINE_MS)

      nav(`/vakalar/${id}/isleme`)
    } catch (err) {
      const message = err instanceof BackendUnavailableError ? err.message : err instanceof Error ? err.message : 'İşlem başarısız'
      pushToast({ tone: 'error', title: 'Analiz başlatılamadı', body: message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="DICOM Yükleme"
        subtitle="Sürükle-bırak · görüntüleme · metadata sınıflandırma · mock analiz"
        breadcrumb="Vakalar / DICOM Yükle"
      />
      <AIDisclaimer className="mb-4" />

      <div className="grid gap-6 xl:grid-cols-5">
        <Card className="p-6 xl:col-span-3">
          <h2 className="text-lg font-semibold text-navy-900">Dosya veya klasör bırakın</h2>
          <p className="mt-1 text-sm text-slate-500">
            Tek tek .dcm veya study klasörü (alt klasörler dahil). Görüntüleyici ilk {MAX_VIEWER_FRAMES} kareyi gösterir;
            yükleme en fazla {MAX_DICOM_FILES} dosya. AI pipeline metadata ile çalışır.
          </p>

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
            className={`mt-5 flex min-h-[200px] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
              drag ? 'border-teal-500 bg-teal-50 scale-[1.01]' : 'border-slate-300 bg-gradient-to-b from-slate-50 to-white'
            }`}
          >
            <UploadCloud className={`h-12 w-12 ${drag ? 'text-teal-600' : 'text-teal-600/80'}`} />
            <p className="mt-4 text-base font-semibold text-navy-900">DICOM dosyalarını veya klasörü sürükleyip bırakın</p>
            <p className="mt-1 text-sm text-slate-500">.dcm / uzantısız DICOM · alt klasörler taranır</p>
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
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy || files.length === 0} onClick={() => void runPreview()}>
              Metadata önizle ({files.length})
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void loadDemoForViewing('brain_mri')}>
              Demo · Brain MRI
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void loadDemoForViewing('cervical_mri')}>
              Demo · Cervical MRI
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void loadDemoForViewing('brain_ct')}>
              Demo · Brain CT
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void loadDemoForViewing('thorax_xr')}>
              Demo · Thorax XR
            </Button>
            {pendingDemo && (
              <Button variant="secondary" disabled={busy} onClick={() => void runPreview(pendingDemo)}>
                Demo metadata ingest
              </Button>
            )}
            {files.length > 0 && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setFiles([])
                  setFrames([])
                  setPreview(null)
                  setPendingDemo(null)
                }}
              >
                Listeyi temizle
              </Button>
            )}
          </div>

          {(framesLoading || frames.length > 0) && (
            <div className="mt-5">
              <DicomViewer frames={frames} loading={framesLoading} />
              {files.length > MAX_VIEWER_FRAMES && (
                <p className="mt-2 text-xs text-slate-500">
                  Görüntüleyici {MAX_VIEWER_FRAMES}/{files.length} kare gösteriyor; metadata ingest tüm seçili dosyaları kullanır.
                </p>
              )}
            </div>
          )}

          {files.length > 0 && (
            <ul className="mt-5 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {files.map((f) => (
                <li key={`${displayPath(f)}-${f.lastModified}-${f.size}`} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="rounded-lg bg-teal-50 p-2 text-teal-700">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-navy-900" title={displayPath(f)}>
                        {displayPath(f)}
                      </p>
                      <p className="text-xs text-slate-500">{Math.max(1, Math.round(f.size / 1024))} KB</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    onClick={() => {
                      setPreview(null)
                      setFiles((fs) => fs.filter((x) => x !== f))
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="space-y-4 p-6 xl:col-span-2">
          <h2 className="text-lg font-semibold text-navy-900">Hasta ve onay</h2>
          <label className="block text-xs font-medium text-slate-600">
            Hasta adı *
            <input className="input mt-1" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-slate-600">
              Tür
              <select className="input mt-1" value={species} onChange={(e) => setSpecies(e.target.value as Patient['species'])}>
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
            Klinik not
            <textarea className="input mt-1" rows={3} value={history} onChange={(e) => setHistory(e.target.value)} />
          </label>

          {preview?.classification && !preview.blocked && (
            <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 text-sm">
              <p className="font-semibold text-navy-900">Sınıflandırma önerisi</p>
              <p className="mt-1 text-navy-800">
                {preview.classification.suggested_modality} / {preview.classification.suggested_anatomical_region} · güven:{' '}
                {preview.classification.confidence}
              </p>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={acceptSuggestion} onChange={(e) => setAcceptSuggestion(e.target.checked)} />
                Öneriyi kabul et
              </label>
              {!acceptSuggestion && (
                <div className="mt-3 grid grid-cols-2 gap-2">
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
              <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-slate-600">
                {preview.classification.rationale.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-navy-100 bg-navy-50/70 p-4 text-xs text-navy-800">
            <p className="font-semibold text-navy-900">AI girdi paketi (ImagingModelInput)</p>
            <p className="mt-1 leading-relaxed">
              Onay + analiz sırasında study/series/instance UID&apos;leri versiyonlu bir JSON paketine dönüştürülür.
              Mock (ve ileride gerçek) Vision modelleri ham klasör yerine bu sözleşmeyi okur. Piksel tanısı şu an kapalı
              (<code className="text-teal-700">pixel_analysis_authorized=false</code>).
            </p>
            {preview?.study && (
              <p className="mt-2 font-mono text-[11px] text-slate-600">
                study≈{preview.study.series.length} seri ·{' '}
                {preview.study.series.reduce((n, s) => n + s.instances.length, 0)} instance
              </p>
            )}
          </div>

          {preview?.blocked && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-inset ring-rose-200">
              {preview.block_reason ?? 'Ingest engellendi'}
            </p>
          )}

          <Button
            size="lg"
            className="w-full"
            disabled={busy || Boolean(preview?.blocked)}
            onClick={() => void submit()}
            icon={<Sparkles className="h-4 w-4" />}
          >
            {busy ? 'İşleniyor…' : 'Onayla ve Mock Analiz Çalıştır'}
          </Button>
          <p className="text-[11px] text-slate-500">
            Backend FastAPI async job + poll ile çalışır (thread/RQ). Çıktı MOCK&apos;tur; uzman veteriner radyolog onayı zorunludur.
          </p>
        </Card>
      </div>
    </>
  )
}
