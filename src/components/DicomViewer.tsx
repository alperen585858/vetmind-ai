import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type WheelEvent } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Contrast,
  ImageOff,
  Move,
  RotateCcw,
  ZoomIn,
} from 'lucide-react'
import { autoWindow, renderFrameToCanvas, type DicomFramePreview } from '../lib/dicomPreview'

type Tool = 'wwwl' | 'pan' | 'zoom'

const PRESETS: { id: string; label: string; wc: number; ww: number }[] = [
  { id: 'auto', label: 'Auto', wc: 0, ww: 0 },
  { id: 'soft', label: 'Soft', wc: 40, ww: 400 },
  { id: 'brain', label: 'Brain', wc: 40, ww: 80 },
  { id: 'bone', label: 'Bone', wc: 300, ww: 1500 },
  { id: 'lung', label: 'Lung', wc: -600, ww: 1500 },
]

function ToolButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition ${
        active
          ? 'bg-[#0D827B] text-white shadow-sm'
          : 'text-slate-300 hover:bg-white/5 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

export function DicomViewer({
  frames,
  loading = false,
  className = '',
  onActiveFrameChange,
}: {
  frames: DicomFramePreview[]
  loading?: boolean
  className?: string
  onActiveFrameChange?: (frame: DicomFramePreview, index: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewable = useMemo(() => frames.filter((f) => f.ok && f.pixels && f.rows && f.cols), [frames])
  const [index, setIndex] = useState(0)
  const [tool, setTool] = useState<Tool>('wwwl')
  const [invert, setInvert] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [wc, setWc] = useState(0)
  const [ww, setWw] = useState(400)
  const dragRef = useRef<{ x: number; y: number; wc: number; ww: number; panX: number; panY: number; zoom: number } | null>(null)

  const safeIndex = Math.min(index, Math.max(0, viewable.length - 1))
  const frame = viewable[safeIndex]

  useEffect(() => {
    setIndex(0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setInvert(false)
  }, [frames])

  useEffect(() => {
    if (!frame) return
    const aw = autoWindow(frame)
    setWc(aw.center)
    setWw(aw.width)
  }, [frame?.fileName, frame?.sopInstanceUid])

  useEffect(() => {
    if (!frame) return
    onActiveFrameChange?.(frame, safeIndex)
  }, [frame, safeIndex, onActiveFrameChange])

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    renderFrameToCanvas(canvas, frame, { windowCenter: wc, windowWidth: ww, invert })
  }, [frame, wc, ww, invert])

  useEffect(() => {
    paint()
  }, [paint])

  const goSlice = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, Math.min(viewable.length - 1, i + delta)))
    },
    [viewable.length],
  )

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (!viewable.length) return
    if (e.ctrlKey || e.metaKey) {
      setZoom((z) => Math.min(8, Math.max(0.25, z * (e.deltaY > 0 ? 0.9 : 1.1))))
      return
    }
    goSlice(e.deltaY > 0 ? 1 : -1)
  }

  const onPointerDown = (e: PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, wc, ww, panX: pan.x, panY: pan.y, zoom }
  }

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (tool === 'wwwl') {
      setWw(Math.max(1, d.ww + dx * 2))
      setWc(d.wc - dy * 2)
    } else if (tool === 'pan') {
      setPan({ x: d.panX + dx, y: d.panY + dy })
    } else if (tool === 'zoom') {
      setZoom(Math.min(8, Math.max(0.25, d.zoom * (1 - dy * 0.01))))
    }
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!viewable.length) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      goSlice(-1)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      goSlice(1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setIndex(viewable.length - 1)
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault()
      resetView()
    } else if (e.key === 'i' || e.key === 'I') {
      e.preventDefault()
      setInvert((v) => !v)
    } else if (e.key === 'w' || e.key === 'W') {
      setTool('wwwl')
    } else if (e.key === 'p' || e.key === 'P') {
      setTool('pan')
    } else if (e.key === 'z' || e.key === 'Z') {
      setTool('zoom')
    }
  }

  const applyPreset = (id: string) => {
    if (!frame) return
    if (id === 'auto') {
      const aw = autoWindow(frame)
      setWc(aw.center)
      setWw(aw.width)
      return
    }
    const p = PRESETS.find((x) => x.id === id)
    if (p) {
      setWc(p.wc)
      setWw(p.ww)
    }
  }

  const resetView = () => {
    if (!frame) return
    const aw = autoWindow(frame)
    setWc(aw.center)
    setWw(aw.width)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setInvert(false)
  }

  if (loading) {
    return (
      <div
        className={`flex min-h-[420px] items-center justify-center rounded-xl border border-[#12233a] bg-[#071B30] text-sm text-slate-300 ${className}`}
      >
        Seri yükleniyor…
      </div>
    )
  }

  if (!frames.length) return null

  if (!viewable.length) {
    return (
      <div className={`rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 ${className}`}>
        <div className="flex items-start gap-2">
          <ImageOff className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Piksel önizlemesi yok</p>
            <p className="mt-1 text-xs">Metadata okundu; görüntü verisi yok veya format desteklenmiyor.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-[#12233a] bg-[#071B30] shadow-soft ${className}`}
      tabIndex={0}
      ref={viewportRef}
      onKeyDown={onKeyDown}
      role="application"
      aria-label="DICOM görüntüleyici"
    >
      {/* Toolbar: Window/Level | Pan | Zoom | Invert | Reset | Presets */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-white/10 bg-[#0b1727] px-2 py-1.5">
        <span className="mr-2 hidden text-[10px] font-semibold uppercase tracking-wider text-[#0D827B] sm:inline">
          Viewer
        </span>
        <ToolButton active={tool === 'wwwl'} title="Window / Level (W)" onClick={() => setTool('wwwl')}>
          <Contrast className="h-3.5 w-3.5" /> W/L
        </ToolButton>
        <ToolButton active={tool === 'pan'} title="Pan (P)" onClick={() => setTool('pan')}>
          <Move className="h-3.5 w-3.5" /> Pan
        </ToolButton>
        <ToolButton active={tool === 'zoom'} title="Zoom (Z)" onClick={() => setTool('zoom')}>
          <ZoomIn className="h-3.5 w-3.5" /> Zoom
        </ToolButton>
        <div className="mx-1 hidden h-4 w-px bg-white/10 sm:block" aria-hidden />
        <ToolButton active={invert} title="Invert (I)" onClick={() => setInvert((v) => !v)}>
          Invert
        </ToolButton>
        <ToolButton title="Reset (R)" onClick={resetView}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </ToolButton>
        <div className="mx-1 hidden h-4 w-px bg-white/10 sm:block" aria-hidden />
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={`${p.label} preset`}
            onClick={() => applyPreset(p.id)}
            className="rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-white/5 hover:text-white"
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] tabular-nums text-slate-400">
          W:{Math.round(ww)} L:{Math.round(wc)} · {Math.round(zoom * 100)}% · {safeIndex + 1}/{viewable.length}
        </span>
      </div>

      {/* Viewport */}
      <div
        className="relative flex min-h-[min(62vh,640px)] flex-1 cursor-crosshair items-center justify-center overflow-hidden bg-black select-none"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => viewportRef.current?.focus()}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          <canvas ref={canvasRef} className="max-h-[min(58vh,600px)] max-w-full" />
        </div>

        <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] leading-relaxed text-teal-200/90">
          {frame.modality && <p>{frame.modality}</p>}
          {frame.seriesDescription && <p className="max-w-[220px] truncate">{frame.seriesDescription}</p>}
          {frame.cols != null && frame.rows != null && (
            <p>
              {frame.cols}×{frame.rows}
            </p>
          )}
          <p>
            Im: {safeIndex + 1}/{viewable.length}
          </p>
          {frame.instanceNumber != null && <p>Inst#: {frame.instanceNumber}</p>}
        </div>
        <div className="pointer-events-none absolute right-3 top-3 text-right font-mono text-[10px] leading-relaxed text-slate-300/90">
          <p>
            WL {Math.round(wc)} / {Math.round(ww)}
          </p>
          <p>{tool.toUpperCase()}</p>
          <p className="text-slate-500">Scroll: dilim · Ctrl+scroll: zoom</p>
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-[70%] truncate font-mono text-[10px] text-slate-400">
          {frame.relativePath || frame.fileName}
        </div>

        {viewable.length > 1 && (
          <>
            <button
              type="button"
              title="Önceki dilim"
              aria-label="Önceki dilim"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-[#071B30]/85 p-2 text-white ring-1 ring-white/15 hover:bg-[#0D827B]"
              onClick={() => goSlice(-1)}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              title="Sonraki dilim"
              aria-label="Sonraki dilim"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-[#071B30]/85 p-2 text-white ring-1 ring-white/15 hover:bg-[#0D827B]"
              onClick={() => goSlice(1)}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {/* Slice navigation + W/L + thumbnails */}
      <div className="space-y-2 border-t border-white/10 bg-[#0b1727] px-3 py-2">
        {viewable.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Önceki dilim"
              aria-label="Önceki dilim"
              className="rounded-md p-1 text-slate-300 hover:bg-white/5 hover:text-white"
              onClick={() => goSlice(-1)}
              disabled={safeIndex <= 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="range"
              min={0}
              max={viewable.length - 1}
              value={safeIndex}
              onChange={(e) => setIndex(Number(e.target.value))}
              className="h-1.5 flex-1 cursor-pointer accent-[#0D827B]"
              aria-label="Dilim kaydırıcı"
              title={`Dilim ${safeIndex + 1} / ${viewable.length}`}
            />
            <button
              type="button"
              title="Sonraki dilim"
              aria-label="Sonraki dilim"
              className="rounded-md p-1 text-slate-300 hover:bg-white/5 hover:text-white"
              onClick={() => goSlice(1)}
              disabled={safeIndex >= viewable.length - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="min-w-[4.5rem] text-right font-mono text-[11px] tabular-nums text-slate-300">
              {safeIndex + 1} / {viewable.length}
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
              onChange={(e) => setWc(Number(e.target.value))}
              className="flex-1 accent-[#0D827B]"
              title="Window center"
            />
          </label>
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            Width
            <input
              type="range"
              min={1}
              max={Math.max(100, Math.round(((frame.pixelMax ?? 4000) - (frame.pixelMin ?? 0)) * 2))}
              value={Math.round(ww)}
              onChange={(e) => setWw(Number(e.target.value))}
              className="flex-1 accent-[#0D827B]"
              title="Window width"
            />
          </label>
        </div>

        {viewable.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin]">
            {viewable.map((f, i) => {
              const aspect =
                f.cols && f.rows && f.cols > 0 ? Math.max(0.55, Math.min(1.35, f.rows / f.cols)) : 1
              return (
                <button
                  key={`${f.sopInstanceUid || f.fileName}-${i}`}
                  type="button"
                  title={f.relativePath || f.fileName}
                  onClick={() => setIndex(i)}
                  className={`h-14 shrink-0 overflow-hidden rounded bg-black ring-2 ${
                    i === safeIndex ? 'ring-[#0D827B]' : 'ring-white/10 hover:ring-white/25'
                  }`}
                  style={{ width: `${Math.round(56 / aspect)}px` }}
                >
                  {f.thumbUrl ? (
                    <img src={f.thumbUrl} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[9px] text-slate-500">
                      {i + 1}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
