/**
 * The report's recommendations arrive as one text block that is often already numbered
 * ("1. ...\n2. ..."). The UI renders them as an <ol>, so split them into one item per line
 * and drop the source numbering / bullets — otherwise everything shows as a single "1. 1. ... 2. ..." item.
 */
const LEADING_MARKER = /^\s*(?:\d+\s*[.)]|[-•*])\s+/

export function splitRecommendations(text: string | null | undefined): string[] {
  const raw = (text ?? '').trim()
  if (!raw) return []
  let lines = raw.split(/\r?\n/)
  // A single line with inline numbering ("1. a 2. b") is split before each number.
  if (lines.length === 1 && /^\s*1\s*[.)]\s/.test(raw)) {
    lines = raw.split(/\s+(?=\d+\s*[.)]\s)/)
  }
  const items = lines.map((l) => l.replace(LEADING_MARKER, '').trim()).filter(Boolean)
  return items.length ? items : [raw]
}
