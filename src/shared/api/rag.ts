import { request } from './client'

export async function searchRag(query: string, topK = 5): Promise<{
  query: string
  hits: { source_id: string; title: string; section: string; passage: string; score: number }[]
  method: string
  note: string
}> {
  const params = new URLSearchParams({ q: query, top_k: String(topK) })
  return request(`/rag/search?${params.toString()}`)
}

/** Region tags a knowledge-base source can be scoped to (backend app/rag/source_cards.py). */
export const RAG_DOC_REGIONS = ['BRAIN', 'SKULL', 'CERVICAL', 'SPINE', 'SPINE_TL', 'THORAX'] as const
export type RagDocRegion = (typeof RAG_DOC_REGIONS)[number]
export const RAG_DOC_SPECIES = ['canine', 'feline'] as const
export type RagDocSpecies = (typeof RAG_DOC_SPECIES)[number]

/** Where a source's scope came from; '' = uploaded before scopes existed. */
export type RagTagSource = 'seed' | 'manual' | 'rules' | 'llm' | 'none' | ''

export interface RagCustomDocument {
  source_id: string
  title: string
  section: string
  passage: string
  keywords: string[]
  approved?: boolean
  regions?: string[]
  species?: string[]
  summary?: string
  tag_source?: RagTagSource
  /** Number of retrieval chunks the source was split into (#100). */
  chunks?: number
}

/** Sources added from Bilgi Tabanı (seed corpus excluded). */
export async function listCustomRagDocuments(): Promise<RagCustomDocument[]> {
  return request('/rag/documents')
}

export async function addRagDocument(input: {
  title: string
  section: string
  passage: string
  approved?: boolean
  /** Omit to let the backend detect the scope from the text. */
  regions?: RagDocRegion[]
  species?: RagDocSpecies[]
}): Promise<{
  source_id: string
  title: string
  section: string
  count: number
  approved?: boolean
  regions?: string[]
  species?: string[]
  summary?: string
  tag_source?: RagTagSource
}> {
  return request('/rag/documents', { method: 'POST', body: JSON.stringify(input) })
}

/** Admin correction of an uploaded source's scope. */
export async function updateRagDocumentCard(
  sourceId: string,
  card: { regions: RagDocRegion[]; species: RagDocSpecies[] },
): Promise<RagCustomDocument> {
  return request(`/rag/documents/${encodeURIComponent(sourceId)}/card`, {
    method: 'PUT',
    body: JSON.stringify(card),
  })
}

/** Re-detect the scope of uploaded sources (manual scopes are kept). */
export async function retagRagDocuments(): Promise<{ retagged: number; skipped_manual: number; uses_llm: boolean }> {
  return request('/rag/documents/retag', { method: 'POST' })
}

export async function bulkRagDocuments(
  documents: {
    title: string
    section: string
    passage: string
    keywords?: string[]
    approved?: boolean
    source_id?: string
  }[],
): Promise<{ added: number; source_ids: string[]; count: number; note: string }> {
  return request('/rag/documents/bulk', {
    method: 'POST',
    body: JSON.stringify({ documents }),
  })
}
