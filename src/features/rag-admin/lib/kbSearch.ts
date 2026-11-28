import type { RagCustomDocument } from '../../../shared/api'
import { today } from '../../../shared/lib/format'
import type { KbSource } from '../../../shared/types'

export interface Hit {
  source: KbSource
  score: number
  backend?: boolean
}

/** Offline keyword search over the demo sources (used when the RAG API is unreachable). */
export function localSearch(q: string, sources: KbSource[]): Hit[] {
  const tokens = q.toLocaleLowerCase('tr').split(/[\s,.;:?!]+/).filter((t) => t.length >= 2)
  return sources
    .filter((s) => !s.indexing)
    .map((s) => {
      const hay = `${s.title} ${s.section} ${s.passage} ${s.keywords.join(' ')}`.toLocaleLowerCase('tr')
      const hits = tokens.filter((t) => hay.includes(t)).length
      const jitter = ((s.id * 13) % 7) / 100
      const score = hits ? Math.min(0.97, 0.7 + 0.07 * hits + jitter) : 0.41 + ((s.id * 17) % 22) / 100
      return { source: s, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
}

// Type and license have no backend field; they travel in the section as "Tür · Lisans".
export function fromBackendDoc(d: RagCustomDocument, i: number): KbSource {
  const [type, license] = d.section.split(' · ')
  return {
    id: 20_000 + i,
    title: d.title,
    type: (['Kitap', 'Bilimsel yayın', 'VRM örnek rapor'].includes(type) ? type : 'Bilimsel yayın') as KbSource['type'],
    license: license === 'İzinli' ? 'İzinli' : 'Beklemede',
    section: 'Eklenen kaynak',
    passage: d.passage,
    chunks: d.chunks ?? 1,
    indexedAt: today(),
    keywords: d.keywords,
    ragApproved: Boolean(d.approved),
    backendId: d.source_id,
    regions: d.regions ?? [],
    species: d.species ?? [],
    tagSource: d.tag_source ?? '',
  }
}

export function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
