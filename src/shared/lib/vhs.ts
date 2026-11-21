/**
 * Vertebral Heart Score (VHS, Buchanan) from six points clicked on a lateral thoracic radiograph.
 *
 * Points, in click order (native image pixels):
 *   1–2  long axis:  ventral edge of the left mainstem bronchus (carina) → cardiac apex
 *   3–4  short axis: widest part of the heart, perpendicular to the long axis
 *   5–6  spine scale: cranial edge of T4 → cranial edge of T8 (= 4 vertebral bodies)
 *
 * VHS = (long + short) / mean vertebral length, in "vertebrae" (v). Using the mean of
 * T4–T7 instead of counting each vertebra is a common simplification; the result is
 * a measurement aid for the radiologist, not a diagnosis.
 */

export type Point = { x: number; y: number }
export type VhsSpecies = 'canine' | 'feline' | 'other'
export type VhsCategory = 'small' | 'normal' | 'large' | 'unknown'

export const VHS_POINT_COUNT = 6
/** Vertebral bodies between the cranial edges of T4 and T8. */
export const VHS_VERTEBRAE_SPAN = 4

/** Commonly cited reference ranges (breed-dependent; e.g. brachycephalics run higher). */
export const VHS_REFERENCE: Record<'canine' | 'feline', { min: number; max: number }> = {
  canine: { min: 8.5, max: 10.5 },
  feline: { min: 6.9, max: 8.1 },
}

export const VHS_STEP_KEYS = [
  'longStart',
  'longEnd',
  'shortStart',
  'shortEnd',
  'spineStart',
  'spineEnd',
] as const

export type VhsResult = {
  vhs: number
  longV: number
  shortV: number
  category: VhsCategory
  reference: { min: number; max: number } | null
  /** Angle between long and short axis; ideally 90°. */
  axisAngleDeg: number
  /** True when the short axis is more than 15° off perpendicular. */
  notPerpendicular: boolean
  calibrated: boolean
}

/** Distance in mm when pixel spacing is known (handles non-square pixels), else in pixels. */
export function distance(a: Point, b: Point, spacingMm?: [number, number]): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (spacingMm) {
    const [rowMm, colMm] = spacingMm
    return Math.hypot(dx * colMm, dy * rowMm)
  }
  return Math.hypot(dx, dy)
}

function axisAngleDeg(a: Point, b: Point, c: Point, d: Point): number {
  const v1x = b.x - a.x
  const v1y = b.y - a.y
  const v2x = d.x - c.x
  const v2y = d.y - c.y
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y)
  if (n < 1e-9) return 0
  const cos = Math.abs((v1x * v2x + v1y * v2y) / n)
  return (Math.acos(Math.min(1, cos)) * 180) / Math.PI
}

export function classifyVhs(vhs: number, species: VhsSpecies): VhsCategory {
  if (species !== 'canine' && species !== 'feline') return 'unknown'
  const ref = VHS_REFERENCE[species]
  if (vhs < ref.min) return 'small'
  if (vhs > ref.max) return 'large'
  return 'normal'
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Null until all six points are placed or when the spine scale is degenerate. */
export function computeVhs(points: Point[], species: VhsSpecies, spacingMm?: [number, number]): VhsResult | null {
  if (points.length < VHS_POINT_COUNT) return null
  const [a, b, c, d, t4, t8] = points as [Point, Point, Point, Point, Point, Point]
  const vertebra = distance(t4, t8, spacingMm) / VHS_VERTEBRAE_SPAN
  if (vertebra < 1e-6) return null
  const longV = round1(distance(a, b, spacingMm) / vertebra)
  const shortV = round1(distance(c, d, spacingMm) / vertebra)
  // Sum of the displayed (rounded) parts, so "long + short" always adds up on screen.
  const vhs = round1(longV + shortV)
  const angle = axisAngleDeg(a, b, c, d)
  return {
    vhs,
    longV,
    shortV,
    category: classifyVhs(vhs, species),
    reference: species === 'canine' || species === 'feline' ? VHS_REFERENCE[species] : null,
    axisAngleDeg: Math.round(angle),
    notPerpendicular: Math.abs(90 - angle) > 15,
    calibrated: Boolean(spacingMm),
  }
}

/** UI species ("Köpek" / "Kedi" / backend enum) → VHS species. */
export function vhsSpeciesFrom(value?: string | null): VhsSpecies {
  const v = (value || '').toLocaleLowerCase('tr')
  if (v === 'canine' || v.startsWith('köpek') || v === 'dog') return 'canine'
  if (v === 'feline' || v.startsWith('kedi') || v === 'cat') return 'feline'
  return 'other'
}
