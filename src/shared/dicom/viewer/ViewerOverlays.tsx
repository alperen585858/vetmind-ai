import { forwardRef } from 'react'
import { useLocale } from '../../shell/LocaleContext'
import { modalityLabel } from '../../lib/displayClean'
import type { DicomFramePreview } from '../../lib/dicomPreview'
import type { SeriesGroup } from './SeriesStrip'
import type { Tool } from './viewerParts'

/** Right half in compare mode: series picker, second canvas and its slice slider. */
export const ComparePanel = forwardRef<
  HTMLCanvasElement,
  {
    groups: SeriesGroup[]
    compareSeriesKey: string | null
    onCompareSeries: (key: string | null) => void
    poolSize: number
    compareIndex: number
    onCompareIndex: (index: number) => void
  }
>(function ComparePanel({ groups, compareSeriesKey, onCompareSeries, poolSize, compareIndex, onCompareIndex }, ref) {
  const { t } = useLocale()
  return (
    <div className="flex w-1/2 flex-col items-center justify-center border-l border-white/10">
      {groups.length > 1 && (
        <select
          className="mb-1 max-w-[90%] rounded border border-white/10 bg-[#0b1727] px-2 py-0.5 text-[10px] text-slate-200"
          value={compareSeriesKey || ''}
          onChange={(e) => onCompareSeries(e.target.value || null)}
          aria-label="Karşılaştırma serisi"
        >
          <option value="">Aynı seri (dilim)</option>
          {groups.map((s) => (
            <option key={s.key} value={s.key}>
              {s.modality ? `${modalityLabel(t, s.modality)} · ` : ''}
              {s.label} ({s.frames.length})
            </option>
          ))}
        </select>
      )}
      <canvas ref={ref} className="max-h-[min(58vh,600px)] max-w-full" />
      {poolSize > 1 && (
        <input
          type="range"
          min={0}
          max={poolSize - 1}
          value={Math.min(compareIndex, poolSize - 1)}
          onChange={(e) => onCompareIndex(Number(e.target.value))}
          className="mt-2 w-4/5 accent-[#0D827B]"
          aria-label="Karşılaştırma dilimi"
        />
      )}
    </div>
  )
})

/** Corner text over the image: frame metadata (left) and W/L + active tool (right). */
export function FrameInfoOverlay({
  frame,
  index,
  total,
  wc,
  ww,
  tool,
}: {
  frame: DicomFramePreview
  index: number
  total: number
  wc: number
  ww: number
  tool: Tool
}) {
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] leading-relaxed text-teal-200/90">
        {frame.modality && <p>{frame.modality}</p>}
        {frame.seriesDescription && <p className="max-w-[220px] truncate">{frame.seriesDescription}</p>}
        {frame.cols != null && frame.rows != null && (
          <p>
            {frame.cols}×{frame.rows}
          </p>
        )}
        <p>
          Im: {index + 1}/{total}
        </p>
        {frame.instanceNumber != null && <p>Inst#: {frame.instanceNumber}</p>}
        {frame.imagePositionPatient && <p className="text-slate-400">IPP z={frame.imagePositionPatient[2].toFixed(1)}</p>}
      </div>
      <div className="pointer-events-none absolute right-3 top-3 text-right font-mono text-[10px] leading-relaxed text-slate-300/90">
        <p>
          WL {Math.round(wc)} / {Math.round(ww)}
        </p>
        <p>{tool.toUpperCase()}</p>
        <p className="text-slate-500">Scroll dilim · Ctrl+scroll zoom · Space cine</p>
      </div>
    </>
  )
}
