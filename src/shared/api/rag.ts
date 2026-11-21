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

export interface RagCustomDocument {
  source_id: string
  title: string
  section: string
  passage: string
  keywords: string[]
  approved?: boolean
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
}): Promise<{
  source_id: string
  title: string
  section: string
  count: number
  approved?: boolean
}> {
  return request('/rag/documents', { method: 'POST', body: JSON.stringify(input) })
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
