export interface BackendRagCitation {
  source_id: string
  title: string
  section: string
  passage: string
  score: number
  keywords?: string[]
  related_finding_ids?: string[]
}

export interface KbSource {
  id: number
  title: string
  /** English demo title when UI locale is en */
  titleEn?: string
  type: 'Kitap' | 'Bilimsel yayın' | 'VRM örnek rapor'
  section: string
  sectionEn?: string
  passage: string
  passageEn?: string
  license: 'İzinli' | 'Beklemede'
  chunks: number
  indexedAt: string
  keywords: string[]
  indexing?: boolean
  /** Backend custom RAG doc only; seed mock sources omit this. */
  ragApproved?: boolean
}
