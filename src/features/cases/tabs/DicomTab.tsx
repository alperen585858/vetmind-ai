import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react'
import {
  AlertCircle,
  FileText,
  FolderOpen,
  Info,
  UploadCloud,
} from 'lucide-react'
import { useApp } from '../../../shared/shell/AppContext'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { Card } from '../../../shared/ui/Card'
import { Button } from '../../../shared/ui/Button'
import { DicomViewer } from '../../../shared/dicom/DicomViewer'
import { toastErrorBody } from '../../../shared/lib/apiErrors'
import { BackendUnavailableError, fetchCaseDicomFiles, fetchDemoDicomFiles, resolveDemoKindForCase } from '../../../shared/api'
import { buildDicomPreviews, type DicomFramePreview } from '../../../shared/lib/dicomPreview'
import { MAX_VIEWER_FRAMES, collectFilesFromDataTransfer, collectFilesFromFileList } from '../../../shared/lib/dicomFolder'
import { cacheCaseDicomFiles, loadCachedCaseDicomFiles } from '../../../shared/lib/dicomCaseCache'
import type { VetCase } from '../../../shared/types'

export function Imaging({ c }: { c: VetCase }) {
  const { t } = useLocale()
  const { pushToast } = useApp()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [frames, setFrames] = useState<DicomFramePreview[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [seriesKey, setSeriesKey] = useState<string | null>(null)
  const [sourceLabel, setSourceLabel] = useState('DICOM')

  const caseKey = c.backendCaseId || c.id
  const explicitDemoKind = c.dicomDemoKind
  const fallbackDemoKind = useMemo(
    () =>
      resolveDemoKindForCase({
        dicomDemoKind: c.dicomDemoKind,
        statusNote: c.statusNote,
        documents: c.documents,
      }),
    [c.dicomDemoKind, c.statusNote, c.documents],
  )

  const seriesOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>()
    for (const f of frames) {
      if (!f.ok) continue
      const key = f.seriesInstanceUid || (f.seriesDescription ? `desc:${f.seriesDescription}` : 'default')
      const label = f.seriesDescription || f.modality || 'Series'
      const prev = map.get(key)
      if (prev) prev.count += 1
      else map.set(key, { key, label, count: 1 })
    }
    return Array.from(map.values())
  }, [frames])

  const activeSeriesKey = seriesKey && seriesOptions.some((s) => s.key === seriesKey) ? seriesKey : seriesOptions[0]?.key ?? null

  const viewFrames = useMemo(() => {
    if (!activeSeriesKey) return frames
    return frames.filter((f) => {
      const key = f.seriesInstanceUid || (f.seriesDescription ? `desc:${f.seriesDescription}` : 'default')
      return key === activeSeriesKey
    })
  }, [frames, activeSeriesKey])

  const paintFiles = async (next: File[], label: string) => {
    const capped = next.slice(0, MAX_VIEWER_FRAMES)
    setFiles(capped)
    setSourceLabel(label)
    setFrames(await buildDicomPreviews(capped))
    setSeriesKey(null)
    setError(null)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        // 1) Browser cache from this session's upload (user's real files)
        const cached = await loadCachedCaseDicomFiles(caseKey)
        if (cancelled) return
        if (cached?.length) {
          await paintFiles(cached, t('cases.detail.uploadedStudy', { n: cached.length }))
          return
        }

        // 2) Backend quarantine (same bytes that were uploaded for the case)
        if (c.fromBackend || caseKey.startsWith('case-')) {
          try {
            const quarantined = await fetchCaseDicomFiles(caseKey)
            if (cancelled) return
            if (quarantined.length) {
              await paintFiles(quarantined, `Vaka DICOM · ${quarantined.length} dosya`)
              void cacheCaseDicomFiles(caseKey, quarantined)
              return
            }
          } catch (err) {
            // Fall through — may still have explicit demo or local drop
            if (cancelled) return
            if (!(err instanceof BackendUnavailableError) && !explicitDemoKind) {
              // Keep going to empty/demo paths
            }
          }
        }

        // 3) Only if this case was explicitly created from a demo fixture
        if (explicitDemoKind) {
          const demoFiles = await fetchDemoDicomFiles(
            explicitDemoKind,
            explicitDemoKind === 'thorax_xr' ? 1 : 12,
          )
          if (cancelled) return
          await paintFiles(demoFiles, t('cases.detail.sampleLabel', { kind: explicitDemoKind.replace(/_/g, ' ') }))
          return
        }

        // 4) No study attached — do NOT invent synthetic images
        if (cancelled) return
        setFiles([])
        setFrames([])
        setSourceLabel('DICOM yok')
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof BackendUnavailableError
            ? err.message
            : err instanceof Error
              ? err.message
              : t('cases.detail.dicomLoadFailed')
        setError(message)
        setFiles([])
        setFrames([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [caseKey, c.fromBackend, explicitDemoKind])

  const applyLocalFiles = async (incoming: File[], label: string) => {
    if (!incoming.length) {
      pushToast({ tone: 'warning', title: t('cases.detail.dicomNotFound'), body: t('cases.detail.dicomNotFoundBody') })
      return
    }
    setBusy(true)
    setLoading(true)
    try {
      await paintFiles(incoming, label)
      void cacheCaseDicomFiles(caseKey, incoming.slice(0, MAX_VIEWER_FRAMES))
      pushToast({ tone: 'success', title: t('cases.detail.imagesLoaded', { n: Math.min(incoming.length, MAX_VIEWER_FRAMES) }), body: label })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('cases.detail.previewFailed'))
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }

  const loadDemoOptional = async () => {
    setBusy(true)
    setLoading(true)
    setError(null)
    try {
      const kind = explicitDemoKind ?? fallbackDemoKind
      const demoFiles = await fetchDemoDicomFiles(kind, kind === 'thorax_xr' ? 1 : 12)
      await paintFiles(demoFiles, t('cases.detail.sampleLabel', { kind: kind.replace(/_/g, ' ') }))
    } catch (err) {
      const message =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('cases.detail.sampleLoadFailed')
      setError(message)
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }

  const reloadCaseStudy = async () => {
    setBusy(true)
    setLoading(true)
    setError(null)
    try {
      const quarantined = await fetchCaseDicomFiles(caseKey)
      if (!quarantined.length) {
        pushToast({
          tone: 'warning',
          title: t('cases.detail.caseDicomNotFound'),
          body: t('cases.detail.caseDicomNotFoundBody'),
        })
        setFiles([])
        setFrames([])
        setSourceLabel('DICOM yok')
        return
      }
      await paintFiles(quarantined, `Vaka DICOM · ${quarantined.length} dosya`)
      void cacheCaseDicomFiles(caseKey, quarantined)
    } catch (err) {
      const message =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('cases.detail.uploadFailed')
      setError(message)
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <span className="mr-1 text-sm font-medium text-navy-800">{t('cases.detail.series')}</span>
        {seriesOptions.length > 0 ? (
          seriesOptions.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSeriesKey(s.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
                activeSeriesKey === s.key
                  ? 'bg-navy-900 text-white ring-navy-900'
                  : 'bg-white text-navy-700 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {s.label}
              <span className="ml-1.5 text-[11px] opacity-70">{s.count}</span>
            </button>
          ))
        ) : (
          <span className="text-sm text-slate-500">{loading ? t('cases.detail.loading') : t('cases.detail.noSeries')}</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500">{sourceLabel}{files.length ? ` · ${files.length} dosya` : ''}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || loading}
            icon={<FileText className="h-3.5 w-3.5" />}
            onClick={() => fileInputRef.current?.click()}
          >
            Dosya
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || loading}
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            onClick={() => folderInputRef.current?.click()}
          >
            {t('cases.detail.folder')}
          </Button>
          {(c.fromBackend || caseKey.startsWith('case-')) && (
            <Button type="button" variant="ghost" size="sm" disabled={busy || loading} onClick={() => void reloadCaseStudy()}>
              {t('cases.detail.loadFromCase')}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" disabled={busy || loading} onClick={() => void loadDemoOptional()}>
            {t('cases.detail.sample')}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".dcm,.dicom,application/dicom,*/*"
          className="hidden"
          onChange={(e) => {
            void applyLocalFiles(collectFilesFromFileList(e.target.files), t('cases.detail.localFile'))
            e.target.value = ''
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void applyLocalFiles(collectFilesFromFileList(e.target.files), t('cases.detail.localFolder'))
            e.target.value = ''
          }}
          {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
        />
      </div>

      <div className="p-4">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            void (async () => {
              try {
                const collected = await collectFilesFromDataTransfer(e.dataTransfer)
                await applyLocalFiles(collected, t('cases.detail.dragDrop'))
              } catch (err) {
                pushToast({
                  tone: 'error',
                  title: t('cases.detail.folderReadFailed'),
                  body: toastErrorBody(err, t),
                })
              }
            })()
          }}
          className={`rounded-xl ${drag ? 'ring-2 ring-[#0D827B] ring-offset-2' : ''}`}
        >
          {error && !frames.length ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-6 text-center">
              <AlertCircle className="h-8 w-8 text-rose-500" />
              <p className="mt-3 font-medium text-rose-900">{t('cases.detail.imageLoadFailed')}</p>
              <p className="mt-1 max-w-md text-sm text-rose-800">{error}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void reloadCaseStudy()}>
                  Vakadan dene
                </Button>
                <Button size="sm" variant="secondary" icon={<UploadCloud className="h-3.5 w-3.5" />} onClick={() => fileInputRef.current?.click()}>
                  {t('cases.detail.chooseFile')}
                </Button>
              </div>
            </div>
          ) : !loading && !busy && !frames.length ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-[#E3EAF0] bg-[#F4F7FA] px-6 text-center">
              <UploadCloud className="h-10 w-10 text-[#0D827B]" />
              <p className="mt-3 font-medium text-[#172B45]">{t('cases.detail.dicomNotShownYet')}</p>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                {t('cases.detail.dicomNotShownBody')}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void reloadCaseStudy()}>
                  {t('cases.detail.loadFromCase')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  {t('cases.detail.chooseFile')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void loadDemoOptional()}>
                  {t('cases.detail.loadSample')}
                </Button>
              </div>
            </div>
          ) : (
            <DicomViewer
              frames={viewFrames}
              loading={loading || busy}
              className="min-h-[480px] xl:min-h-[560px]"
            />
          )}
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {t('cases.detail.viewerHelp')}
        </p>
      </div>
    </Card>
  )
}
