/**
 * Side-by-side comparison sync (issue #108). Two studies rarely have the same number of
 * slices, so slices are matched by *relative* position (0 = first, 1 = last).
 */
export type ViewSyncState = {
  /** Relative slice position 0..1. */
  position: number
  zoom: number
  panX: number
  panY: number
  wc: number
  ww: number
}

export function positionOf(index: number, count: number): number {
  if (count <= 1) return 0
  return Math.min(1, Math.max(0, index / (count - 1)))
}

export function indexFor(position: number, count: number): number {
  if (count <= 1) return 0
  return Math.min(count - 1, Math.max(0, Math.round(position * (count - 1))))
}

const EPS = 1e-6

export function sameView(a: ViewSyncState | null | undefined, b: ViewSyncState | null | undefined): boolean {
  if (!a || !b) return false
  return (
    Math.abs(a.position - b.position) < EPS &&
    Math.abs(a.zoom - b.zoom) < EPS &&
    Math.abs(a.panX - b.panX) < EPS &&
    Math.abs(a.panY - b.panY) < EPS &&
    Math.abs(a.wc - b.wc) < EPS &&
    Math.abs(a.ww - b.ww) < EPS
  )
}

/** "+4.2 mm" / "−1.0 mm" / "0.0 mm" between the current and the prior measurement. */
export function measureDelta(currentMm: number | null, priorMm: number | null): string | null {
  if (currentMm == null || priorMm == null) return null
  const d = currentMm - priorMm
  const sign = d > 0.05 ? '+' : d < -0.05 ? '−' : ''
  return `${sign}${Math.abs(d).toFixed(1)} mm`
}
