import { splitCitations } from '../lib/grounding'
import type { BackendFinding, BackendRagCitation } from '../types'

export function ragAnchorId(sourceId: string) {
  return `rag-${sourceId}`
}

function focusSource(sourceId: string) {
  const el = document.getElementById(ragAnchorId(sourceId))
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ring-2', 'ring-teal-400', 'bg-teal-50/60')
  window.setTimeout(() => el.classList.remove('ring-2', 'ring-teal-400', 'bg-teal-50/60'), 1600)
}

function findingTooltip(
  findingId: string,
  findings: BackendFinding[] | undefined,
): string {
  const f = findings?.find((x) => x.finding_id === findingId)
  if (!f) return `Görüntüleme bulgusu: ${findingId}`
  const loc = f.anatomical_location ? `${f.anatomical_location}: ` : ''
  const status = f.finding_status ? ` (${f.finding_status})` : ''
  const desc = (f.description || '').trim()
  return desc ? `${loc}${desc}${status}` : `Görüntüleme bulgusu: ${findingId}`
}

/** Report text with [F1] / [S2] markers rendered as chips; source chips jump to the passage. */
export function CitedText({
  text,
  citationMap,
  sources,
  findings,
  className = '',
}: {
  text: string
  citationMap?: Record<string, string>
  sources?: BackendRagCitation[]
  /** Structured findings used for F# hover tooltips (description + location). */
  findings?: BackendFinding[]
  className?: string
}) {
  if (!citationMap || Object.keys(citationMap).length === 0) {
    return <p className={`whitespace-pre-line ${className}`}>{text}</p>
  }
  const byId = new Map((sources ?? []).map((s) => [s.source_id, s]))
  return (
    <p className={`whitespace-pre-line ${className}`}>
      {splitCitations(text).map((part, i) =>
        part.type === 'text' ? (
          <span key={i}>{part.value}</span>
        ) : (
          <span key={i} className="mx-0.5 inline-flex gap-0.5 align-baseline">
            {part.aliases.map((alias) => {
              const ref = citationMap[alias]
              if (!ref) {
                return (
                  <span key={alias} title="Geçersiz atıf — modele verilen listede yok" className="rounded bg-rose-100 px-1 text-[11px] font-semibold text-rose-700 line-through">
                    {alias}
                  </span>
                )
              }
              if (alias.startsWith('S')) {
                const src = byId.get(ref)
                return (
                  <button
                    key={alias}
                    type="button"
                    onClick={() => focusSource(ref)}
                    title={src ? `${src.title} — ${src.section}` : ref}
                    className="rounded bg-teal-100 px-1 text-[11px] font-semibold text-teal-800 hover:bg-teal-200"
                  >
                    {alias}
                  </button>
                )
              }
              return (
                <span
                  key={alias}
                  title={findingTooltip(ref, findings)}
                  className="rounded bg-violet-100 px-1 text-[11px] font-semibold text-violet-800"
                >
                  {alias}
                </span>
              )
            })}
          </span>
        ),
      )}
    </p>
  )
}
