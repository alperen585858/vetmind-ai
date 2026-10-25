import { BookOpen } from 'lucide-react'
import type { BackendRagCitation } from '../types'
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

export function RagCitations({
  citations,
  note,
  citationMap,
  usedPassageIds,
}: {
  citations?: BackendRagCitation[] | null
  note?: string | null
  /** Draft alias map; when present each passage shows the [S#] label used in the text. */
  citationMap?: Record<string, string>
  usedPassageIds?: string[] | null
}) {
  const aliasOf = new Map(Object.entries(citationMap ?? {}).map(([alias, ref]) => [ref, alias]))
  const { cited, legacyAllRetrieved } = selectCitedPassages(citations, usedPassageIds)

  if (!cited.length) {
    return (
      <p className="px-5 py-4 text-sm text-slate-500">
        Bu vakada backend RAG citation yok (veya analiz henüz çalışmadı).
      </p>
    )
  }
  return (
    <div>
      {legacyAllRetrieved && (
        <p className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-[11px] text-amber-900">
          Eski kayıt: modelin hangi pasajları kullandığı bilgisi yok — bulunan tüm pasajlar
          gösteriliyor; modelin kullandığı anlamına gelmez.
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {cited.map((c) => (
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
                  [{c.source_id}] {c.title}
                  <span className="ml-2 font-mono text-[11px] text-slate-400" title="Yalnızca metin benzerliği — klinik güven düzeyi değildir">
                    benzerlik: {c.score}
                  </span>
                </p>
                <p className="text-xs text-slate-500">{c.section}</p>
                {(c.related_finding_ids?.length ?? 0) > 0 && (
                  <p className="mt-0.5 font-mono text-[11px] text-teal-800">
                    İlgili bulgu: {c.related_finding_ids!.join(', ')}
                  </p>
                )}
                <p className="mt-1 text-sm leading-relaxed text-navy-800">{c.passage}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {note && <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">{note}</p>}
    </div>
  )
}
