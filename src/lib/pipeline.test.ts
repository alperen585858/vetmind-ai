import { describe, expect, it } from 'vitest'
import {
  DEMO_FICTION_PREFIX,
  LAYERS,
  fictionLayerLogs,
  shouldShowFictionLayers,
} from './pipeline'
import type { VetCase } from '../types'

const stubCase = {
  documents: [],
  priority: 'normal',
  ai: { differentials: [], recommendedTests: [], validation: [] },
} as unknown as VetCase

describe('pipeline fiction vs backend', () => {
  it('marks every fiction log with DEMO FICTION prefix', () => {
    for (const layer of LAYERS) {
      for (const line of layer.logs(stubCase)) {
        expect(line.startsWith(DEMO_FICTION_PREFIX)).toBe(true)
      }
    }
  })

  it('exposes fiction layers only in local mode', () => {
    expect(shouldShowFictionLayers('local')).toBe(true)
    expect(shouldShowFictionLayers('backend')).toBe(false)
    expect(fictionLayerLogs(stubCase, 'backend')).toEqual([])
    expect(fictionLayerLogs(stubCase, 'local').length).toBeGreaterThan(0)
  })

  it('rag fiction still mentions Qdrant but as not-backend', () => {
    const rag = LAYERS.find((l) => l.key === 'rag')!
    const joined = rag.logs(stubCase).join('\n')
    expect(joined).toContain('DEMO FICTION')
    expect(joined).toContain('Qdrant yok')
  })
})
