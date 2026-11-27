import type { ReactNode } from 'react'
import { Check, GraduationCap, X } from 'lucide-react'
import { useLocale } from '../../shared/shell/LocaleContext'
import { displayFindingCode, displayFindingDescription } from '../../shared/lib/displayClean'
import type { BackendEvidenceReference, BackendFindings } from '../../shared/types'

export type EvidenceFocus = {
  evidenceId: string
  sop?: string | null
  frameIndex?: number | null
  bbox?: BackendEvidenceReference['bbox']
  overlayRef?: string | null
  origin?: string
  reviewStatus?: string
  /** Finding label for on-canvas F# overlay (only with verified bbox). */
  label?: string | null
}

/** Read-only AI findings + evidence review controls for the radiologist workspace. */
export function AIFindingsPanel({
  findings,
  analysisMode,
  onFocusEvidence,
  onReviewEvidence,
  onVerifyEvidence,
  selectedEvidenceId,
  canVerify = false,
  headerExtra,
}: {
  /** Shown next to the source badges, e.g. the model chip. */
  headerExtra?: ReactNode
  findings?: BackendFindings | null
  analysisMode?: string | null
  onFocusEvidence?: (focus: EvidenceFocus) => void
  onReviewEvidence?: (
    evidenceId: string,
    action: 'accept' | 'reject' | 'set_include',
    includeInReport?: boolean,
  ) => void
  /** P1.8 — training export verification (independent of accept). */
  onVerifyEvidence?: (evidenceId: string, action: 'verify' | 'unverify') => void
  selectedEvidenceId?: string | null
  canVerify?: boolean
}) {
  const { t } = useLocale()
  const items = findings?.findings ?? []
  const sourceKind = (findings?.source_kind || '').toUpperCase()
  const isReal = sourceKind === 'REAL'
  const mode = (analysisMode || '').toLowerCase()
  const marks = items.flatMap((f) => f.evidence_references ?? [])
  const reviewed = (st?: string | null) => st === 'accepted' || st === 'edited'
  const summary = [
    { label: t('ai.panel.sumFindings'), value: items.length, cls: 'from-teal-50 text-teal-800 ring-teal-100' },
    {
      label: t('ai.panel.sumPending'),
      value: marks.filter((e) => (e.origin || 'ai_proposed') === 'ai_proposed' && !reviewed(e.review_status) && e.review_status !== 'rejected').length,
      cls: 'from-amber-50 text-amber-800 ring-amber-100',
    },
    { label: t('ai.panel.sumAccepted'), value: marks.filter((e) => reviewed(e.review_status)).length, cls: 'from-emerald-50 text-emerald-800 ring-emerald-100' },
    { label: t('ai.panel.sumRejected'), value: marks.filter((e) => e.review_status === 'rejected').length, cls: 'from-rose-50 text-rose-700 ring-rose-100' },
  ]

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        {isReal ? (
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800 ring-1 ring-inset ring-teal-200">
            {t('ai.panel.real')}
          </span>
        ) : sourceKind ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-200">
            {sourceKind === 'MOCK' ? t('ai.panel.mock') : sourceKind}
          </span>
        ) : null}
        {mode && mode !== sourceKind.toLowerCase() ? (
          <span className="text-[10px] text-slate-500">
            {t('ai.panel.mode', { mode: mode === 'mock' ? t('ai.panel.mock') : mode === 'real' ? t('ai.panel.real') : mode })}
          </span>
        ) : null}
        {headerExtra}
      </div>
      {items.length ? (
        <dl className="mt-3 grid grid-cols-4 gap-2">
          {summary.map((m) => (
            <div key={m.label} className={`rounded-xl bg-gradient-to-b to-white px-2.5 py-2 ring-1 ${m.cls}`}>
              <dd className="font-display text-xl font-bold leading-none tabular-nums">{m.value}</dd>
              <dt className="mt-1 truncate text-[10px] font-semibold text-slate-500">{m.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="mt-2 text-[11px] leading-snug text-slate-500">{t('ai.panel.notice')}</p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t('ai.findingsEmpty')}</p>
      ) : (
        <ul className="mt-3 max-h-[28rem] space-y-2.5 overflow-y-auto pr-1">
          {items.map((f, findingIndex) => (
            <li key={f.finding_id} className="rounded-xl bg-slate-50/70 p-3 ring-1 ring-slate-200/80">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-[#102a43] px-1 font-mono text-[10px] font-bold text-white">
                  F{findingIndex + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-navy-900" title={displayFindingCode(f.finding_code)}>
                    {displayFindingDescription(f.description)}
                  </p>
                  {f.anatomical_location ? (
                    <p className="mt-1 text-[11px] text-slate-500">{displayFindingDescription(f.anatomical_location)}</p>
                  ) : null}
                </div>
                {typeof f.model_confidence === 'number' ? (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${confidenceClass(f.model_confidence)}`}
                  >
                    {t('ai.panel.confidence', { pct: (f.model_confidence * 100).toFixed(0) })}
                  </span>
                ) : null}
              </div>
              {f.evidence_references?.length ? (
                <ul className="mt-2.5 space-y-2">
                  {f.evidence_references.map((ev) => {
                    const origin = ev.origin || 'ai_proposed'
                    const status = ev.review_status || 'pending'
                    const accepted = status === 'accepted' || status === 'edited'
                    const badge =
                      origin === 'vet_manual'
                        ? t('ai.panel.badgeVet')
                        : accepted
                          ? t('ai.panel.badgeAccepted')
                          : status === 'rejected'
                            ? t('ai.panel.badgeRejected')
                            : t('ai.panel.badgePending')
                    const badgeCls =
                      origin === 'vet_manual'
                        ? 'bg-sky-50 text-sky-800 ring-sky-200'
                        : accepted
                          ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                          : status === 'rejected'
                            ? 'bg-rose-50 text-rose-700 ring-rose-200'
                            : 'bg-amber-50 text-amber-800 ring-amber-200'
                    const selected = selectedEvidenceId === ev.evidence_id
                    return (
                      <li
                        key={ev.evidence_id}
                        className={`rounded-lg bg-white p-2.5 ring-1 ${selected ? 'ring-2 ring-teal-400' : 'ring-slate-200'}`}
                      >
                        <button
                          type="button"
                          className="flex w-full flex-wrap items-center gap-2 text-left text-[11px] text-slate-600 hover:text-teal-800"
                          onClick={() =>
                            onFocusEvidence?.({
                              evidenceId: ev.evidence_id,
                              sop: ev.sop_instance_uid,
                              frameIndex: ev.frame_index,
                              bbox: ev.bbox,
                              overlayRef: ev.overlay_ref,
                              origin,
                              reviewStatus: status,
                              label: `F${findingIndex + 1}`,
                            })
                          }
                        >
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${badgeCls}`}>{badge}</span>
                          <span className="font-mono">
                            {ev.sop_instance_uid ? `SOP …${ev.sop_instance_uid.slice(-8)}` : ev.description}
                            {ev.bbox ? ` · (${ev.bbox.x_min.toFixed(0)},${ev.bbox.y_min.toFixed(0)})` : ''}
                            {ev.include_in_report ? ' · PDF' : ''}
                          </span>
                        </button>
                        {onReviewEvidence && origin === 'ai_proposed' ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              className={`${ACTION_BTN} ${accepted ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white text-emerald-700 ring-emerald-300 hover:bg-emerald-50'}`}
                              onClick={() => onReviewEvidence(ev.evidence_id, 'accept', true)}
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden />
                              {t('ai.panel.accept')}
                            </button>
                            <button
                              type="button"
                              className={`${ACTION_BTN} ${status === 'rejected' ? 'bg-rose-600 text-white ring-rose-600' : 'bg-white text-rose-700 ring-rose-300 hover:bg-rose-50'}`}
                              onClick={() => onReviewEvidence(ev.evidence_id, 'reject')}
                            >
                              <X className="h-3.5 w-3.5" aria-hidden />
                              {t('ai.panel.reject')}
                            </button>
                            {accepted && (
                              <button
                                type="button"
                                className={`${ACTION_BTN} bg-white text-slate-700 ring-slate-300 hover:bg-slate-50`}
                                onClick={() => onReviewEvidence(ev.evidence_id, 'set_include', !ev.include_in_report)}
                              >
                                {ev.include_in_report ? t('ai.panel.excludePdf') : t('ai.panel.includePdf')}
                              </button>
                            )}
                          </div>
                        ) : null}
                        {canVerify && onVerifyEvidence && ev.bbox ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-dashed border-slate-200 pt-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              {t('ai.panel.trainingVerify')}
                            </span>
                            {(ev.expert_verification_status || 'unverified') === 'verified' ? (
                              <>
                                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-800 ring-1 ring-inset ring-indigo-200">
                                  {t('ai.panel.verified')}
                                  {ev.expert_verified_by ? ` · ${ev.expert_verified_by}` : ''}
                                </span>
                                <button
                                  type="button"
                                  className={`${ACTION_BTN} bg-white text-slate-700 ring-slate-300 hover:bg-slate-50`}
                                  onClick={() => onVerifyEvidence(ev.evidence_id, 'unverify')}
                                >
                                  {t('ai.panel.unverify')}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className={`${ACTION_BTN} bg-white text-indigo-700 ring-indigo-300 hover:bg-indigo-50`}
                                onClick={() => onVerifyEvidence(ev.evidence_id, 'verify')}
                              >
                                <GraduationCap className="h-3.5 w-3.5" aria-hidden />
                                {t('ai.panel.verify')}
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

const ACTION_BTN =
  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600'

function confidenceClass(c: number) {
  if (c >= 0.8) return 'bg-emerald-50 text-emerald-800 ring-emerald-200'
  if (c >= 0.5) return 'bg-amber-50 text-amber-800 ring-amber-200'
  return 'bg-slate-100 text-slate-600 ring-slate-200'
}
