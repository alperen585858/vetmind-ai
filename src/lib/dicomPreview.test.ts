import { describe, expect, it } from 'vitest'
import {
  frameSortKey,
  groupFramesBySeries,
  roiStats,
  sortFramesSpatially,
  type DicomFramePreview,
} from './dicomPreview'

function frame(partial: Partial<DicomFramePreview> & { fileName: string }): DicomFramePreview {
  return {
    ok: true,
    rows: 4,
    cols: 4,
    pixels: Float32Array.from({ length: 16 }, (_, i) => i),
    ...partial,
  }
}

describe('sortFramesSpatially', () => {
  it('orders by ImagePositionPatient Z when present', () => {
    const frames = [
      frame({ fileName: 'a.dcm', sopInstanceUid: '1', imagePositionPatient: [0, 0, 10], instanceNumber: 99 }),
      frame({ fileName: 'b.dcm', sopInstanceUid: '2', imagePositionPatient: [0, 0, 2], instanceNumber: 1 }),
      frame({ fileName: 'c.dcm', sopInstanceUid: '3', imagePositionPatient: [0, 0, 5], instanceNumber: 50 }),
    ]
    const sorted = sortFramesSpatially(frames)
    expect(sorted.map((f) => f.fileName)).toEqual(['b.dcm', 'c.dcm', 'a.dcm'])
  })

  it('falls back to InstanceNumber without inventing IPP', () => {
    const frames = [
      frame({ fileName: 'a.dcm', instanceNumber: 3 }),
      frame({ fileName: 'b.dcm', instanceNumber: 1 }),
    ]
    expect(sortFramesSpatially(frames).map((f) => f.fileName)).toEqual(['b.dcm', 'a.dcm'])
    expect(frameSortKey(frames[0]!)[0]).toBe(2)
  })
})

describe('groupFramesBySeries', () => {
  it('groups by series UID and keeps spatial order inside series', () => {
    const frames = [
      frame({
        fileName: 's1b.dcm',
        seriesInstanceUid: 'ser-1',
        seriesDescription: 'T2',
        imagePositionPatient: [0, 0, 4],
      }),
      frame({
        fileName: 's2.dcm',
        seriesInstanceUid: 'ser-2',
        seriesDescription: 'T1',
        imagePositionPatient: [0, 0, 1],
      }),
      frame({
        fileName: 's1a.dcm',
        seriesInstanceUid: 'ser-1',
        seriesDescription: 'T2',
        imagePositionPatient: [0, 0, 1],
      }),
    ]
    const groups = groupFramesBySeries(frames)
    expect(groups).toHaveLength(2)
    const t2 = groups.find((g) => g.key === 'ser-1')!
    expect(t2.frames.map((f) => f.fileName)).toEqual(['s1a.dcm', 's1b.dcm'])
  })
})

describe('roiStats', () => {
  it('computes mean/min/max over ROI without inventing calibration', () => {
    const pixels = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const f = frame({ fileName: 'r.dcm', rows: 3, cols: 3, pixels })
    const stats = roiStats(f, 0, 0, 1, 1)
    expect(stats).not.toBeNull()
    expect(stats!.count).toBe(4)
    expect(stats!.min).toBe(1)
    expect(stats!.max).toBe(5)
    expect(stats!.mean).toBeCloseTo(3)
  })
})
