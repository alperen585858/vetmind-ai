import { useMemo } from 'react'
import { EyeOff, Loader2, Sparkles } from 'lucide-react'
import { useLocale } from '../../../shared/shell/LocaleContext'
import { Button } from '../../../shared/ui/Button'
import { Modal } from '../../../shared/ui/Modal'

export type ReviewModal = null | 'approve' | 'revizyon' | 'reddedildi' | 'sil'

/** Reason text and codes are required (≥10 chars, ≥1 code) for revision / reject. */
export function reasonIsValid(reason: string, reasonCodes: string[]): boolean {
  return reason.trim().length >= 10 && reasonCodes.length >= 1
}

export function DeleteCaseModal({
  open,
  deleting,
  patientName,
  caseNo,
  caseKey,
  onClose,
  onConfirm,
}: {
  open: boolean
  deleting: boolean
  patientName: string
  caseNo: string
  caseKey: string
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useLocale()
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!deleting) onClose()
      }}
      title={t('review.workspace.deleteConfirmTitle')}
      footer={
        <>
          <Button variant="secondary" size="sm" disabled={deleting} onClick={onClose}>
            {t('review.workspace.giveUp')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={deleting || !caseKey.startsWith('case-')}
            icon={deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EyeOff className="h-3.5 w-3.5" />}
            onClick={onConfirm}
          >
            {deleting ? t('review.workspace.deleting') : t('review.workspace.yesDelete')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-600">
        <p>
          <strong className="text-navy-900">{patientName}</strong> {t('review.workspace.deleteConfirmBody')}
        </p>
        <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
          {caseNo} · {caseKey}
        </p>
        <p className="text-xs text-rose-700">{t('review.workspace.deleteIrreversible')}</p>
      </div>
    </Modal>
  )
}

export function DecisionModal({
  modal,
  immutable,
  isBackendCase,
  reportableEvidenceCount,
  reason,
  setReason,
  reasonCodes,
  setReasonCodes,
  rememberLesson,
  setRememberLesson,
  regenerating,
  onClose,
  onRegenerate,
  onDecide,
}: {
  modal: ReviewModal
  immutable: boolean
  isBackendCase: boolean
  reportableEvidenceCount: number
  reason: string
  setReason: (v: string) => void
  reasonCodes: string[]
  setReasonCodes: (update: (prev: string[]) => string[]) => void
  rememberLesson: boolean
  setRememberLesson: (v: boolean) => void
  regenerating: boolean
  onClose: () => void
  onRegenerate: () => void
  onDecide: (action: 'approve' | 'reject' | 'request_revision') => void
}) {
  const { t } = useLocale()
  const reasonCodeOptions = useMemo(
    () => [
      { id: 'wrong_finding', label: t('review.workspace.wrongFinding') },
      { id: 'missing_finding', label: t('review.workspace.missingFinding') },
      { id: 'report_quality', label: t('review.workspace.reportQuality') },
    ],
    [t],
  )
  const revising = modal === 'revizyon' && isBackendCase
  const reasonOk = reasonIsValid(reason, reasonCodes)

  return (
    <Modal
      open={modal !== null && modal !== 'sil'}
      onClose={onClose}
      title={
        modal === 'approve'
          ? t('review.workspace.modalApproveTitle')
          : modal === 'revizyon'
            ? immutable
              ? t('review.workspace.modalReviseApproved')
              : t('review.workspace.modalRevision')
            : t('review.workspace.modalReject')
      }
    >
      {modal === 'approve' ? (
        <div className="space-y-3 text-sm text-slate-600">
          <p>{t('review.workspace.approveBody')}</p>
          {reportableEvidenceCount === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
              {t('review.workspace.approveNoEvidence')}
            </p>
          ) : (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-950">
              {t('review.workspace.approveEvidenceCount', { count: reportableEvidenceCount })}
            </p>
          )}
        </div>
      ) : (
        <>
          {modal === 'revizyon' && immutable && (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {t('review.workspace.reviseImmutableNote')}
            </p>
          )}
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t('review.workspace.reasonCodes')}
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            {reasonCodeOptions.map((opt) => {
              const on = reasonCodes.includes(opt.id)
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setReasonCodes((prev) => (on ? prev.filter((x) => x !== opt.id) : [...prev, opt.id]))}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                    on ? 'bg-teal-50 text-teal-900 ring-teal-300' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
          <label className="block">
            <span className="label">{t('review.workspace.reasonRequired')}</span>
            <textarea
              className="input min-h-[100px]"
              placeholder={t('review.workspace.reasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p className="mt-2 text-xs text-slate-500">{t('review.workspace.reasonHint')}</p>
          {revising && (
            <label className="mt-3 flex items-start gap-2 text-sm text-navy-900">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-teal-600"
                checked={rememberLesson}
                onChange={(e) => setRememberLesson(e.target.checked)}
              />
              <span>
                {t('review.workspace.rememberLesson')}
                <span className="mt-0.5 block text-xs text-slate-500">{t('review.workspace.rememberLessonHint')}</span>
              </span>
            </label>
          )}
        </>
      )}
      {revising && (
        <p className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">
          {t('review.workspace.regenerateAiHint')}
        </p>
      )}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose} disabled={regenerating}>
          {t('common.cancel')}
        </Button>
        {revising && (
          <Button
            size="sm"
            variant="secondary"
            icon={regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            disabled={regenerating || !reasonOk}
            onClick={onRegenerate}
          >
            {regenerating ? t('review.workspace.regenerating') : t('review.workspace.regenerateWithAi')}
          </Button>
        )}
        <Button
          size="sm"
          variant={modal === 'reddedildi' ? 'danger' : 'primary'}
          disabled={regenerating || (modal !== 'approve' && modal !== null && !reasonOk)}
          onClick={() => onDecide(modal === 'approve' ? 'approve' : modal === 'revizyon' ? 'request_revision' : 'reject')}
        >
          {modal === 'approve'
            ? t('review.workspace.confirmApprove')
            : modal === 'revizyon'
              ? t('review.workspace.saveRevisionManual')
              : t('review.workspace.confirmReject')}
        </Button>
      </div>
    </Modal>
  )
}
