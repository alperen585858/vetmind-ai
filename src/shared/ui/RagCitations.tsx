import { BookOpen, Info } from 'lucide-react'
import type { BackendFinding, BackendRagCitation } from '../types'
import { useLocale } from '../shell/LocaleContext'
import { displayFindingCode, displayFindingDescription } from '../lib/displayClean'
import { ragAnchorId } from './CitedText'

export function selectCitedPassages(
  citations: BackendRagCitation[] | null | undefined,
  usedPassageIds?: string[] | null,
): { cited: BackendRagCitation[]; legacyAllRetrieved: boolean } {
  if (!citations?.length) return { cited: [], legacyAllRetrieved: false }
  if (usedPassageIds && usedPassageIds.length > 0) {
    const allow = new Set(usedPassageIds)
    return {
      cited: citations.filter((c) => allow.has(c.source_id)),
      legacyAllRetrieved: false,
    }
  }
  // Legacy: no used_passage_ids → show all retrieved with honesty warning.
  return { cited: citations, legacyAllRetrieved: true }
}

const MAX_FINDING_NAME = 90

/** Readable name for a structured finding: first sentence of its description (#76). */
export function findingName(f: Pick<BackendFinding, 'description' | 'finding_code'>): string {
  const text = displayFindingDescription(f.description)
  const first = text.split(/(?<=[.!?])\s/)[0]?.replace(/[.!?]$/, '').trim() || ''
  if (first) return first.length > MAX_FINDING_NAME ? `${first.slice(0, MAX_FINDING_NAME - 1).trimEnd()}…` : first
  return displayFindingCode(f.finding_code)
}

/** Names of the findings a passage is linked to; ids that match no finding are dropped. */
export function relatedFindingNames(ids: string[] | undefined, findings: BackendFinding[] | undefined): string[] {
  if (!ids?.length || !findings?.length) return []
  const byId = new Map(findings.map((f) => [f.finding_id, f]))
  return Array.from(new Set(ids.flatMap((id) => (byId.has(id) ? [findingName(byId.get(id)!)] : [])))).filter(Boolean)
}

export function RagCitations({
  citations,
  note,
  citationMap,
  usedPassageIds,
  findings,
}: {
  citations?: BackendRagCitation[] | null
  note?: string | null
  /** Draft alias map; when present each passage shows the [S#] label used in the text. */
  citationMap?: Record<string, string>
  usedPassageIds?: string[] | null
  /** Case findings, to name the finding a passage supports instead of showing its id. */
  findings?: BackendFinding[]
}) {
  const { t } = useLocale()
  const aliasOf = new Map(Object.entries(citationMap ?? {}).map(([alias, ref]) => [ref, alias]))
  const { cited, legacyAllRetrieved } = selectCitedPassages(citations, usedPassageIds)

  if (!cited.length) {
    return <p className="px-5 py-4 text-sm text-slate-500">{t('cases.detail.citationsNone')}</p>
  }
  return (
    <div>
      {legacyAllRetrieved && (
        <p className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-[11px] text-amber-900">
          {t('cases.detail.citationsLegacy')}
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {cited.map((c) => {
          const related = relatedFindingNames(c.related_finding_ids, findings)
          const scoreHint = t('cases.detail.citationScoreHint', { score: c.score.toFixed(2) })
          return (
            <li key={`${c.source_id}-${c.score}`} id={ragAnchorId(c.source_id)} className="scroll-mt-24 px-5 py-3 transition-colors">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                  <BookOpen className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-navy-900">
                    {aliasOf.has(c.source_id) && (
                      <span className="mr-1.5 rounded bg-teal-100 px-1 text-[11px] font-semibold text-teal-800">{aliasOf.get(c.source_id)}</span>
                    )}
                    {c.title}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span>{c.section}</span>
                    <span
                      className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
                      title={scoreHint}
                      aria-label={`${c.source_id} · ${scoreHint}`}
                      data-testid="citation-source-id"
                    >
                      {c.source_id}
                      <Info className="h-3 w-3" aria-hidden />
                    </span>
                  </p>
                  {related.length > 0 && (
                    <p className="mt-1 text-xs text-teal-800" data-testid="citation-related-findings">
                      <span className="font-medium">{t('cases.detail.citationRelatedFinding')}</span> {related.join('; ')}
                    </p>
                  )}
                  <p className="mt-1 text-sm leading-relaxed text-navy-800">{c.passage}</p>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {note && <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">{note}</p>}
    </div>
  )
}
