import { describe, expect, it } from 'vitest'
import { taskPath, taskProgress, type AnalysisTask } from './analysisTasks'

const base: AnalysisTask = {
  key: 'pending-abc',
  pendingId: 'pending-abc',
  patientName: 'Pax',
  phase: 'uploading',
  startedAt: 1_000,
  estimatedMs: 60_000,
}

describe('analysis tasks', () => {
  it('links to the pending page until the case exists, then to the case', () => {
    expect(taskPath(base)).toBe('/vakalar/pending-abc/isleme')
    expect(taskPath({ ...base, caseId: 'case-1', phase: 'analyzing' })).toBe('/vakalar/case-1/isleme')
  })

  it('shows early progress while uploading and queuing, never 100 before done', () => {
    expect(taskProgress(base, 1_000)).toBeGreaterThan(0)
    expect(taskProgress(base, 60_000)).toBeLessThanOrEqual(18)
    expect(taskProgress({ ...base, phase: 'queuing' }, 60_000)).toBeLessThanOrEqual(28)
    const running = { ...base, phase: 'analyzing' as const, jobStatus: 'running', backendPct: 40 }
    expect(taskProgress(running, 2_000)).toBeGreaterThanOrEqual(40)
    expect(taskProgress(running, 10_000_000)).toBeLessThan(100)
    expect(taskProgress({ ...base, phase: 'completed' })).toBe(100)
  })
})
