import { describe, expect, it } from 'vitest'
import type { RagCustomDocument } from '../../shared/api'
import type { KbSource } from '../../shared/types'
import { KB_SOURCES, getKbSources, kbLicenseLabel, kbTypeLabel } from './demoKb'
import { fromBackendDoc, localSearch } from './kbSearch'

function source(id: number, extra: Partial<KbSource> = {}): KbSource {
  return {
    id,
    title: `Kaynak ${id}`,
    type: 'Kitap',
    section: 'Bölüm',
    passage: 'Genel metin',
    license: 'İzinli',
    chunks: 1,
    indexedAt: '2026-11-01',
    keywords: [],
    ...extra,
  }
}

describe('localSearch', () => {
  it('ranks sources that match the query above the rest and returns at most five', () => {
    const sources = [
      ...Array.from({ length: 6 }, (_, i) => source(i + 1)),
      source(42, { passage: 'Dachshund disk ekstrüzyonu', keywords: ['ivdd'] }),
    ]
    const hits = localSearch('dachshund disk', sources)
    expect(hits).toHaveLength(5)
    expect(hits[0].source.id).toBe(42)
    expect(hits[0].score).toBeGreaterThan(0.7)
    expect(hits[0].score).toBeLessThanOrEqual(0.97)
  })

  it('skips sources that are still indexing', () => {
    const hits = localSearch('dachshund', [source(1, { passage: 'Dachshund', indexing: true }), source(2)])
    expect(hits.map((h) => h.source.id)).toEqual([2])
  })

  it('returns nothing for an empty source list', () => {
    expect(localSearch('herhangi', [])).toEqual([])
  })
})

describe('fromBackendDoc', () => {
  const doc = {
    source_id: 'src-1',
    title: 'Yeni makale',
    section: 'Kitap · İzinli',
    passage: 'Metin',
    keywords: ['a'],
    chunks: 3,
    approved: true,
    regions: ['BRAIN'],
    species: ['canine'],
    tag_source: 'rules',
  } as unknown as RagCustomDocument

  it('reads type and license from the section and keeps the backend fields', () => {
    const s = fromBackendDoc(doc, 2)
    expect(s).toMatchObject({
      id: 20_002,
      type: 'Kitap',
      license: 'İzinli',
      chunks: 3,
      ragApproved: true,
      backendId: 'src-1',
      regions: ['BRAIN'],
      tagSource: 'rules',
    })
  })

  it('falls back to a pending journal article for unknown section text', () => {
    const s = fromBackendDoc({ ...doc, section: 'serbest metin', chunks: undefined } as unknown as RagCustomDocument, 0)
    expect(s.type).toBe('Bilimsel yayın')
    expect(s.license).toBe('Beklemede')
    expect(s.chunks).toBe(1)
  })
})

describe('demo KB labels', () => {
  it('translates type and license labels only for English', () => {
    expect(kbTypeLabel('Kitap', 'en')).toBe('Book')
    expect(kbTypeLabel('Kitap', 'tr')).toBe('Kitap')
    expect(kbLicenseLabel('Beklemede', 'en')).toBe('Pending')
  })

  it('applies English titles when present and leaves Turkish sources untouched', () => {
    expect(getKbSources('tr')).toBe(KB_SOURCES)
    const en = getKbSources('en', [source(1, { titleEn: 'Source one' })])
    expect(en[0].title).toBe('Source one')
  })
})
