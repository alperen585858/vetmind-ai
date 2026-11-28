import { describe, expect, it } from 'vitest'
import { KB_SOURCES } from '../demoKb'
import { fromBackendDoc, localSearch, toggle } from './kbSearch'

// #133: knowledge base offline search and backend document mapping.
describe('localSearch', () => {
  it('ranks the source that matches the query first, at most five hits', () => {
    const hits = localSearch('Dachshund disk ekstrüzyonu', KB_SOURCES)
    expect(hits.length).toBeLessThanOrEqual(5)
    expect(hits[0].source.keywords).toContain('dachshund')
    expect(hits[0].score).toBeGreaterThan(hits[hits.length - 1].score)
  })

  it('skips sources that are still indexing and returns nothing for an empty list', () => {
    const indexing = KB_SOURCES.map((s) => ({ ...s, indexing: true }))
    expect(localSearch('disk', indexing)).toEqual([])
    expect(localSearch('disk', [])).toEqual([])
  })
})

describe('fromBackendDoc', () => {
  it('reads type and license from the section and keeps the scope tags', () => {
    const s = fromBackendDoc(
      {
        source_id: 'custom-1', title: 'Yeni kaynak', section: 'Kitap · İzinli', passage: 'p', keywords: ['k'],
        approved: true, chunks: 3, regions: ['CERVICAL'], species: ['canine'], tag_source: 'manual',
      } as never,
      2,
    )
    expect(s).toMatchObject({ id: 20_002, type: 'Kitap', license: 'İzinli', chunks: 3, ragApproved: true, backendId: 'custom-1' })
    expect(s.regions).toEqual(['CERVICAL'])
    const unknown = fromBackendDoc({ source_id: 'c2', title: 't', section: 'Blog', passage: '', keywords: [] } as never, 0)
    expect(unknown).toMatchObject({ type: 'Bilimsel yayın', license: 'Beklemede', chunks: 1, ragApproved: false })
  })
})

it('toggle adds or removes a value', () => {
  expect(toggle(['a'], 'b')).toEqual(['a', 'b'])
  expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
})
