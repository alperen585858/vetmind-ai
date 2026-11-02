import { Bot } from 'lucide-react'
import { useLocale } from '../context/LocaleContext'
import { displayFindingCode, displayFindingDescription } from '../lib/displayClean'
import type { BackendEvidenceReference, BackendFindings } from '../types'

export type EvidenceFocus = {
  evidenceId: string
  sop?: string | null
  frameIndex?: number | null
  bbox?: BackendEvidenceReference['bbox']
  overlayRef?: string | null
  origin?: string
  reviewStatus?: string
}

/** Read-only AI findings + evidence review controls for the radiologist workspace. */
export function AIFindingsPanel({
  findings,
  analysisMode,
  onFocusEvidence,
  onReviewEvidence,
}: {
  findings?: BackendFindings | null
  analysisMode?: string | null
  onFocusEvidence?: (focus: EvidenceFocus) => void
  onReviewEvidence?: (
    evidenceId: string,
    action: 'accept' | 'reject' | 'set_include',
    includeInReport?: boolean,
  ) => void
}) {
  const { t } = useLocale()
  const items = findings?.findings ?? []
  const sourceKind = (findings?.source_kind || '').toUpperCase()
  const isReal = sourceKind === 'REAL'
  const mode = (analysisMode || '').toLowerCase()

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-navy-900">
        <Bot className="h-4 w-4 text-teal-700" aria-hidden />
        {t('ai.findings')}
        {isReal ? (
          <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-800">
            REAL
          </span>
        ) : sourceKind ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
            {sourceKind}
          </span>
        ) : null}
        {mode ? (
          <span className="text-[10px] font-normal text-slate-500">mode:{mode}</span>
        ) : null}
      </div>
      <p className="mb-2 text-[10px] leading-snug text-slate-500">
        AI-proposed marks need accept/reject before PDF inclusion. Supportive evidence only —
        not a final diagnosis.
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">{t('ai.findingsEmpty')}</p>
      ) : (
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-xs">
          {items.map((f) => (
            <li key={f.finding_id} className="rounded-lg bg-white p-2 ring-1 ring-slate-100">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-navy-900">{displayFindingCode(f.finding_code)}</p>
                {typeof f.model_confidence === 'number' ? (
                  <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                    conf {(f.model_confidence * 100).toFixed(0)}%
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-slate-600">{displayFindingDescription(f.description)}</p>
              {f.anatomical_location ? (
                <p className="mt-1 text-[10px] text-slate-400">
                  {displayFindingDescription(f.anatomical_location)}
                </p>
              ) : null}
              {f.evidence_references?.length ? (
                <ul className="mt-2 space-y-2 border-t border-slate-100 pt-2">
                  {f.evidence_references.map((ev) => {
                    const origin = ev.origin || 'ai_proposed'
                    const status = ev.review_status || 'pending'
                    const badge =
                      origin === 'vet_manual'
                        ? 'Vet'
                        : status === 'accepted' || status === 'edited'
                          ? 'AI·ok'
                          : status === 'rejected'
                            ? 'AI·rej'
                            : 'AI·pending'
                    return (
                      <li key={ev.evidence_id} className="rounded bg-slate-50 p-1.5">
                        <button
                          type="button"
                          className="w-full text-left text-[10px] text-teal-800 underline-offset-2 hover:underline"
                          onClick={() =>
                            onFocusEvidence?.({
                              evidenceId: ev.evidence_id,
                              sop: ev.sop_instance_uid,
                              frameIndex: ev.frame_index,
                              bbox: ev.bbox,
                              overlayRef: ev.overlay_ref,
                              origin,
                              reviewStatus: status,
                            })
                          }
                        >
                          <span className="mr-1 rounded bg-white px-1 font-medium ring-1 ring-slate-200">
                            {badge}
                          </span>
                          {ev.sop_instance_uid
                            ? `SOP …${ev.sop_instance_uid.slice(-8)}`
                            : ev.description}
                          {ev.bbox
                            ? ` · (${ev.bbox.x_min.toFixed(0)},${ev.bbox.y_min.toFixed(0)})`
                            : ''}
                          {ev.include_in_report ? ' · PDF' : ''}
                        </button>
                        {onReviewEvidence && origin === 'ai_proposed' ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            <button
                              type="button"
                              className="rounded bg-teal-700 px-1.5 py-0.5 text-[10px] text-white"
                              onClick={() => onReviewEvidence(ev.evidence_id, 'accept', true)}
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] text-white"
                              onClick={() => onReviewEvidence(ev.evidence_id, 'reject')}
                            >
                              Reject
                            </button>
                            {(status === 'accepted' || status === 'edited') && (
                              <button
                                type="button"
                                className="rounded bg-white px-1.5 py-0.5 text-[10px] ring-1 ring-slate-300"
                                onClick={() =>
                                  onReviewEvidence(
                                    ev.evidence_id,
                                    'set_include',
                                    !ev.include_in_report,
                                  )
                                }
                              >
                                {ev.include_in_report ? 'Exclude PDF' : 'Include PDF'}
                              </button>
                            )}
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
