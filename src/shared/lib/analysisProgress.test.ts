import { describe, expect, it } from 'vitest'
import { displayAnalysisProgress, estimateAnalysisDurationMs } from './analysisProgress'

describe('analysisProgress', () => {
  it('estimates longer duration for more instances', () => {
    expect(estimateAnalysisDurationMs(33)).toBeGreaterThan(estimateAnalysisDurationMs(2))
  })

  it('returns 100 when completed', () => {
    expect(
      displayAnalysisProgress({
        backendPct: 40,
        startedAtMs: Date.now() - 1000,
        estimatedMs: 60_000,
        status: 'completed',
      }),
    ).toBe(100)
  })

  it('never reaches 100 while running', () => {
    const pct = displayAnalysisProgress({
      backendPct: 10,
      startedAtMs: Date.now() - 120_000,
      estimatedMs: 60_000,
      status: 'running',
      nowMs: Date.now(),
    })
    expect(pct).toBeLessThan(100)
    expect(pct).toBeGreaterThanOrEqual(10)
  })

  it('uses backend pct as a floor', () => {
    const pct = displayAnalysisProgress({
      backendPct: 72,
      startedAtMs: Date.now(),
      estimatedMs: 120_000,
      status: 'running',
      nowMs: Date.now(),
    })
    expect(pct).toBeGreaterThanOrEqual(72)
  })
})
