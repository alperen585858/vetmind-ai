import { fetchWithAuth, request } from './client'

/** Issue #113: plain-language note for the pet owner, from the approved report. */
export interface OwnerSummary {
  text: string
  language: 'tr' | 'en'
  source: 'template' | 'llm'
  provider: string
  status: 'draft' | 'approved'
  report_version: number
  generated_at: string
  generated_by: string
  edited: boolean
  approved_by?: string | null
  approved_at?: string | null
  /** dose / certainty / prognosis, or model_text_rejected:<reason> when the AI text was replaced. */
  warnings: string[]
}

export interface OwnerSummaryState {
  summary: OwnerSummary | null
  report_approved: boolean
  approved_report_version?: number | null
  /** The report was re-approved after the note was written. */
  stale: boolean
  disclaimer: string
}

const base = (caseId: string) => `/cases/${encodeURIComponent(caseId)}/owner-summary`

export async function getOwnerSummary(caseId: string): Promise<OwnerSummaryState> {
  return request(base(caseId))
}

export async function generateOwnerSummary(caseId: string, language?: 'tr' | 'en'): Promise<OwnerSummaryState> {
  return request(base(caseId), { method: 'POST', body: JSON.stringify(language ? { language } : {}) })
}

export async function saveOwnerSummary(caseId: string, text: string): Promise<OwnerSummaryState> {
  return request(base(caseId), { method: 'PUT', body: JSON.stringify({ text }) })
}

export async function approveOwnerSummary(caseId: string): Promise<OwnerSummaryState> {
  return request(`${base(caseId)}/approve`, { method: 'POST' })
}

/** Download the approved note as PDF. */
export async function downloadOwnerSummaryPdf(caseId: string): Promise<void> {
  const res = await fetchWithAuth(`${base(caseId)}.pdf`)
  if (!res.ok) throw new Error(`PDF failed (${res.status})`)
  const blob = await res.blob()
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'sahip-bilgilendirme.pdf'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
