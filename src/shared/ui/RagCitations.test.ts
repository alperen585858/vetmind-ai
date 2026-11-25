import { describe, expect, it } from 'vitest'
import { findingName, relatedFindingNames, selectCitedPassages } from './RagCitations'
import type { BackendFinding, BackendRagCitation } from '../types'

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

const finding = (id: string, description: string, code = 'MOCK_DISC_EXTRUSION') =>
  ({ finding_id: id, finding_code: code, description }) as BackendFinding

describe('finding names for cited passages (#76)', () => {
  it('uses the first sentence of the description, without demo prefixes', () => {
    expect(findingName(finding('f1', 'SENTETİK DEMO BULGU: T13–L1 disk materyali ve omurilik basısı. Ventral yerleşimli.'))).toBe(
      'T13–L1 disk materyali ve omurilik basısı',
    )
  })

  it('falls back to the cleaned code and shortens long text', () => {
    expect(findingName(finding('f1', ''))).toBe('DISC-EXTRUSION')
    const long = findingName(finding('f1', 'a'.repeat(200)))
    expect(long.length).toBeLessThanOrEqual(90)
    expect(long.endsWith('…')).toBe(true)
  })

  it('maps ids to names and drops ids that match no finding', () => {
    const findings = [finding('case-1-f-tl-01', 'Disk ekstrüzyonu.'), finding('case-1-f-tl-02', 'Omurilik ödemi.')]
    expect(relatedFindingNames(['case-1-f-tl-02', 'case-1-f-tl-01', 'unknown'], findings)).toEqual([
      'Omurilik ödemi',
      'Disk ekstrüzyonu',
    ])
    expect(relatedFindingNames(['unknown'], findings)).toEqual([])
    expect(relatedFindingNames(['case-1-f-tl-01'], undefined)).toEqual([])
  })
})
