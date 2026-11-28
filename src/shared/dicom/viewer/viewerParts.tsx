import type { ReactNode } from 'react'
import type { Point as VhsPoint } from '../../lib/vhs'
import type { NativeBBox } from '../viewerCoords'

export type Tool = 'wwwl' | 'pan' | 'zoom' | 'measure' | 'angle' | 'roi' | 'annotate' | 'vhs'

export type AnnotateCommitPayload = {
  mode: 'create' | 'edit'
  bbox: NativeBBox
  evidenceId?: string
  sopInstanceUid?: string | null
  frameIndex?: number | null
}

export const PRESET_DEFS: { id: string; labelKey: string; wc: number; ww: number }[] = [
  { id: 'auto', labelKey: 'dicom.viewer.presetAuto', wc: 0, ww: 0 },
  { id: 'soft', labelKey: 'dicom.viewer.presetSoft', wc: 40, ww: 400 },
  { id: 'brain', labelKey: 'dicom.viewer.presetBrain', wc: 40, ww: 80 },
  { id: 'bone', labelKey: 'dicom.viewer.presetBone', wc: 300, ww: 1500 },
  { id: 'lung', labelKey: 'dicom.viewer.presetLung', wc: -600, ww: 1500 },
  { id: 'abdomen', labelKey: 'dicom.viewer.presetAbdomen', wc: 40, ww: 350 },
]

export function ToolButton({
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

export function formatDistance(
  dx: number,
  dy: number,
  spacing?: [number, number],
): { text: string; calibrated: boolean; mm: number | null } {
  const pxDist = Math.hypot(dx, dy)
  if (spacing) {
    const [rowMm, colMm] = spacing
    const mm = Math.hypot(dx * colMm, dy * rowMm)
    return { text: `${mm.toFixed(1)} mm`, calibrated: true, mm }
  }
  return { text: `${pxDist.toFixed(1)} px (kalibre değil)`, calibrated: false, mm: null }
}

export const VHS_LABELS = ['1', '2', '3', '4', 'T4', 'T8']

/** Long axis (1→2), short axis (3→4) and the T4→T8 spine scale with one tick per vertebra. */
export function VhsOverlay({ points, stroke }: { points: VhsPoint[]; stroke: number }) {
  const [a, b, c, d, t4, t8] = points
  const line = (p: VhsPoint | undefined, q: VhsPoint | undefined, color: string) =>
    p && q ? <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={color} strokeWidth={stroke} /> : null
  const ticks =
    t4 && t8
      ? [1, 2, 3].map((k) => (
          <circle
            key={k}
            cx={t4.x + ((t8.x - t4.x) * k) / 4}
            cy={t4.y + ((t8.y - t4.y) * k) / 4}
            r={stroke * 1.6}
            fill="#38bdf8"
          />
        ))
      : null
  return (
    <g>
      {line(a, b, '#fb7185')}
      {line(c, d, '#fda4af')}
      {line(t4, t8, '#38bdf8')}
      {ticks}
      {points.map((p, i) => (
        <g key={i}>
          <circle
            data-vhs-point={VHS_LABELS[i]}
            cx={p.x}
            cy={p.y}
            r={stroke * 2.4}
            fill={i >= 4 ? '#38bdf8' : '#fb7185'}
            stroke="#0b1727"
            strokeWidth={stroke / 2}
          />
          <text x={p.x + stroke * 3} y={p.y - stroke * 3} fill="#fff" fontSize={stroke * 9} fontFamily="monospace">
            {VHS_LABELS[i]}
          </text>
        </g>
      ))}
    </g>
  )
}

export type EvidenceBox = {
  evidenceId: string
  label: string
  bbox: { x_min: number; y_min: number; x_max: number; y_max: number }
  style: 'ai' | 'vet'
  selected?: boolean
}

/** Paint evidence bboxes (AI red, vet blue; dashed unless selected) with their labels. */
export function drawEvidenceBoxes(ctx: CanvasRenderingContext2D, boxes: EvidenceBox[]): void {
  for (const item of boxes) {
    const color = item.style === 'vet' ? '#1d4ed8' : '#dc2626'
    const selected = Boolean(item.selected)
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = selected ? 3 : 2
    if (!selected || item.style === 'ai') ctx.setLineDash(selected ? [] : [6, 4])
    else ctx.setLineDash([])
    const x = item.bbox.x_min
    const y = item.bbox.y_min
    const w = Math.max(1, item.bbox.x_max - item.bbox.x_min)
    const h = Math.max(1, item.bbox.y_max - item.bbox.y_min)
    ctx.strokeRect(x, y, w, h)
    ctx.setLineDash([])
    ctx.fillStyle = color
    ctx.font = selected ? 'bold 12px sans-serif' : '12px sans-serif'
    ctx.fillText(item.label, x + 2, Math.max(12, y - 4))
    ctx.restore()
  }
}
