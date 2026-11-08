import { describe, expect, it } from 'vitest'
import {
  applyHandleDrag,
  assertAnnotateViewAllowed,
  bboxValidForSave,
  clientToNativePixel,
  clampBBoxToImage,
  hitTestBBox,
  normalizeBBox,
  normalizeCardinalRotation,
} from './viewerCoords'

describe('viewerCoords', () => {
  it('accepts only cardinal rotations', () => {
    expect(normalizeCardinalRotation(90)).toBe(90)
    expect(normalizeCardinalRotation(-90)).toBe(270)
    expect(normalizeCardinalRotation(45)).toBeNull()
    expect(() => assertAnnotateViewAllowed({ panX: 0, panY: 0, zoom: 1, rotationDeg: 45, flipH: false, flipV: false })).toThrow(
      /cardinal/,
    )
  })

  it('maps center pointer to image center (identity view)', () => {
    const p = clientToNativePixel(100, 200, {
      originClientX: 100,
      originClientY: 200,
      contentWidth: 200,
      contentHeight: 100,
      cols: 400,
      rows: 200,
      panX: 0,
      panY: 0,
      zoom: 1,
      rotationDeg: 0,
      flipH: false,
      flipV: false,
    })
    expect(p.x).toBeCloseTo(200, 5)
    expect(p.y).toBeCloseTo(100, 5)
  })

  it('inverts pan so a shifted view still hits the same native pixel', () => {
    const cols = 100
    const rows = 100
    const layout = {
      originClientX: 50,
      originClientY: 50,
      contentWidth: 100,
      contentHeight: 100,
      cols,
      rows,
      panX: 20,
      panY: 0,
      zoom: 1,
      rotationDeg: 0 as const,
      flipH: false,
      flipV: false,
    }
    // Image (0,50) → local (-50,0); after pan+20 → screen offset -30 → clientX=20
    const p = clientToNativePixel(20, 50, layout)
    expect(p.x).toBeCloseTo(0, 5)
    expect(p.y).toBeCloseTo(50, 5)
  })

  it('inverts 180° rotation', () => {
    const p = clientToNativePixel(150, 50, {
      originClientX: 100,
      originClientY: 100,
      contentWidth: 100,
      contentHeight: 100,
      cols: 100,
      rows: 100,
      panX: 0,
      panY: 0,
      zoom: 1,
      rotationDeg: 180,
      flipH: false,
      flipV: false,
    })
    // client (150,50) → local (50,-50) → after inv 180 → (-50,50) → image (0, 100)
    expect(p.x).toBeCloseTo(0, 5)
    expect(p.y).toBeCloseTo(100, 5)
  })

  it('normalizes, clamps, validates bbox', () => {
    const box = normalizeBBox({ x: 40, y: 10 }, { x: 5, y: 30 })
    expect(box).toEqual({ x_min: 5, y_min: 10, x_max: 40, y_max: 30 })
    const clamped = clampBBoxToImage({ x_min: -5, y_min: 0, x_max: 999, y_max: 20 }, 100, 50)
    expect(clamped.x_min).toBe(0)
    expect(clamped.x_max).toBe(100)
    expect(bboxValidForSave(box, 100, 100)).toBe(true)
    expect(bboxValidForSave({ x_min: 1, y_min: 1, x_max: 2, y_max: 1.5 }, 100, 100)).toBe(false)
  })

  it('hit-tests handles and applies drag', () => {
    const box = { x_min: 10, y_min: 10, x_max: 50, y_max: 40 }
    expect(hitTestBBox(10, 10, box)).toBe('nw')
    expect(hitTestBBox(30, 25, box)).toBe('move')
    expect(hitTestBBox(0, 0, box)).toBeNull()
    expect(applyHandleDrag(box, 'move', 5, -2)).toEqual({
      x_min: 15,
      y_min: 8,
      x_max: 55,
      y_max: 38,
    })
  })
})
