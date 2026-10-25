import { describe, expect, it } from 'vitest'
import { selectCitedPassages } from '../components/RagCitations'
import type { BackendRagCitation } from '../types'

const passages: BackendRagCitation[] = [
  { source_id: 'a', title: 'A', section: 's', passage: 'p', score: 0.9 },
  { source_id: 'b', title: 'B', section: 's', passage: 'p', score: 0.8 },
  { source_id: 'c', title: 'C', section: 's', passage: 'p', score: 0.7 },
]

describe('selectCitedPassages', () => {
  it('filters to used_passage_ids when present', () => {
    const { cited, legacyAllRetrieved } = selectCitedPassages(passages, ['b'])
    expect(cited.map((p) => p.source_id)).toEqual(['b'])
    expect(legacyAllRetrieved).toBe(false)
  })

  it('legacy: shows all when used_passage_ids missing', () => {
    const { cited, legacyAllRetrieved } = selectCitedPassages(passages, null)
    expect(cited).toHaveLength(3)
    expect(legacyAllRetrieved).toBe(true)
  })
})
