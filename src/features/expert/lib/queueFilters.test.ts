import { describe, expect, it } from 'vitest'
import { summaryToVetCase } from '../../../shared/lib/caseMapper'
import type { BackendCaseSummary } from '../../../shared/types'
import { isUrgentCase, sortWorklist } from '../ExpertWorklistTable'
import { matchesSearch, viewFromParams } from './queueFilters'

// #133: radiologist worklist logic (search, tabs from the URL, ordering).
const row = (o: Partial<BackendCaseSummary> & { case_id: string }) =>
  summaryToVetCase({
    patient_name: 'Pax',
    species: 'canine',
    modality: 'MR',
    anatomical_region: 'CERVICAL',
    status: 'awaiting_review',
    created_at: '2026-11-20T10:00:00Z',
    ...o,
  } as BackendCaseSummary)

describe('viewFromParams', () => {
  it('maps the shareable URL flags to a tab', () => {
    expect(viewFromParams(new URLSearchParams(''))).toBe('all')
    expect(viewFromParams(new URLSearchParams('acil=1'))).toBe('urgent')
    expect(viewFromParams(new URLSearchParams('sla=az'))).toBe('sla')
    expect(viewFromParams(new URLSearchParams('bana=1'))).toBe('mine')
    expect(viewFromParams(new URLSearchParams('acil=0'))).toBe('all')
  })
})

describe('matchesSearch', () => {
  const c = row({ case_id: 'case-abc123', patient_name: 'Karamel', breed: 'Golden Retriever', referring_clinic: 'Moda Vet' })
  it('finds patient, breed, clinic and case number, case-insensitively', () => {
    expect(matchesSearch(c, '')).toBe(true)
    expect(matchesSearch(c, 'karamel')).toBe(true)
    expect(matchesSearch(c, 'golden')).toBe(true)
    expect(matchesSearch(c, 'moda')).toBe(true)
    expect(matchesSearch(c, c.no.toLocaleLowerCase('tr'))).toBe(true)
    expect(matchesSearch(c, 'pamuk')).toBe(false)
  })
})

describe('worklist order', () => {
  it('urgent cases first, then the newest arrival on top', () => {
    const oldNormal = row({ case_id: 'case-old', created_at: '2026-11-01T10:00:00Z' })
    const newNormal = row({ case_id: 'case-new', created_at: '2026-11-25T10:00:00Z' })
    const stat = row({ case_id: 'case-stat', created_at: '2026-10-01T10:00:00Z', priority: 'stat' })
    const sorted = sortWorklist([oldNormal, newNormal, stat])
    expect(sorted.map((c) => c.id)).toEqual(['case-stat', 'case-new', 'case-old'])
    expect(isUrgentCase(stat)).toBe(true)
    expect(isUrgentCase(newNormal)).toBe(false)
  })

  it('"urgent" order puts the least time left on top within a priority', () => {
    const later = row({ case_id: 'case-later', review_due_at: '2026-12-01T10:00:00Z' })
    const sooner = row({ case_id: 'case-sooner', review_due_at: '2026-11-29T10:00:00Z' })
    expect(sortWorklist([later, sooner], 'urgent').map((c) => c.id)).toEqual(['case-sooner', 'case-later'])
  })
})
