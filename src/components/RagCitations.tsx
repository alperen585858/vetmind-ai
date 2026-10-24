import { BookOpen } from 'lucide-react'
import type { BackendRagCitation } from '../types'
import { ragAnchorId } from './CitedText'

export function RagCitations({
  citations,
  note,
  citationMap,
}: {
  citations?: BackendRagCitation[] | null
  note?: string | null
  /** Draft alias map; when present each passage shows the [S#] label used in the text. */
  citationMap?: Record<string, string>
}) {
  const aliasOf = new Map(Object.entries(citationMap ?? {}).map(([alias, ref]) => [ref, alias]))
  if (!citations?.length) {
    return (
      <p className="px-5 py-4 text-sm text-slate-500">
        Bu vakada backend RAG citation yok (veya analiz henüz çalışmadı).
      </p>
    )
  }
  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {citations.map((c) => (
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
                  <span className="ml-2 font-mono text-[11px] text-slate-400" title="Retrieval similarity only — not clinical confidence">
                    retrieval_score={c.score}
                  </span>
                </p>
                <p className="text-xs text-slate-500">{c.section}</p>
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
