import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Contrast,
  FlipHorizontal2,
  FlipVertical2,
  ImageOff,
  Maximize2,
  Minimize2,
  Move,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Ruler,
  Square,
  Triangle,
  ZoomIn,
} from 'lucide-react'
import {
  autoWindow,
  groupFramesBySeries,
  renderFrameToCanvas,
  roiStats,
  type DicomFramePreview,
} from '../lib/dicomPreview'

type Tool = 'wwwl' | 'pan' | 'zoom' | 'measure' | 'angle' | 'roi'

const PRESETS: { id: string; label: string; wc: number; ww: number }[] = [
  { id: 'auto', label: 'Auto', wc: 0, ww: 0 },
  { id: 'soft', label: 'Soft', wc: 40, ww: 400 },
  { id: 'brain', label: 'Brain', wc: 40, ww: 80 },
  { id: 'bone', label: 'Bone', wc: 300, ww: 1500 },
  { id: 'lung', label: 'Lung', wc: -600, ww: 1500 },
  { id: 'abdomen', label: 'Abd', wc: 40, ww: 350 },
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

function formatDistance(
  dx: number,
  dy: number,
  spacing?: [number, number],
): { text: string; calibrated: boolean } {
  const pxDist = Math.hypot(dx, dy)
  if (spacing) {
    const [rowMm, colMm] = spacing
    const mm = Math.hypot(dx * colMm, dy * rowMm)
    return { text: `${mm.toFixed(1)} mm`, calibrated: true }
  }
  return { text: `${pxDist.toFixed(1)} px (kalibre değil)`, calibrated: false }
}

export function DicomViewer({
  frames,
  loading = false,
  className = '',
  onActiveFrameChange,
  focusSopUid,
  focusRequestId = 0,
}: {
  frames: DicomFramePreview[]
  loading?: boolean
  className?: string
  onActiveFrameChange?: (frame: DicomFramePreview, index: number) => void
  focusSopUid?: string | null
  focusRequestId?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const compareCanvasRef = useRef<HTMLCanvasElement>(null)
  const seriesGroups = useMemo(() => groupFramesBySeries(frames), [frames])
  const [seriesKey, setSeriesKey] = useState<string | null>(null)
  const activeSeries = useMemo(() => {
    if (!seriesGroups.length) return null
    return seriesGroups.find((s) => s.key === seriesKey) || seriesGroups[0]!
  }, [seriesGroups, seriesKey])
  const viewable = useMemo(
    () => (activeSeries?.frames || []).filter((f) => f.ok && f.pixels && f.rows && f.cols),
    [activeSeries],
  )
  const [compareSeriesKey, setCompareSeriesKey] = useState<string | null>(null)
  const compareSeries = useMemo(() => {
    if (!compareSeriesKey) return null
    return seriesGroups.find((s) => s.key === compareSeriesKey) || null
  }, [seriesGroups, compareSeriesKey])
  const compareViewable = useMemo(
    () => (compareSeries?.frames || []).filter((f) => f.ok && f.pixels && f.rows && f.cols),
    [compareSeries],
  )

  const [index, setIndex] = useState(0)
  const [tool, setTool] = useState<Tool>('wwwl')
  const [invert, setInvert] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [rotation, setRotation] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [wc, setWc] = useState(0)
  const [ww, setWw] = useState(400)
  const [fullscreen, setFullscreen] = useState(false)
  const [compare, setCompare] = useState(false)
  const [compareIndex, setCompareIndex] = useState(0)
  const [cine, setCine] = useState(false)
  const [cineFps, setCineFps] = useState(8)
  const [measurePts, setMeasurePts] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null)
  const [measureLabel, setMeasureLabel] = useState<string | null>(null)
  const [anglePts, setAnglePts] = useState<null | { a: { x: number; y: number }; b: { x: number; y: number }; c?: { x: number; y: number } }>(
    null,
  )
  const [angleLabel, setAngleLabel] = useState<string | null>(null)
  const [roiPts, setRoiPts] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null)
  const [roiLabel, setRoiLabel] = useState<string | null>(null)
  const dragRef = useRef<{ x: number; y: number; wc: number; ww: number; panX: number; panY: number; zoom: number } | null>(null)
  const measureStartRef = useRef<{ x: number; y: number } | null>(null)
  const roiStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (seriesGroups.length && (!seriesKey || !seriesGroups.some((s) => s.key === seriesKey))) {
      setSeriesKey(seriesGroups[0]!.key)
    }
  }, [seriesGroups, seriesKey])

  const safeIndex = Math.min(index, Math.max(0, viewable.length - 1))
  const frame = viewable[safeIndex]

  useEffect(() => {
    setIndex(0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setInvert(false)
    setRotation(0)
    setFlipH(false)
    setFlipV(false)
    setCine(false)
    setMeasurePts(null)
    setMeasureLabel(null)
    setAnglePts(null)
    setAngleLabel(null)
    setRoiPts(null)
    setRoiLabel(null)
  }, [seriesKey, frames])

  useEffect(() => {
    if (!focusSopUid || !focusRequestId) return
    for (const g of seriesGroups) {
      const idx = g.frames.findIndex((f) => f.sopInstanceUid === focusSopUid)
      if (idx >= 0) {
        setSeriesKey(g.key)
        const viewIdx = g.frames.filter((f) => f.ok && f.pixels).findIndex((f) => f.sopInstanceUid === focusSopUid)
        if (viewIdx >= 0) setIndex(viewIdx)
        break
      }
    }
  }, [focusSopUid, focusRequestId, seriesGroups])

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

  const comparePool = compareViewable.length ? compareViewable : viewable
  const compareFrame = comparePool[Math.min(compareIndex, Math.max(0, comparePool.length - 1))]
  useEffect(() => {
    const canvas = compareCanvasRef.current
    if (!compare || !canvas || !compareFrame) return
    renderFrameToCanvas(canvas, compareFrame, { windowCenter: wc, windowWidth: ww, invert })
  }, [compare, compareFrame, wc, ww, invert])

  useEffect(() => {
    if (!cine || viewable.length < 2) return
    const ms = Math.max(40, Math.round(1000 / cineFps))
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % viewable.length)
    }, ms)
    return () => window.clearInterval(id)
  }, [cine, cineFps, viewable.length])

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFullscreen = async () => {
    const el = viewportRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await el.requestFullscreen()
    } catch {
      /* ignore */
    }
  }

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

  const canvasLocalPoint = (e: PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * (frame?.cols ?? 1)
    const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * (frame?.rows ?? 1)
    return { x, y }
  }

  const onPointerDown = (e: PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    if (tool === 'measure') {
      const pt = canvasLocalPoint(e)
      measureStartRef.current = pt
      setMeasurePts({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y })
      setMeasureLabel(null)
      return
    }
    if (tool === 'roi') {
      const pt = canvasLocalPoint(e)
      roiStartRef.current = pt
      setRoiPts({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y })
      setRoiLabel(null)
      return
    }
    if (tool === 'angle') {
      const pt = canvasLocalPoint(e)
      setAnglePts((prev) => {
        if (!prev || prev.c) return { a: pt, b: pt }
        if (!prev.c && (prev.a.x !== prev.b.x || prev.a.y !== prev.b.y)) {
          return { ...prev, c: pt }
        }
        return { a: prev.a, b: pt }
      })
      setAngleLabel(null)
      return
    }
    dragRef.current = { x: e.clientX, y: e.clientY, wc, ww, panX: pan.x, panY: pan.y, zoom }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (tool === 'measure' && measureStartRef.current) {
      const pt = canvasLocalPoint(e)
      setMeasurePts({
        x0: measureStartRef.current.x,
        y0: measureStartRef.current.y,
        x1: pt.x,
        y1: pt.y,
      })
      return
    }
    if (tool === 'roi' && roiStartRef.current) {
      const pt = canvasLocalPoint(e)
      setRoiPts({
        x0: roiStartRef.current.x,
        y0: roiStartRef.current.y,
        x1: pt.x,
        y1: pt.y,
      })
      return
    }
    if (tool === 'angle' && anglePts && !anglePts.c) {
      const pt = canvasLocalPoint(e)
      setAnglePts({ ...anglePts, b: pt })
      return
    }
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
    if (tool === 'measure' && measurePts && frame) {
      const dx = measurePts.x1 - measurePts.x0
      const dy = measurePts.y1 - measurePts.y0
      const { text } = formatDistance(dx, dy, frame.pixelSpacingMm)
      setMeasureLabel(text)
    }
    if (tool === 'roi' && roiPts && frame) {
      const stats = roiStats(frame, roiPts.x0, roiPts.y0, roiPts.x1, roiPts.y1)
      if (stats) {
        const unit = frame.pixelSpacingMm ? '' : ' (kalibre değil)'
        setRoiLabel(`ROI μ=${stats.mean.toFixed(1)} min=${stats.min.toFixed(1)} max=${stats.max.toFixed(1)} n=${stats.count}${unit}`)
      }
    }
    if (tool === 'angle' && anglePts?.c) {
      const v1x = anglePts.a.x - anglePts.b.x
      const v1y = anglePts.a.y - anglePts.b.y
      const v2x = anglePts.c.x - anglePts.b.x
      const v2y = anglePts.c.y - anglePts.b.y
      const dot = v1x * v2x + v1y * v2y
      const n1 = Math.hypot(v1x, v1y)
      const n2 = Math.hypot(v2x, v2y)
      if (n1 > 1e-6 && n2 > 1e-6) {
        const deg = (Math.acos(Math.max(-1, Math.min(1, dot / (n1 * n2)))) * 180) / Math.PI
        setAngleLabel(`${deg.toFixed(1)}°`)
      }
    }
    measureStartRef.current = null
    roiStartRef.current = null
    dragRef.current = null
  }

  const resetView = () => {
    if (!frame) return
    const aw = autoWindow(frame)
    setWc(aw.center)
    setWw(aw.width)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setInvert(false)
    setRotation(0)
    setFlipH(false)
    setFlipV(false)
    setMeasurePts(null)
    setMeasureLabel(null)
    setAnglePts(null)
    setAngleLabel(null)
    setRoiPts(null)
    setRoiLabel(null)
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
    } else if (e.key === ' ') {
      e.preventDefault()
      setCine((v) => !v)
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault()
      resetView()
    } else if (e.key === 'i' || e.key === 'I') {
      e.preventDefault()
      setInvert((v) => !v)
    } else if (e.key === 'w' || e.key === 'W') setTool('wwwl')
    else if (e.key === 'p' || e.key === 'P') setTool('pan')
    else if (e.key === 'z' || e.key === 'Z') setTool('zoom')
    else if (e.key === 'm' || e.key === 'M') setTool('measure')
    else if (e.key === 'a' || e.key === 'A') setTool('angle')
    else if (e.key === 'o' || e.key === 'O') setTool('roi')
    else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault()
      void toggleFullscreen()
    } else if (e.key === 'c' || e.key === 'C') setCompare((v) => !v)
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

  const transformStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
    transformOrigin: 'center center' as const,
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
    const err = frames.find((f) => f.error)?.error
    return (
      <div className={`rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 ${className}`}>
        <div className="flex items-start gap-2">
          <ImageOff className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Piksel önizlemesi yok</p>
            <p className="mt-1 text-xs">
              Metadata okundu; görüntü verisi yok veya transfer syntax desteklenmiyor.
              {err ? ` (${err})` : ''}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const statusBits = [measureLabel, angleLabel, roiLabel].filter(Boolean).join(' · ')

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-[#12233a] bg-[#071B30] shadow-soft ${fullscreen ? 'h-full' : ''} ${className}`}
      tabIndex={0}
      ref={viewportRef}
      onKeyDown={onKeyDown}
      role="application"
      aria-label="DICOM görüntüleyici"
    >
      {seriesGroups.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto border-b border-white/10 bg-[#0b1727] px-2 py-1.5">
          {seriesGroups.map((s) => (
            <button
              key={s.key}
              type="button"
              title={s.label}
              onClick={() => setSeriesKey(s.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[10px] ${
                s.key === activeSeries?.key
                  ? 'bg-[#0D827B] text-white'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {s.thumbUrl ? (
                <img src={s.thumbUrl} alt="" className="h-8 w-8 rounded object-cover" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded bg-black text-[9px] text-slate-500">
                  {s.frames.length}
                </span>
              )}
              <span className="max-w-[100px] truncate">
                {s.modality ? `${s.modality} · ` : ''}
                {s.label}
              </span>
              <span className="text-slate-400">({s.frames.length})</span>
            </button>
          ))}
        </div>
      )}

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
        <ToolButton active={tool === 'measure'} title="Mesafe (M)" onClick={() => setTool('measure')}>
          <Ruler className="h-3.5 w-3.5" /> Mesafe
        </ToolButton>
        <ToolButton active={tool === 'angle'} title="Açı (A)" onClick={() => setTool('angle')}>
          <Triangle className="h-3.5 w-3.5" /> Açı
        </ToolButton>
        <ToolButton active={tool === 'roi'} title="ROI (O)" onClick={() => setTool('roi')}>
          <Square className="h-3.5 w-3.5" /> ROI
        </ToolButton>
        <div className="mx-1 hidden h-4 w-px bg-white/10 sm:block" aria-hidden />
        <ToolButton active={invert} title="Invert (I)" onClick={() => setInvert((v) => !v)}>
          Invert
        </ToolButton>
        <ToolButton title="90° döndür" onClick={() => setRotation((r) => (r + 90) % 360)}>
          <RotateCw className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton active={flipH} title="Yatay çevir" onClick={() => setFlipH((v) => !v)}>
          <FlipHorizontal2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton active={flipV} title="Dikey çevir" onClick={() => setFlipV((v) => !v)}>
          <FlipVertical2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Reset (R)" onClick={resetView}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </ToolButton>
        <ToolButton
          active={cine}
          title="Cine (Space)"
          onClick={() => setCine((v) => !v)}
        >
          {cine ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} Cine
        </ToolButton>
        {cine && (
          <label className="flex items-center gap-1 text-[10px] text-slate-400">
            fps
            <input
              type="number"
              min={1}
              max={30}
              value={cineFps}
              onChange={(e) => setCineFps(Math.max(1, Math.min(30, Number(e.target.value) || 8)))}
              className="w-10 rounded border border-white/10 bg-black/40 px-1 py-0.5 text-white"
            />
          </label>
        )}
        <ToolButton
          active={compare}
          title="Karşılaştır (C)"
          onClick={() => {
            setCompare((v) => !v)
            if (!compare && seriesGroups.length > 1) {
              const other = seriesGroups.find((s) => s.key !== activeSeries?.key)
              setCompareSeriesKey(other?.key || null)
            }
          }}
        >
          <Columns2 className="h-3.5 w-3.5" /> Compare
        </ToolButton>
        <ToolButton title="Tam ekran (F)" onClick={() => void toggleFullscreen()}>
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
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
        <span className="ml-auto max-w-[50%] truncate font-mono text-[10px] tabular-nums text-slate-400">
          W:{Math.round(ww)} L:{Math.round(wc)} · {Math.round(zoom * 100)}% · {safeIndex + 1}/{viewable.length}
          {statusBits ? ` · ${statusBits}` : ''}
          {!frame.pixelSpacingMm ? ' · spacing yok' : ''}
        </span>
      </div>

      <div
        className={`relative flex min-h-[min(62vh,640px)] flex-1 cursor-crosshair items-center justify-center overflow-hidden bg-black select-none ${compare ? 'gap-1' : ''}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => viewportRef.current?.focus()}
      >
        <div className={`relative flex items-center justify-center ${compare ? 'w-1/2' : 'w-full'}`} style={transformStyle}>
          <canvas ref={canvasRef} className="max-h-[min(58vh,600px)] max-w-full" />
          {frame?.cols && frame.rows && (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${frame.cols} ${frame.rows}`}
              preserveAspectRatio="none"
            >
              {measurePts && (
                <line
                  x1={measurePts.x0}
                  y1={measurePts.y0}
                  x2={measurePts.x1}
                  y2={measurePts.y1}
                  stroke="#5eead4"
                  strokeWidth={Math.max(1, frame.cols / 400)}
                />
              )}
              {anglePts && (
                <>
                  <line
                    x1={anglePts.a.x}
                    y1={anglePts.a.y}
                    x2={anglePts.b.x}
                    y2={anglePts.b.y}
                    stroke="#fbbf24"
                    strokeWidth={Math.max(1, frame.cols / 400)}
                  />
                  {anglePts.c && (
                    <line
                      x1={anglePts.b.x}
                      y1={anglePts.b.y}
                      x2={anglePts.c.x}
                      y2={anglePts.c.y}
                      stroke="#fbbf24"
                      strokeWidth={Math.max(1, frame.cols / 400)}
                    />
                  )}
                </>
              )}
              {roiPts && (
                <rect
                  x={Math.min(roiPts.x0, roiPts.x1)}
                  y={Math.min(roiPts.y0, roiPts.y1)}
                  width={Math.abs(roiPts.x1 - roiPts.x0)}
                  height={Math.abs(roiPts.y1 - roiPts.y0)}
                  fill="rgba(94,234,212,0.12)"
                  stroke="#5eead4"
                  strokeWidth={Math.max(1, frame.cols / 400)}
                />
              )}
            </svg>
          )}
        </div>
        {compare && (
          <div className="flex w-1/2 flex-col items-center justify-center border-l border-white/10">
            {seriesGroups.length > 1 && (
              <select
                className="mb-1 max-w-[90%] rounded border border-white/10 bg-[#0b1727] px-2 py-0.5 text-[10px] text-slate-200"
                value={compareSeriesKey || ''}
                onChange={(e) => {
                  setCompareSeriesKey(e.target.value || null)
                  setCompareIndex(0)
                }}
                aria-label="Karşılaştırma serisi"
              >
                <option value="">Aynı seri (dilim)</option>
                {seriesGroups.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.modality ? `${s.modality} · ` : ''}
                    {s.label} ({s.frames.length})
                  </option>
                ))}
              </select>
            )}
            <canvas ref={compareCanvasRef} className="max-h-[min(58vh,600px)] max-w-full" />
            {comparePool.length > 1 && (
              <input
                type="range"
                min={0}
                max={comparePool.length - 1}
                value={Math.min(compareIndex, comparePool.length - 1)}
                onChange={(e) => setCompareIndex(Number(e.target.value))}
                className="mt-2 w-4/5 accent-[#0D827B]"
                aria-label="Karşılaştırma dilimi"
              />
            )}
          </div>
        )}

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
          {frame.imagePositionPatient && (
            <p className="text-slate-400">
              IPP z={frame.imagePositionPatient[2].toFixed(1)}
            </p>
          )}
        </div>
        <div className="pointer-events-none absolute right-3 top-3 text-right font-mono text-[10px] leading-relaxed text-slate-300/90">
          <p>
            WL {Math.round(wc)} / {Math.round(ww)}
          </p>
          <p>{tool.toUpperCase()}</p>
          <p className="text-slate-500">Scroll dilim · Ctrl+scroll zoom · Space cine</p>
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

      <div className="space-y-2 border-t border-white/10 bg-[#0b1727] px-3 py-2">
        {viewable.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md p-1 text-slate-300 hover:bg-white/5 hover:text-white"
              onClick={() => goSlice(-1)}
              disabled={safeIndex <= 0}
              aria-label="Önceki dilim"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="range"
              min={0}
              max={viewable.length - 1}
              value={safeIndex}
              onChange={(e) => {
                setCine(false)
                setIndex(Number(e.target.value))
              }}
              className="h-1.5 flex-1 cursor-pointer accent-[#0D827B]"
              aria-label="Dilim kaydırıcı"
            />
            <button
              type="button"
              className="rounded-md p-1 text-slate-300 hover:bg-white/5 hover:text-white"
              onClick={() => goSlice(1)}
              disabled={safeIndex >= viewable.length - 1}
              aria-label="Sonraki dilim"
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
                  onClick={() => {
                    setCine(false)
                    setIndex(i)
                  }}
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
