import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import {
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { toastErrorBody } from '../../shared/lib/apiErrors'
import { Card } from '../../shared/ui/Card'
import { PageHeader } from '../../shared/ui/PageHeader'
import { Button } from '../../shared/ui/Button'
import { DicomViewer } from '../../shared/dicom/DicomViewer'
import { SeriesExplorer, buildSeriesItems } from './SeriesExplorer'
import { CLINIC } from '../../shared/demo/clinic'
import { nowStamp, today } from '../../shared/lib/format'
import {
  fetchDemoDicomFiles,
  uploadDicomDemo,
  uploadDicomFiles,
} from '../../shared/api'
import { buildDicomPreviews, type DicomFramePreview } from '../../shared/lib/dicomPreview'
import {
  MAX_VIEWER_FRAMES,
  collectFilesFromDataTransfer,
  collectFilesFromFileList,
  rejectReasonLabel,
  validateDicomSelectionAsync,
} from '../../shared/lib/dicomFolder'
import {
  PHASE_LABELS,
  deriveSelectionPhase,
  validatePatientForm,
} from './lib/dicomWorkflow'
import { setAnalyzeHandoff } from '../../shared/lib/analyzeHandoff'
import { estimateAnalysisDurationMs } from '../../shared/lib/analysisProgress'
import type {
  BackendAnatomicalRegion,
  BackendModality,
  ClinicalInfo,
  DicomDemoKind,
  DicomUploadResponse,
  NeuroExam,
  Patient,
  VetCase,
} from '../../shared/types'
import { UNEVALUATED_NEURO } from '../../shared/lib/neuroExam'
import { ClinicalPanel } from './upload/ClinicalPanel'
import { DemoDicomSets } from './upload/DemoDicomSets'
import { DicomDropZone } from './upload/DicomDropZone'

const EMPTY_NEURO: NeuroExam = UNEVALUATED_NEURO

const DEMO_FIXTURES_ENABLED = import.meta.env.VITE_ENABLE_DEMO_FIXTURES === '1'

export default function DicomUpload() {
  const { addCase, pushToast, user } = useApp()
  const { t } = useLocale()
  const nav = useLocalizedNavigate()

  const [patientName, setPatientName] = useState('')
  const [species, setSpecies] = useState<Patient['species']>('Köpek')
  const [breed, setBreed] = useState('')
  const [ageYears, setAgeYears] = useState('')
  const [history, setHistory] = useState('')
  const [consent, setConsent] = useState(false)
  const [ownerName, setOwnerName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [frames, setFrames] = useState<DicomFramePreview[]>([])
  const [framesLoading, setFramesLoading] = useState(false)
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

  const cancelInFlight = useCallback(
    (opts?: { silent?: boolean }) => {
      abortRef.current?.abort()
      abortRef.current = null
      setBusy(false)
      setValidating(false)
      setUploading(false)
      setUploadProgress(null)
      submitLockRef.current = false
      if (!opts?.silent) {
        pushToast({
          tone: 'info',
          title: t('dicom.cancelledTitle'),
          body: t('dicom.cancelledBody'),
        })
      }
    },
    [pushToast, t],
  )

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
        body: toastErrorBody(err, t),
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
        body: toastErrorBody(err, t),
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
        title: t('dicom.sampleLoaded'),
        body: 'Görüntüleyici açıldı. İsterseniz metadata önizleyebilir veya analize devam edebilirsiniz.',
      })
    } catch (err) {
      pushToast({ tone: 'error', title: t('dicom.sampleFailed'), body: toastErrorBody(err, t) })
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
      region === 'CERVICAL' || region === 'THORAX' || region === 'BRAIN' || region === 'THORACOLUMBAR' ? region : 'BRAIN',
    )
  }

  const runPreview = async (kind?: DicomDemoKind) => {
    const formErr = validatePatientForm({ patientName, species, consent: true })
    if (formErr.patientName) {
      pushToast({ tone: 'warning', title: t('dicom.patientNameRequired'), body: t('dicom.patientNameBeforeUpload') })
      return
    }
    if (!kind && files.length === 0) {
      pushToast({
        tone: 'warning',
        title: 'Dosya yok',
        body: t('dicom.needDcmFirst'),
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
        pushToast({ tone: 'error', title: t('dicom.uploadBlocked'), body: upload.block_reason ?? t('dicom.validationError') })
      } else {
        pushToast({
          tone: 'success',
          title: 'Metadata hazır',
          body: 'Sınıflandırmayı kontrol edip analize devam edebilirsiniz.',
        })
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      pushToast({ tone: 'error', title: t('dicom.uploadFailed'), body: toastErrorBody(err, t) })
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

  const submit = () => {
    if (submitLockRef.current) {
      pushToast({ tone: 'warning', title: t('dicom.duplicateBlocked'), body: t('dicom.duplicateBody') })
      return
    }
    const formErrors = validatePatientForm({ patientName, species, consent })
    if (formErrors.patientName || formErrors.consent) {
      pushToast({
        tone: 'warning',
        title: formErrors.patientName ? t('dicom.patientNameRequired') : t('dicom.confirmRequired'),
        body: formErrors.consent ?? formErrors.patientName,
      })
      return
    }
    if (!preview?.ingest_id && files.length === 0 && !pendingDemo) {
      pushToast({
        tone: 'warning',
        title: 'DICOM gerekli',
        body: 'DICOM dosyalarını sürükleyin veya klasör seçin.',
      })
      return
    }
    if (preview?.blocked) {
      pushToast({
        tone: 'warning',
        title: t('dicom.uploadBlocked'),
        body: preview.block_reason ?? t('dicom.validationError'),
      })
      return
    }

    // Never stay on this page in "Processing…" — abort local upload/preview and leave now.
    cancelInFlight({ silent: true })
    submitLockRef.current = true

    const pendingId = `pending-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
    const parsedAge = ageYears.trim() === '' ? 0 : Number(ageYears)
    const patient: Patient = {
      name: patientName,
      species,
      breed,
      sex: 'Erkek',
      neutered: true,
      age: Number.isFinite(parsedAge) ? parsedAge : 0,
      weight: 0,
      ownerName: ownerName.trim(),
      ownerPhone: '',
    }
    const clinical: ClinicalInfo = {
      complaint: history.split('\n')[0] || 'DICOM inceleme',
      onset: 'Akut',
      course: 'Progresif',
      history,
      medications: '',
    }
    const instanceCount =
      (preview?.study?.series.reduce((n, s) => n + s.instances.length, 0) ?? files.length) || 1
    const stamp = nowStamp()
    const pendingCase: VetCase = {
      id: pendingId,
      no: pendingId.replace(/^pending-/, 'VM-').toUpperCase(),
      patient,
      clinical,
      neuro: EMPTY_NEURO,
      documents: [],
      status: 'ai_analizi',
      module: 'Nöroloji',
      priority: 'Normal',
      createdAt: today(),
      clinic: CLINIC,
      vetName: user?.name ?? 'Dr. Elif Kaya',
      corrections: [],
      timeline: [{ date: stamp, label: 'Analiz hazırlanıyor', by: user?.name ?? 'vet' }],
      processingStartedAt: Date.now(),
      processingMs: estimateAnalysisDurationMs(instanceCount),
      dicomDemoKind: pendingDemo ?? undefined,
      instanceCount,
    }

    setAnalyzeHandoff({
      pendingId,
      files: files.slice(),
      pendingDemo,
      // If a metadata preview was still uploading, ignore partial preview and re-upload on Processing.
      ingestId: preview && !preview.blocked ? preview.ingest_id : undefined,
      uploadSnap: preview && !preview.blocked ? preview : null,
      patientName,
      species,
      breed,
      ageYears,
      history,
      consent,
      acceptSuggestion,
      overrideModality,
      overrideRegion,
      vetName: user?.name ?? 'Dr. Elif Kaya',
      ownerName: ownerName.trim(),
    })
    addCase(pendingCase)
    nav(`/vakalar/${pendingId}/isleme`, { replace: true })
  }

  const clinicalPanel = (
    <ClinicalPanel
      form={{ patientName, species, breed, ageYears, history, ownerName, consent }}
      onForm={{ setPatientName, setSpecies, setBreed, setAgeYears, setHistory, setOwnerName, setConsent }}
      hasStudy={hasStudy}
      studySummary={studySummary}
      preview={preview}
      fileCount={files.length}
      classification={{ acceptSuggestion, setAcceptSuggestion, overrideModality, setOverrideModality, overrideRegion, setOverrideRegion }}
      busy={busy}
      uploading={uploading}
      validating={validating}
      uploadProgress={uploadProgress}
      onPreview={() => void runPreview(pendingDemo ?? undefined)}
      onSubmit={() => submit()}
      onCancel={() => cancelInFlight()}
    />
  )

  const uploadZone = (
    <DicomDropZone
      busy={busy}
      validating={validating}
      uploadProgress={uploadProgress}
      fileCount={files.length}
      lastRejectSummary={lastRejectSummary}
      onDrop={(dt) => void addFromDrop(dt)}
      onFiles={addFromFileList}
      onCancel={() => cancelInFlight()}
    />
  )

  // Sample DICOM sets are test fixtures only (issue #95): hidden unless the build sets
  // VITE_ENABLE_DEMO_FIXTURES=1 (Playwright does). Real uploads are unaffected.
  const demoSection = !DEMO_FIXTURES_ENABLED ? null : (
    <DemoDicomSets
      pendingDemo={pendingDemo}
      busy={busy}
      onPreview={(kind) => void runPreview(kind)}
      onUse={(kind) => void loadDemoForViewing(kind)}
    />
  )

  return (
    <>
      <PageHeader
        title={t('dicom.title')}
        subtitle={t('dicom.pageSubtitle')}
        crumbs={[{ label: t('nav.cases'), to: '/vakalar' }, { label: t('dicom.title') }]}
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

      <div className="mb-5 overflow-hidden rounded-[1.25rem] bg-gradient-to-r from-navy-950 to-teal-900 px-5 py-4 text-white shadow-soft">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-300/90">{t('dicom.title')}</p>
        <p className="mt-1 text-sm text-slate-300">{t('dicom.pageSubtitle')}</p>
      </div>

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
            <div className="border-b border-slate-100 bg-gradient-to-r from-teal-50/80 to-white px-5 py-4 sm:px-6">
              <h2 className="font-display text-base font-bold text-navy-900">Hasta ve sipariş</h2>
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
