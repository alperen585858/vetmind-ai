import type { Point as VhsPoint } from '../../lib/vhs'
import type { NativeBBox } from '../viewerCoords'
import { VhsOverlay } from './viewerParts'

type Pt = { x: number; y: number }
export type LineSegment = { x0: number; y0: number; x1: number; y1: number }
export type AnglePoints = { a: Pt; b: Pt; c?: Pt }
export type DraftAnnotate = { mode: 'create' | 'edit'; evidenceId?: string; box: NativeBBox }

/** SVG drawn in native pixel space over the canvas: distance, angle, ROI, VHS and the bbox draft. */
export function MeasurementLayer({
  cols,
  rows,
  measure,
  angle,
  roi,
  vhsPoints,
  draft,
}: {
  cols: number
  rows: number
  measure: LineSegment | null
  angle: AnglePoints | null
  roi: LineSegment | null
  vhsPoints: VhsPoint[]
  draft: DraftAnnotate | null
}) {
  const stroke = Math.max(1, cols / 400)
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none">
      {measure && <line x1={measure.x0} y1={measure.y0} x2={measure.x1} y2={measure.y1} stroke="#5eead4" strokeWidth={stroke} />}
      {angle && (
        <>
          <line x1={angle.a.x} y1={angle.a.y} x2={angle.b.x} y2={angle.b.y} stroke="#fbbf24" strokeWidth={stroke} />
          {angle.c && <line x1={angle.b.x} y1={angle.b.y} x2={angle.c.x} y2={angle.c.y} stroke="#fbbf24" strokeWidth={stroke} />}
        </>
      )}
      {roi && (
        <rect
          x={Math.min(roi.x0, roi.x1)}
          y={Math.min(roi.y0, roi.y1)}
          width={Math.abs(roi.x1 - roi.x0)}
          height={Math.abs(roi.y1 - roi.y0)}
          fill="rgba(94,234,212,0.12)"
          stroke="#5eead4"
          strokeWidth={stroke}
        />
      )}
      {vhsPoints.length > 0 && <VhsOverlay points={vhsPoints} stroke={Math.max(1.5, cols / 350)} />}
      {draft && (
        <rect
          x={draft.box.x_min}
          y={draft.box.y_min}
          width={Math.max(1, draft.box.x_max - draft.box.x_min)}
          height={Math.max(1, draft.box.y_max - draft.box.y_min)}
          fill="rgba(29,78,216,0.15)"
          stroke="#1d4ed8"
          strokeWidth={Math.max(2, cols / 300)}
          strokeDasharray={draft.mode === 'create' ? '8 4' : undefined}
        />
      )}
    </svg>
  )
}
