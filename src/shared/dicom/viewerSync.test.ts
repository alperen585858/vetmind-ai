import { describe, expect, it } from 'vitest'
import { indexFor, measureDelta, positionOf, sameView } from './viewerSync'

describe('viewerSync', () => {
  it('maps slices by relative position between series of different length', () => {
    expect(positionOf(0, 20)).toBe(0)
    expect(positionOf(19, 20)).toBe(1)
    expect(indexFor(positionOf(10, 21), 11)).toBe(5)
    expect(indexFor(1, 11)).toBe(10)
    expect(indexFor(0.5, 1)).toBe(0)
    expect(positionOf(3, 1)).toBe(0)
    expect(indexFor(2, 5)).toBe(4) // clamped
  })

  it('a round trip does not drift away from the user slice', () => {
    // Panel A (30 slices) at 17 → panel B (12 slices) → back to A lands near 17.
    const b = indexFor(positionOf(17, 30), 12)
    expect(Math.abs(indexFor(positionOf(b, 12), 30) - 17)).toBeLessThanOrEqual(2)
  })

  it('compares views with a tolerance', () => {
    const v = { position: 0.5, zoom: 1, panX: 0, panY: 0, wc: 40, ww: 400 }
    expect(sameView(v, { ...v })).toBe(true)
    expect(sameView(v, { ...v, zoom: 1.1 })).toBe(false)
    expect(sameView(v, null)).toBe(false)
  })

  it('formats the measurement difference', () => {
    expect(measureDelta(14.2, 10)).toBe('+4.2 mm')
    expect(measureDelta(9, 10)).toBe('−1.0 mm')
    expect(measureDelta(10.02, 10)).toBe('0.0 mm')
    expect(measureDelta(null, 10)).toBeNull()
  })
})
