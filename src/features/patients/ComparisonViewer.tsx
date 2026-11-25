import { useCallback, useRef, useState } from 'react'
import { ArrowLeftRight, Loader2, Ruler, X } from 'lucide-react'
import { DicomViewer } from '../../shared/dicom/DicomViewer'
import { measureDelta, sameView, type ViewSyncState } from '../../shared/dicom/viewerSync'
import { useLocale } from '../../shared/shell/LocaleContext'
import { modalityLabel, regionLabel } from '../../shared/lib/displayClean'
import type { BackendPriorStudy } from '../../shared/types'
import { relativeAge, studyDate } from './patientLib'
import { useCaseFrames, type CaseFramesState } from './useCaseFrames'

type Side = 'current' | 'prior'
const other = (side: Side): Side => (side === 'current' ? 'prior' : 'current')

/**
 * Issue #108: the case being read (left) next to an earlier study of the same patient
 * (right). Slice position, zoom and pan follow each other while "sync" is on; window/level
 * only when its own toggle is on, since two studies may not share an intensity scale.
 */
export function ComparisonViewer({
  currentCaseId,
  currentDate,
  prior,
  onClose,
}: {
  currentCaseId: string
  /** Date of the case being read (DICOM study date or creation date). */
  currentDate: Date
  prior: BackendPriorStudy
  onClose: () => void
}) {
  const { t, locale } = useLocale()
  const current = useCaseFrames(currentCaseId)
  const previous = useCaseFrames(prior.case_id)
  const [sync, setSync] = useState(true)
  const [syncWindow, setSyncWindow] = useState(false)
  const [target, setTarget] = useState<Record<Side, ViewSyncState | null>>({ current: null, prior: null })
  const last = useRef<Partial<Record<Side, ViewSyncState>>>({})
  const [mm, setMm] = useState<Record<Side, number | null>>({ current: null, prior: null })

  const onViewChange = useCallback(
    (from: Side, view: ViewSyncState) => {
      last.current[from] = view
      if (!sync) return
      const to = other(from)
      const own = last.current[to]
      if (!own) return
      const next: ViewSyncState = syncWindow ? view : { ...view, wc: own.wc, ww: own.ww }
      if (sameView(next, own)) return
      setTarget((prev) => ({ ...prev, [to]: next }))
    },
    [sync, syncWindow],
  )

  const priorDate = studyDate(prior)
  const age = relativeAge(priorDate, currentDate)
  const dateFmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'tr-TR', { dateStyle: 'medium', timeZone: 'UTC' })
  const delta = measureDelta(mm.current, mm.prior)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft" aria-label={t('patients.compareTitle')}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <ArrowLeftRight className="h-5 w-5 text-vet-turquoise" />
        <h3 className="flex-1 text-base font-semibold text-navy-900">{t('patients.compareTitle')}</h3>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
          {t('patients.syncScroll')}
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={syncWindow} disabled={!sync} onChange={(e) => setSyncWindow(e.target.checked)} />
          {t('patients.syncWindow')}
        </label>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
        >
          <X className="h-4 w-4" /> {t('patients.compareClose')}
        </button>
      </div>

      {delta && (
        <p className="mb-3 inline-flex items-center gap-2 rounded-lg bg-teal-50 px-3 py-1.5 text-sm text-teal-900" role="status">
          <Ruler className="h-4 w-4" />
          {t('patients.measureDelta', { delta })}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title={t('patients.compareCurrent')}
          subtitle={dateFmt.format(currentDate)}
          state={current}
          syncView={target.current}
          onViewChange={(v) => onViewChange('current', v)}
          onMeasureMm={(v) => setMm((m) => ({ ...m, current: v }))}
        />
        <Panel
          title={t('patients.comparePrior')}
          subtitle={`${dateFmt.format(priorDate)} · ${t(`patients.ago.${age.unit}`, { n: age.value })} · ${modalityLabel(t, prior.modality)} · ${regionLabel(t, prior.anatomical_region)}`}
          state={previous}
          syncView={target.prior}
          onViewChange={(v) => onViewChange('prior', v)}
          onMeasureMm={(v) => setMm((m) => ({ ...m, prior: v }))}
        />
      </div>
    </section>
  )
}

function Panel({
  title,
  subtitle,
  state,
  syncView,
  onViewChange,
  onMeasureMm,
}: {
  title: string
  subtitle: string
  state: CaseFramesState
  syncView: ViewSyncState | null
  onViewChange: (v: ViewSyncState) => void
  onMeasureMm: (mm: number | null) => void
}) {
  const { t } = useLocale()
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-navy-900">{title}</p>
      <p className="mb-2 truncate text-xs text-slate-500">{subtitle}</p>
      {state.loading ? (
        <div className="flex h-64 items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('common.loading')}
        </div>
      ) : state.error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          {t('patients.compareLoadFailed')}
        </p>
      ) : state.empty ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">{t('patients.compareNoImages')}</p>
      ) : (
        <DicomViewer frames={state.frames} syncView={syncView} onViewChange={onViewChange} onMeasureMm={onMeasureMm} />
      )}
    </div>
  )
}
