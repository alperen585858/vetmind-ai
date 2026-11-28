import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { DicomFramePreview } from '../../lib/dicomPreview'

/** Slice slider, window center / width sliders and the slice thumbnail strip. */
export function ViewerFooter({
  viewable,
  index,
  frame,
  wc,
  ww,
  onStep,
  onSelect,
  onWc,
  onWw,
}: {
  viewable: DicomFramePreview[]
  index: number
  frame: DicomFramePreview
  wc: number
  ww: number
  onStep: (delta: number) => void
  onSelect: (index: number) => void
  onWc: (wc: number) => void
  onWw: (ww: number) => void
}) {
  return (
    <div className="space-y-2 border-t border-white/10 bg-[#0b1727] px-3 py-2">
      {viewable.length > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md p-1 text-slate-300 hover:bg-white/5 hover:text-white"
            onClick={() => onStep(-1)}
            disabled={index <= 0}
            aria-label="Önceki dilim"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={0}
            max={viewable.length - 1}
            value={index}
            onChange={(e) => onSelect(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer accent-[#0D827B]"
            aria-label="Dilim kaydırıcı"
          />
          <button
            type="button"
            className="rounded-md p-1 text-slate-300 hover:bg-white/5 hover:text-white"
            onClick={() => onStep(1)}
            disabled={index >= viewable.length - 1}
            aria-label="Sonraki dilim"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="min-w-[4.5rem] text-right font-mono text-[11px] tabular-nums text-slate-300">
            {index + 1} / {viewable.length}
          </span>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-[11px] text-slate-400">
          Center
          <input
            type="range"
            min={Math.round((frame.pixelMin ?? 0) - 500)}
            max={Math.round((frame.pixelMax ?? 4000) + 500)}
            value={Math.round(wc)}
            onChange={(e) => onWc(Number(e.target.value))}
            className="flex-1 accent-[#0D827B]"
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] text-slate-400">
          Width
          <input
            type="range"
            min={1}
            max={Math.max(100, Math.round(((frame.pixelMax ?? 4000) - (frame.pixelMin ?? 0)) * 2))}
            value={Math.round(ww)}
            onChange={(e) => onWw(Number(e.target.value))}
            className="flex-1 accent-[#0D827B]"
          />
        </label>
      </div>

      {viewable.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin]">
          {viewable.map((f, i) => {
            const aspect = f.cols && f.rows && f.cols > 0 ? Math.max(0.55, Math.min(1.35, f.rows / f.cols)) : 1
            return (
              <button
                key={`${f.sopInstanceUid || f.fileName}-${i}`}
                type="button"
                title={f.relativePath || f.fileName}
                onClick={() => onSelect(i)}
                className={`h-14 shrink-0 overflow-hidden rounded bg-black ring-2 ${
                  i === index ? 'ring-[#0D827B]' : 'ring-white/10 hover:ring-white/25'
                }`}
                style={{ width: `${Math.round(56 / aspect)}px` }}
              >
                {f.thumbUrl ? (
                  <img src={f.thumbUrl} alt="" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[9px] text-slate-500">{i + 1}</div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
