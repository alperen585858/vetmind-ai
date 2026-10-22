import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Contrast,
  ImageOff,
  Maximize2,
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

export function DicomViewer({
  frames,
  loading = false,
  className = '',
}: {
  frames: DicomFramePreview[]
  loading?: boolean
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewable = useMemo(() => frames.filter((f) => f.ok && f.pixels && f.rows && f.cols), [frames])
  const [index, setIndex] = useState(0)
  const [tool, setTool] = useState<Tool>('wwwl')
  const [invert, setInvert] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [wc, setWc] = useState(0)
  const [ww, setWw] = useState(400)
  const dragRef = useRef<{ x: number; y: number; wc: number; ww: number; panX: number; panY: number; zoom: number } | null>(null)

  const frame = viewable[Math.min(index, Math.max(0, viewable.length - 1))]

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

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    renderFrameToCanvas(canvas, frame, { windowCenter: wc, windowWidth: ww, invert })
  }, [frame, wc, ww, invert])

  useEffect(() => {
    paint()
  }, [paint])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    if (!viewable.length) return
    if (e.ctrlKey || e.metaKey) {
      setZoom((z) => Math.min(8, Math.max(0.25, z * (e.deltaY > 0 ? 0.9 : 1.1))))
      return
    }
    setIndex((i) => {
      const next = e.deltaY > 0 ? i + 1 : i - 1
      return Math.max(0, Math.min(viewable.length - 1, next))
    })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, wc, ww, panX: pan.x, panY: pan.y, zoom }
  }

  const onPointerMove = (e: React.PointerEvent) => {
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
      <div className={`flex min-h-[360px] items-center justify-center rounded-xl bg-slate-950 text-sm text-slate-300 ${className}`}>
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
    <div className={`overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-xl shadow-black/30 ${className}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 bg-slate-900/90 px-2 py-1.5">
        <span className="mr-2 hidden text-[11px] font-semibold uppercase tracking-wide text-teal-400 sm:inline">VetMind Viewer</span>
        {(
          [
            ['wwwl', Contrast, 'W/L'],
            ['pan', Move, 'Pan'],
            ['zoom', ZoomIn, 'Zoom'],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => setTool(id)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${
              tool === id ? 'bg-teal-600 text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
        <button type="button" onClick={() => setInvert((v) => !v)} className={`rounded-md px-2 py-1 text-[11px] ${invert ? 'bg-amber-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
          Invert
        </button>
        <button type="button" onClick={resetView} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800">
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
        <div className="mx-1 hidden h-4 w-px bg-slate-700 sm:block" />
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p.id)}
            className="rounded-md px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] text-slate-400">
          W:{Math.round(ww)} L:{Math.round(wc)} · {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Viewport */}
      <div
        className="relative flex h-[420px] cursor-crosshair items-center justify-center overflow-hidden bg-black select-none"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          <canvas ref={canvasRef} className="max-h-[400px] max-w-full shadow-2xl shadow-black/50" />
        </div>

        {/* HUD overlays */}
        <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] leading-relaxed text-teal-200/90">
          <p>{frame.modality ?? 'MR'}</p>
          <p>{frame.cols}×{frame.rows}</p>
          <p>Im: {index + 1}/{viewable.length}</p>
          {frame.instanceNumber != null && <p>Inst#: {frame.instanceNumber}</p>}
        </div>
        <div className="pointer-events-none absolute right-3 top-3 text-right font-mono text-[10px] leading-relaxed text-slate-300/90">
          <p>WL {Math.round(wc)} / {Math.round(ww)}</p>
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
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-slate-900/80 p-2 text-white ring-1 ring-slate-600 hover:bg-slate-800"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-slate-900/80 p-2 text-white ring-1 ring-slate-600 hover:bg-slate-800"
              onClick={() => setIndex((i) => Math.min(viewable.length - 1, i + 1))}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {/* Slice + W/L sliders */}
      <div className="space-y-2 border-t border-slate-800 bg-slate-900/60 px-3 py-2">
        {viewable.length > 1 && (
          <label className="flex items-center gap-3 text-[11px] text-slate-400">
            <Maximize2 className="h-3.5 w-3.5" />
            Dilim
            <input
              type="range"
              min={0}
              max={viewable.length - 1}
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
              className="flex-1 accent-teal-500"
            />
            <span className="w-12 text-right font-mono text-slate-300">{index + 1}/{viewable.length}</span>
          </label>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            Center
            <input type="range" min={Math.round((frame.pixelMin ?? 0) - 500)} max={Math.round((frame.pixelMax ?? 4000) + 500)} value={Math.round(wc)} onChange={(e) => setWc(Number(e.target.value))} className="flex-1 accent-teal-500" />
          </label>
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            Width
            <input type="range" min={1} max={Math.max(100, Math.round(((frame.pixelMax ?? 4000) - (frame.pixelMin ?? 0)) * 2))} value={Math.round(ww)} onChange={(e) => setWw(Number(e.target.value))} className="flex-1 accent-teal-500" />
          </label>
        </div>

        {viewable.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {viewable.map((f, i) => (
              <button
                key={`${f.fileName}-${i}`}
                type="button"
                onClick={() => setIndex(i)}
                className={`h-12 w-12 shrink-0 overflow-hidden rounded ring-2 ${i === index ? 'ring-teal-400' : 'ring-slate-700'}`}
              >
                {f.thumbUrl ? <img src={f.thumbUrl} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-slate-800" />}
              </button>
            ))}
          </div>
        )}
        <p className="text-[10px] text-slate-500">
          Klinik PACS benzeri görüntüleme (W/L · pan · zoom · dilim). Pixel tabanlı AI tanı değildir — AI için backend{' '}
          <code className="text-teal-400">ImagingModelInput</code> paketi kullanılır.
        </p>
      </div>
    </div>
  )
}
