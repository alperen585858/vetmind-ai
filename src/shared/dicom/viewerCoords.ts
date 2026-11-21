/** CSS viewer transform ↔ native DICOM pixel coords (P1.7). Cardinal rotate only. */

export type CardinalRotation = 0 | 90 | 180 | 270

export type ViewerViewState = {
  panX: number
  panY: number
  zoom: number
  rotationDeg: number
  flipH: boolean
  flipV: boolean
}

export type NativeBBox = {
  x_min: number
  y_min: number
  x_max: number
  y_max: number
}

export function normalizeCardinalRotation(deg: number): CardinalRotation | null {
  const n = ((Math.round(deg) % 360) + 360) % 360
  if (n === 0 || n === 90 || n === 180 || n === 270) return n
  return null
}

export function assertAnnotateViewAllowed(view: ViewerViewState): CardinalRotation {
  const rot = normalizeCardinalRotation(view.rotationDeg)
  if (rot === null) {
    throw new Error('Annotate requires cardinal rotation (0/90/180/270).')
  }
  if (!Number.isFinite(view.zoom) || view.zoom <= 0) {
    throw new Error('Annotate requires a positive zoom.')
  }
  return rot
}

function rotateVec(x: number, y: number, deg: CardinalRotation): { x: number; y: number } {
  switch (deg) {
    case 0:
      return { x, y }
    case 90:
      return { x: -y, y: x }
    case 180:
      return { x: -x, y: -y }
    case 270:
      return { x: y, y: -x }
  }
}

/**
 * Map a pointer (client coords) to native image pixels.
 * Matches CSS: translate(pan) scale(zoom) rotate(rot) scaleX/Y(flip), origin center.
 */
export function clientToNativePixel(
  clientX: number,
  clientY: number,
  layout: {
    /** Untransformed content-box center in the viewport (flex-centered viewport mid). */
    originClientX: number
    originClientY: number
    contentWidth: number
    contentHeight: number
    cols: number
    rows: number
  } & ViewerViewState,
): { x: number; y: number } {
  const rot = assertAnnotateViewAllowed(layout)
  const w = Math.max(1, layout.contentWidth)
  const h = Math.max(1, layout.contentHeight)
  let x = clientX - layout.originClientX
  let y = clientY - layout.originClientY
  x -= layout.panX
  y -= layout.panY
  x /= layout.zoom
  y /= layout.zoom
  // Inverse rotate (apply -rot)
  const invRot = ((360 - rot) % 360) as CardinalRotation
  ;({ x, y } = rotateVec(x, y, invRot))
  // Inverse flip (applied first in forward chain → last in inverse)
  if (layout.flipH) x = -x
  if (layout.flipV) y = -y
  const imgX = ((x + w / 2) / w) * layout.cols
  const imgY = ((y + h / 2) / h) * layout.rows
  return { x: imgX, y: imgY }
}

/** Legacy AABB mapping — correct when rotation is 0 (flip/zoom/pan via transformed rect). */
export function clientToNativeViaRect(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  cols: number,
  rows: number,
): { x: number; y: number } {
  const x = ((clientX - rect.left) / Math.max(1, rect.width)) * cols
  const y = ((clientY - rect.top) / Math.max(1, rect.height)) * rows
  return { x, y }
}

export function normalizeBBox(a: { x: number; y: number }, b: { x: number; y: number }): NativeBBox {
  return {
    x_min: Math.min(a.x, b.x),
    y_min: Math.min(a.y, b.y),
    x_max: Math.max(a.x, b.x),
    y_max: Math.max(a.y, b.y),
  }
}

export function clampBBoxToImage(box: NativeBBox, cols: number, rows: number): NativeBBox {
  const x_min = Math.max(0, Math.min(cols - 1, box.x_min))
  const y_min = Math.max(0, Math.min(rows - 1, box.y_min))
  const x_max = Math.max(0, Math.min(cols, box.x_max))
  const y_max = Math.max(0, Math.min(rows, box.y_max))
  return {
    x_min,
    y_min,
    x_max: Math.max(x_min + 1, x_max),
    y_max: Math.max(y_min + 1, y_max),
  }
}

export function bboxArea(box: NativeBBox): number {
  return Math.max(0, box.x_max - box.x_min) * Math.max(0, box.y_max - box.y_min)
}

export function bboxValidForSave(box: NativeBBox, cols: number, rows: number, minSide = 2): boolean {
  if (![box.x_min, box.y_min, box.x_max, box.y_max].every(Number.isFinite)) return false
  if (box.x_max - box.x_min < minSide || box.y_max - box.y_min < minSide) return false
  if (box.x_min < -0.5 || box.y_min < -0.5) return false
  if (box.x_max > cols + 0.5 || box.y_max > rows + 0.5) return false
  return true
}

export type HitHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

export function hitTestBBox(
  px: number,
  py: number,
  box: NativeBBox,
  handlePx = 8,
): HitHandle | null {
  const { x_min, y_min, x_max, y_max } = box
  const corners: [HitHandle, number, number][] = [
    ['nw', x_min, y_min],
    ['ne', x_max, y_min],
    ['sw', x_min, y_max],
    ['se', x_max, y_max],
  ]
  for (const [name, cx, cy] of corners) {
    if (Math.hypot(px - cx, py - cy) <= handlePx) return name
  }
  if (px >= x_min && px <= x_max && py >= y_min && py <= y_max) return 'move'
  return null
}

export function applyHandleDrag(
  start: NativeBBox,
  handle: HitHandle,
  dx: number,
  dy: number,
): NativeBBox {
  if (handle === 'move') {
    return {
      x_min: start.x_min + dx,
      y_min: start.y_min + dy,
      x_max: start.x_max + dx,
      y_max: start.y_max + dy,
    }
  }
  let { x_min, y_min, x_max, y_max } = start
  if (handle.includes('n')) y_min += dy
  if (handle.includes('s')) y_max += dy
  if (handle.includes('w')) x_min += dx
  if (handle.includes('e')) x_max += dx
  return normalizeBBox({ x: x_min, y: y_min }, { x: x_max, y: y_max })
}
