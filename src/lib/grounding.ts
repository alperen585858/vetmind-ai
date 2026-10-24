/**
 * Turns backend validation_warnings (English, machine-shaped) into Turkish, categorized
 * items for the reviewer. Grounding warnings come from backend/app/llm/grounding.py.
 */

export type WarningKind = 'overclaim' | 'unknown_ref' | 'uncited' | 'omitted' | 'system'

export interface ReviewWarning {
  kind: WarningKind
  title: string
  section?: string
  detail: string
  raw: string
}

const SECTION_TR: Record<string, string> = {
  technique: 'Teknik',
  findings: 'Bulgular',
  impression: 'Değerlendirme',
  recommendations: 'Öneriler',
}

const OVERCLAIM_TR: Record<string, string> = {
  'definitive diagnosis': 'Kesin tanı ifadesi',
  certainty: 'Kesinlik ifadesi',
  'confirmed diagnosis': 'Doğrulanmış tanı ifadesi',
  'excluded diagnosis': 'Tanı dışlama ifadesi',
  'absence of disease': 'Hastalık yokluğu ifadesi',
}

export const KIND_ORDER: WarningKind[] = ['overclaim', 'unknown_ref', 'uncited', 'omitted', 'system']

export function parseWarning(raw: string): ReviewWarning {
  let m = raw.match(/^Grounding: (\d+) uncited statement\(s\) in (\w+): (.*?)\.?$/s)
  if (m) {
    return { kind: 'uncited', title: `${m[1]} kaynaksız ifade`, section: SECTION_TR[m[2]] ?? m[2], detail: m[3], raw }
  }
  m = raw.match(/^Grounding: (\w+) cites unknown reference\(s\) ([^—]+?) —/)
  if (m) {
    return {
      kind: 'unknown_ref',
      title: 'Geçersiz atıf',
      section: SECTION_TR[m[1]] ?? m[1],
      detail: `${m[2].trim()} modele verilen bulgu/kaynak listesinde yok.`,
      raw,
    }
  }
  m = raw.match(/^Grounding: (\w+) contains a (.+?) statement \("(.+?)"\)/)
  if (m) {
    return {
      kind: 'overclaim',
      title: OVERCLAIM_TR[m[2]] ?? m[2],
      section: SECTION_TR[m[1]] ?? m[1],
      detail: `“${m[3]}” — taslak bulguları temkinli dille ifade etmeli.`,
      raw,
    }
  }
  m = raw.match(/^Grounding: imaging finding\(s\) not mentioned in the draft: (.*?)\.?$/)
  if (m) {
    return { kind: 'omitted', title: 'Raporda atlanan bulgu', detail: m[1], raw }
  }
  return { kind: 'system', title: 'Sistem notu', detail: raw, raw }
}

export function parseWarnings(raw: readonly string[] | null | undefined): ReviewWarning[] {
  const items = (raw ?? []).map(parseWarning)
  return items.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
}

export type TextPart = { type: 'text'; value: string } | { type: 'cite'; aliases: string[] }

const MARKER_RE = /\[\s*([FS]\d+(?:\s*[,;]\s*[FS]\d+)*)\s*\]/g

/** Split report text into plain text and citation groups ([F1], [F1, S2]). */
export function splitCitations(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const m of text.matchAll(MARKER_RE)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ type: 'text', value: text.slice(last, at) })
    parts.push({ type: 'cite', aliases: m[1].split(/\s*[,;]\s*/) })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}
