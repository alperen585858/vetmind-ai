import { describe, expect, it } from 'vitest'
import { classifyVhs, computeVhs, distance, vhsSpeciesFrom, type Point } from './vhs'

// Spine T4→T8 = 400 px → one vertebra = 100 px.
const spine: Point[] = [
  { x: 100, y: 100 },
  { x: 500, y: 100 },
]

function points(longPx: number, shortPx: number): Point[] {
  return [
    { x: 300, y: 200 },
    { x: 300, y: 200 + longPx }, // long axis vertical
    { x: 250, y: 300 },
    { x: 250 + shortPx, y: 300 }, // short axis horizontal (perpendicular)
    ...spine,
  ]
}

describe('computeVhs', () => {
  it('VHS equals the sum of the displayed (rounded) axes', () => {
    // 266 px + 286 px with 100 px vertebrae: 2.66 + 2.86 = 5.52 would show "5.5" next to "2.7 + 2.9".
    const r = computeVhs(points(266, 286), 'canine')!
    expect([r.longV, r.shortV, r.vhs]).toEqual([2.7, 2.9, 5.6])
  })

  it('needs all six points', () => {
    expect(computeVhs(points(550, 450).slice(0, 5), 'canine')).toBeNull()
  })

  it('computes VHS in vertebrae and classifies a normal dog heart', () => {
    const r = computeVhs(points(550, 450), 'canine')!
    expect(r.longV).toBe(5.5)
    expect(r.shortV).toBe(4.5)
    expect(r.vhs).toBe(10)
    expect(r.category).toBe('normal')
    expect(r.axisAngleDeg).toBe(90)
    expect(r.notPerpendicular).toBe(false)
    expect(r.calibrated).toBe(false)
  })

  it('flags an enlarged dog heart and a small one', () => {
    expect(computeVhs(points(650, 500), 'canine')!.category).toBe('large') // 11.5
    expect(computeVhs(points(450, 350), 'canine')!.category).toBe('small') // 8.0
  })

  it('uses feline reference ranges', () => {
    expect(computeVhs(points(420, 330), 'feline')!.category).toBe('normal') // 7.5
    expect(computeVhs(points(480, 380), 'feline')!.category).toBe('large') // 8.6
  })

  it('warns when the short axis is not perpendicular to the long axis', () => {
    const p = points(550, 450)
    p[3] = { x: 250 + 300, y: 300 + 300 } // 45° diagonal
    const r = computeVhs(p, 'canine')!
    expect(r.notPerpendicular).toBe(true)
  })

  it('returns null for a zero-length spine scale', () => {
    const p = points(550, 450)
    p[5] = { ...p[4]! }
    expect(computeVhs(p, 'canine')).toBeNull()
  })

  it('accounts for non-square pixel spacing', () => {
    // 1 px tall = 2 mm, 1 px wide = 1 mm: a vertical 100 px line is 200 mm.
    expect(distance({ x: 0, y: 0 }, { x: 0, y: 100 }, [2, 1])).toBe(200)
    expect(distance({ x: 0, y: 0 }, { x: 100, y: 0 }, [2, 1])).toBe(100)
  })

  it('has no category for other species', () => {
    expect(classifyVhs(10, 'other')).toBe('unknown')
    expect(vhsSpeciesFrom('Köpek')).toBe('canine')
    expect(vhsSpeciesFrom('feline')).toBe('feline')
    expect(vhsSpeciesFrom('Diğer')).toBe('other')
  })
})
