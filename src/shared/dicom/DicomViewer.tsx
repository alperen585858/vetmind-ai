import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
} from 'lucide-react'
import {
  autoWindow,
  groupFramesBySeries,
  renderFrameToCanvas,
  roiStats,
  type DicomFramePreview,
} from '../lib/dicomPreview'
import { useLocale } from '../shell/LocaleContext'
import { VhsGuideModal } from './VhsGuideModal'
import { indexFor, positionOf, sameView, type ViewSyncState } from './viewerSync'
import { shouldShowVhsGuide } from './vhsGuidePref'
import { computeVhs, VHS_POINT_COUNT, type Point as VhsPoint, type VhsResult, type VhsSpecies } from '../lib/vhs'
import {
  applyHandleDrag,
  assertAnnotateViewAllowed,
  bboxValidForSave,
  clampBBoxToImage,
  clientToNativePixel,
  hitTestBBox,
  normalizeBBox,
  type HitHandle,
  type NativeBBox,
} from './viewerCoords'
import { PRESET_DEFS, drawEvidenceBoxes, formatDistance, type AnnotateCommitPayload, type Tool } from './viewer/viewerParts'
import { SeriesStrip } from './viewer/SeriesStrip'
import { ViewerToolbar } from './viewer/ViewerToolbar'
import { VhsStatusBar } from './viewer/VhsStatusBar'
import { MeasurementLayer, type AnglePoints, type DraftAnnotate, type LineSegment } from './viewer/MeasurementLayer'
import { ViewerFooter } from './viewer/ViewerFooter'
import { ComparePanel, FrameInfoOverlay } from './viewer/ViewerOverlays'

export type { AnnotateCommitPayload } from './viewer/viewerParts'

export function DicomViewer({
  frames,
  loading = false,
  className = '',
  onActiveFrameChange,
  focusSopUid,
  focusRequestId = 0,
  aiOverlayBbox,
  aiOverlayStyle = 'ai',
  aiOverlayLabel,
  overlays,
  annotateEnabled = false,
  selectedEvidenceId = null,
  onAnnotateCommit,
  vhsEnabled = false,
  vhsSpecies = 'other',
  onVhsCommit,
  syncView = null,
  onViewChange,
  onMeasureMm,
}: {
  frames: DicomFramePreview[]
  loading?: boolean
  className?: string
  onActiveFrameChange?: (frame: DicomFramePreview, index: number) => void
  focusSopUid?: string | null
  focusRequestId?: number
  /** @deprecated Prefer `overlays` — kept for single-bbox callers. */
  aiOverlayBbox?: { x_min: number; y_min: number; x_max: number; y_max: number } | null
  aiOverlayStyle?: 'ai' | 'vet'
  aiOverlayLabel?: string | null
  /** P1.6 — multiple verified native bboxes for the active frame. */
  overlays?: {
    evidenceId: string
    label: string
    bbox: { x_min: number; y_min: number; x_max: number; y_max: number }
    style: 'ai' | 'vet'
    selected?: boolean
  }[]
  /** P1.7 — allow draw / move / resize bbox tool. */
  annotateEnabled?: boolean
  selectedEvidenceId?: string | null
  onAnnotateCommit?: (payload: AnnotateCommitPayload) => void | Promise<void>
  /** VHS (vertebral heart score) tool for lateral thoracic radiographs. */
  vhsEnabled?: boolean
  vhsSpecies?: VhsSpecies
  /** "Add to report" for a finished VHS measurement; button hidden when absent. */
  onVhsCommit?: (result: VhsResult) => void
  /** Issue #108 comparison: view to follow (slice by relative position, zoom/pan, W/L). */
  syncView?: ViewSyncState | null
  /** Issue #108 comparison: reports user-driven view changes (not ones applied from syncView). */
  onViewChange?: (view: ViewSyncState) => void
  /** Issue #108 comparison: finished distance measurement in mm (null when uncalibrated). */
  onMeasureMm?: (mm: number | null) => void
}) {
  const { t } = useLocale()
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
  const [measurePts, setMeasurePts] = useState<LineSegment | null>(null)
  const [measureLabel, setMeasureLabel] = useState<string | null>(null)
  const [anglePts, setAnglePts] = useState<AnglePoints | null>(null)
  const [angleLabel, setAngleLabel] = useState<string | null>(null)
  const [roiPts, setRoiPts] = useState<LineSegment | null>(null)
  const [roiLabel, setRoiLabel] = useState<string | null>(null)
  const [vhsPts, setVhsPts] = useState<VhsPoint[]>([])
  const [vhsGuideOpen, setVhsGuideOpen] = useState(false)
  /** Pick the VHS tool; first explain it unless the user snoozed the guide. */
  const selectVhsTool = () => {
    setTool('vhs')
    if (shouldShowVhsGuide()) setVhsGuideOpen(true)
  }
  const dragRef = useRef<{ x: number; y: number; wc: number; ww: number; panX: number; panY: number; zoom: number } | null>(null)
  const measureStartRef = useRef<{ x: number; y: number } | null>(null)
  const roiStartRef = useRef<{ x: number; y: number } | null>(null)
  const [draftAnnotate, setDraftAnnotate] = useState<DraftAnnotate | null>(null)
  const [annotateBusy, setAnnotateBusy] = useState(false)
  const [annotateError, setAnnotateError] = useState<string | null>(null)
  const annotateDragRef = useRef<null | {
    kind: 'draw' | 'edit'
    handle?: HitHandle
    startNative: { x: number; y: number }
    startBox?: NativeBBox
    evidenceId?: string
  }>(null)

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

  // W/L that a sync just applied: a slice change must not reset it to the auto window.
  const syncWindowRef = useRef<{ wc: number; ww: number } | null>(null)
  // Last view applied from syncView, so following the other panel is not echoed back.
  const appliedSyncRef = useRef<{ view: ViewSyncState; index: number } | null>(null)

  useEffect(() => {
    if (!frame) return
    const synced = syncWindowRef.current
    syncWindowRef.current = null
    const aw = synced ? { center: synced.wc, width: synced.ww } : autoWindow(frame)
    setWc(aw.center)
    setWw(aw.width)
  }, [frame?.fileName, frame?.sopInstanceUid])

  useEffect(() => {
    if (!syncView || !viewable.length) return
    const nextIndex = indexFor(syncView.position, viewable.length)
    appliedSyncRef.current = { view: syncView, index: nextIndex }
    if (nextIndex !== safeIndex) syncWindowRef.current = { wc: syncView.wc, ww: syncView.ww }
    setIndex(nextIndex)
    setZoom(syncView.zoom)
    setPan({ x: syncView.panX, y: syncView.panY })
    setWc(syncView.wc)
    setWw(syncView.ww)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new syncView triggers this
  }, [syncView, viewable.length])

  useEffect(() => {
    if (!onViewChange || !frame) return
    const view: ViewSyncState = { position: positionOf(safeIndex, viewable.length), zoom, panX: pan.x, panY: pan.y, wc, ww }
    const applied = appliedSyncRef.current
    if (
      applied &&
      applied.index === safeIndex &&
      sameView({ ...applied.view, position: view.position }, view)
    ) {
      return
    }
    appliedSyncRef.current = null
    onViewChange(view)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- emit on view changes only
  }, [safeIndex, viewable.length, zoom, pan.x, pan.y, wc, ww])

  useEffect(() => {
    if (!frame) return
    onActiveFrameChange?.(frame, safeIndex)
  }, [frame, safeIndex, onActiveFrameChange])

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    renderFrameToCanvas(canvas, frame, { windowCenter: wc, windowWidth: ww, invert })
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawList =
      overlays && overlays.length > 0
        ? overlays
        : aiOverlayBbox
          ? [
              {
                evidenceId: 'legacy',
                label: aiOverlayLabel?.trim() || (aiOverlayStyle === 'vet' ? 'Vet' : 'AI'),
                bbox: aiOverlayBbox,
                style: aiOverlayStyle,
                selected: true,
              },
            ]
          : []

    drawEvidenceBoxes(ctx, drawList)
  }, [frame, wc, ww, invert, aiOverlayBbox, aiOverlayStyle, aiOverlayLabel, overlays])

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
    const vp = viewportRef.current
    if (!canvas || !frame?.cols || !frame.rows) return { x: 0, y: 0 }
    // Prefer explicit inverse when annotate / non-zero view transform; else AABB map.
    // Never fall back to AABB under rotation/flip — that maps the wrong pixels.
    try {
      assertAnnotateViewAllowed({
        panX: pan.x,
        panY: pan.y,
        zoom,
        rotationDeg: rotation,
        flipH,
        flipV,
      })
      if (vp && (tool === 'annotate' || rotation !== 0 || flipH || flipV || zoom !== 1 || pan.x || pan.y)) {
        const vpRect = vp.getBoundingClientRect()
        return clientToNativePixel(e.clientX, e.clientY, {
          originClientX: vpRect.left + vpRect.width / 2,
          originClientY: vpRect.top + vpRect.height / 2,
          contentWidth: canvas.offsetWidth || frame.cols,
          contentHeight: canvas.offsetHeight || frame.rows,
          cols: frame.cols,
          rows: frame.rows,
          panX: pan.x,
          panY: pan.y,
          zoom,
          rotationDeg: rotation,
          flipH,
          flipV,
        })
      }
    } catch {
      if (rotation !== 0 || flipH || flipV) {
        return { x: Number.NaN, y: Number.NaN }
      }
    }
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * frame.cols
    const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * frame.rows
    return { x, y }
  }

  const onPointerDown = (e: PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    if (tool === 'annotate' && annotateEnabled && frame?.cols && frame.rows) {
      setAnnotateError(null)
      try {
        assertAnnotateViewAllowed({
          panX: pan.x,
          panY: pan.y,
          zoom,
          rotationDeg: rotation,
          flipH,
          flipV,
        })
      } catch (err) {
        setAnnotateError(err instanceof Error ? err.message : t('dicom.viewer.annotateViewBlocked'))
        return
      }
      const pt = canvasLocalPoint(e)
      const selected = overlays?.find((o) => o.evidenceId === selectedEvidenceId)
      const handle = selected ? hitTestBBox(pt.x, pt.y, selected.bbox, Math.max(6, (frame.cols || 512) / 64)) : null
      if (selected && handle) {
        annotateDragRef.current = {
          kind: 'edit',
          handle,
          startNative: pt,
          startBox: { ...selected.bbox },
          evidenceId: selected.evidenceId,
        }
        setDraftAnnotate({ mode: 'edit', evidenceId: selected.evidenceId, box: { ...selected.bbox } })
        return
      }
      annotateDragRef.current = { kind: 'draw', startNative: pt }
      setDraftAnnotate({
        mode: 'create',
        box: { x_min: pt.x, y_min: pt.y, x_max: pt.x, y_max: pt.y },
      })
      return
    }
    if (tool === 'vhs') {
      const pt = canvasLocalPoint(e)
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return
      setVhsPts((prev) => (prev.length >= VHS_POINT_COUNT ? [pt] : [...prev, pt]))
      return
    }
    if (tool === 'measure') {
      const pt = canvasLocalPoint(e)
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return
      measureStartRef.current = pt
      setMeasurePts({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y })
      setMeasureLabel(null)
      return
    }
    if (tool === 'roi') {
      const pt = canvasLocalPoint(e)
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return
      roiStartRef.current = pt
      setRoiPts({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y })
      setRoiLabel(null)
      return
    }
    if (tool === 'angle') {
      const pt = canvasLocalPoint(e)
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return
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
    if (tool === 'annotate' && annotateDragRef.current && frame?.cols && frame.rows) {
      const pt = canvasLocalPoint(e)
      const drag = annotateDragRef.current
      if (drag.kind === 'draw') {
        const box = clampBBoxToImage(normalizeBBox(drag.startNative, pt), frame.cols, frame.rows)
        setDraftAnnotate({ mode: 'create', box })
      } else if (drag.kind === 'edit' && drag.startBox && drag.handle) {
        const dx = pt.x - drag.startNative.x
        const dy = pt.y - drag.startNative.y
        const box = clampBBoxToImage(
          applyHandleDrag(drag.startBox, drag.handle, dx, dy),
          frame.cols,
          frame.rows,
        )
        setDraftAnnotate({ mode: 'edit', evidenceId: drag.evidenceId, box })
      }
      return
    }
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
    if (tool === 'annotate') {
      annotateDragRef.current = null
      return
    }
    if (tool === 'measure' && measurePts && frame) {
      const dx = measurePts.x1 - measurePts.x0
      const dy = measurePts.y1 - measurePts.y0
      const { text, mm } = formatDistance(dx, dy, frame.pixelSpacingMm)
      setMeasureLabel(text)
      onMeasureMm?.(mm)
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

  const commitAnnotate = async () => {
    if (!draftAnnotate || !frame?.cols || !frame.rows || !onAnnotateCommit) return
    if (!bboxValidForSave(draftAnnotate.box, frame.cols, frame.rows)) {
      setAnnotateError(t('dicom.viewer.annotateTooSmall'))
      return
    }
    setAnnotateBusy(true)
    setAnnotateError(null)
    try {
      await onAnnotateCommit({
        mode: draftAnnotate.mode,
        bbox: draftAnnotate.box,
        evidenceId: draftAnnotate.evidenceId,
        sopInstanceUid: frame.sopInstanceUid,
        frameIndex: safeIndex,
      })
      setDraftAnnotate(null)
    } catch (err) {
      setAnnotateError(err instanceof Error ? err.message : t('dicom.viewer.annotateSaveFailed'))
    } finally {
      setAnnotateBusy(false)
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
    setRotation(0)
    setFlipH(false)
    setFlipV(false)
    setMeasurePts(null)
    setMeasureLabel(null)
    setAnglePts(null)
    setAngleLabel(null)
    setRoiPts(null)
    setRoiLabel(null)
    setVhsPts([])
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
    else if ((e.key === 'b' || e.key === 'B') && annotateEnabled) setTool('annotate')
    else if ((e.key === 'h' || e.key === 'H') && vhsEnabled) selectVhsTool()
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
    const p = PRESET_DEFS.find((x) => x.id === id)
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
  const vhsResult = vhsEnabled ? computeVhs(vhsPts, vhsSpecies, frame?.pixelSpacingMm) : null

  return (
    <>
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-[#12233a] bg-[#071B30] shadow-soft ${fullscreen ? 'h-full' : ''} ${className}`}
      tabIndex={0}
      ref={viewportRef}
      onKeyDown={onKeyDown}
      role="application"
      aria-label="DICOM görüntüleyici"
    >
      {seriesGroups.length > 1 && (
        <SeriesStrip groups={seriesGroups} activeKey={activeSeries?.key} onSelect={setSeriesKey} />
      )}

      <ViewerToolbar
        tool={tool}
        onTool={setTool}
        annotateEnabled={annotateEnabled}
        vhsEnabled={vhsEnabled}
        onSelectVhs={selectVhsTool}
        invert={invert}
        onToggleInvert={() => setInvert((v) => !v)}
        onRotate={() => setRotation((r) => (r + 90) % 360)}
        flipH={flipH}
        onToggleFlipH={() => setFlipH((v) => !v)}
        flipV={flipV}
        onToggleFlipV={() => setFlipV((v) => !v)}
        onReset={resetView}
        cine={cine}
        onToggleCine={() => setCine((v) => !v)}
        cineFps={cineFps}
        onCineFps={setCineFps}
        compare={compare}
        onToggleCompare={() => {
          setCompare((v) => !v)
          if (!compare && seriesGroups.length > 1) {
            const other = seriesGroups.find((s) => s.key !== activeSeries?.key)
            setCompareSeriesKey(other?.key || null)
          }
        }}
        fullscreen={fullscreen}
        onToggleFullscreen={() => void toggleFullscreen()}
        onPreset={applyPreset}
        status={`W:${Math.round(ww)} L:${Math.round(wc)} · ${Math.round(zoom * 100)}% · ${safeIndex + 1}/${viewable.length}${statusBits ? ` · ${statusBits}` : ''}${!frame.pixelSpacingMm ? ' · spacing yok' : ''}`}
      />

      {vhsEnabled && (tool === 'vhs' || vhsPts.length > 0) && (
        <VhsStatusBar
          result={vhsResult}
          pointCount={vhsPts.length}
          onHelp={() => setVhsGuideOpen(true)}
          onUndo={() => setVhsPts((p) => p.slice(0, -1))}
          onClear={() => setVhsPts([])}
          onCommit={onVhsCommit}
        />
      )}

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
          {/* Wrapper hugs the canvas so the SVG layer (measure/angle/ROI/bbox draft/VHS) is drawn in
              exactly the canvas box. Spanning the wider container stretched it horizontally and
              drew marks away from where the user clicked on narrow/portrait images. */}
          <div className="relative inline-block max-w-full leading-[0]">
          <canvas ref={canvasRef} className="block max-h-[min(58vh,600px)] max-w-full" />
          {frame?.cols && frame.rows && (
            <MeasurementLayer
              cols={frame.cols}
              rows={frame.rows}
              measure={measurePts}
              angle={anglePts}
              roi={roiPts}
              vhsPoints={vhsPts}
              draft={draftAnnotate}
            />
          )}
          </div>
        </div>
        {compare && (
          <ComparePanel
            ref={compareCanvasRef}
            groups={seriesGroups}
            compareSeriesKey={compareSeriesKey}
            onCompareSeries={(key) => {
              setCompareSeriesKey(key)
              setCompareIndex(0)
            }}
            poolSize={comparePool.length}
            compareIndex={compareIndex}
            onCompareIndex={setCompareIndex}
          />
        )}

        <FrameInfoOverlay frame={frame} index={safeIndex} total={viewable.length} wc={wc} ww={ww} tool={tool} />
        {(draftAnnotate || annotateError) && annotateEnabled ? (
          <div className="absolute bottom-3 right-3 z-10 flex max-w-[min(100%,280px)] flex-col gap-1 rounded-md border border-white/15 bg-[#0b1727]/95 p-2 text-[11px] text-slate-100 shadow-lg">
            {annotateError ? <p className="text-amber-300">{annotateError}</p> : null}
            {draftAnnotate ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-slate-400">
                  {draftAnnotate.mode === 'edit' ? 'Kutu düzenle' : 'Yeni kutu'} · native px
                </span>
                <button
                  type="button"
                  className="rounded bg-[#0D827B] px-2 py-0.5 text-white disabled:opacity-50"
                  disabled={annotateBusy}
                  onClick={() => void commitAnnotate()}
                >
                  {annotateBusy ? '…' : 'Kaydet'}
                </button>
                <button
                  type="button"
                  className="rounded bg-white/10 px-2 py-0.5 text-slate-200"
                  disabled={annotateBusy}
                  onClick={() => {
                    setDraftAnnotate(null)
                    setAnnotateError(null)
                  }}
                >
                  İptal
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
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

      <ViewerFooter
        viewable={viewable}
        index={safeIndex}
        frame={frame}
        wc={wc}
        ww={ww}
        onStep={goSlice}
        onSelect={(i) => {
          setCine(false)
          setIndex(i)
        }}
        onWc={setWc}
        onWw={setWw}
      />
    </div>
    {vhsEnabled ? <VhsGuideModal open={vhsGuideOpen} onClose={() => setVhsGuideOpen(false)} /> : null}
    </>
  )
}
