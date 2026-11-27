import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ImageOff, Info, RotateCw } from 'lucide-react'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { Card } from '../../../shared/ui/Card'
import { Button } from '../../../shared/ui/Button'
import { DicomViewer } from '../../../shared/dicom/DicomViewer'
import { fetchCaseDicomFiles, fetchDemoDicomFiles } from '../../../shared/api'
import { buildDicomPreviews, type DicomFramePreview } from '../../../shared/lib/dicomPreview'
import { MAX_VIEWER_FRAMES } from '../../../shared/lib/dicomFolder'
import { cacheCaseDicomFiles, loadCachedCaseDicomFiles } from '../../../shared/lib/dicomCaseCache'
import type { VetCase } from '../../../shared/types'
import { loadCaseStudy, type CaseStudySource } from '../lib/caseStudy'

const caseStudyDeps = {
  loadCached: loadCachedCaseDicomFiles,
  fetchBackend: (caseKey: string) => fetchCaseDicomFiles(caseKey),
  fetchDemo: fetchDemoDicomFiles,
  cache: cacheCaseDicomFiles,
}

/** The case's imaging tab: shows only the case's own study, never local or sample files. */
export function Imaging({ c }: { c: VetCase }) {
  const { t } = useLocale()
  const [source, setSource] = useState<CaseStudySource | null>(null)
  const [frames, setFrames] = useState<DicomFramePreview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seriesKey, setSeriesKey] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const caseKey = c.backendCaseId || c.id
  const onBackend = Boolean(c.fromBackend) || caseKey.startsWith('case-')
  const demoKind = c.dicomDemoKind

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

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const next = await loadCaseStudy({ caseKey, onBackend, demoKind }, caseStudyDeps)
        if (cancelled) return
        const capped = next.files.slice(0, MAX_VIEWER_FRAMES)
        const previews = capped.length ? await buildDicomPreviews(capped) : []
        if (cancelled) return
        setSource({ ...next, files: capped } as CaseStudySource)
        setFrames(previews)
        setSeriesKey(null)
      } catch (err) {
        if (cancelled) return
        setSource(null)
        setFrames([])
        setError(err instanceof Error && err.message ? err.message : t('cases.detail.dicomLoadFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [caseKey, onBackend, demoKind, attempt])

  const sourceLabel = !source
    ? ''
    : source.kind === 'none'
      ? t('cases.detail.noDicom')
      : source.kind === 'demoCase'
        ? t('cases.detail.sampleLabel', { kind: source.demoKind.replace(/_/g, ' ') })
        : source.kind === 'cached'
          ? t('cases.detail.uploadedStudy', { n: source.files.length })
          : t('cases.detail.caseStudy', { n: source.files.length })

  const retry = () => setAttempt((n) => n + 1)

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
        {sourceLabel && (
          <span className="ml-auto text-[11px] text-slate-500" data-testid="case-study-source">
            {sourceLabel}
          </span>
        )}
      </div>

      <div className="p-4">
        {error ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-6 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <p className="mt-3 font-medium text-rose-900">{t('cases.detail.imageLoadFailed')}</p>
            <p className="mt-1 max-w-md text-sm text-rose-800">{error}</p>
            <Button
              className="mt-4"
              size="sm"
              variant="secondary"
              icon={<RotateCw className="h-3.5 w-3.5" />}
              disabled={loading}
              onClick={retry}
            >
              {t('cases.detail.retry')}
            </Button>
          </div>
        ) : !loading && !frames.length ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-[#E3EAF0] bg-[#F4F7FA] px-6 text-center">
            <ImageOff className="h-10 w-10 text-slate-400" />
            <p className="mt-3 font-medium text-[#172B45]">{t('cases.detail.dicomNotShownYet')}</p>
            <p className="mt-1 max-w-md text-sm text-slate-500">{t('cases.detail.dicomNotShownBody')}</p>
          </div>
        ) : (
          <DicomViewer frames={viewFrames} loading={loading} className="min-h-[480px] xl:min-h-[560px]" />
        )}

        <p className="mt-4 flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {t('cases.detail.viewerHelp')}
        </p>
      </div>
    </Card>
  )
}
