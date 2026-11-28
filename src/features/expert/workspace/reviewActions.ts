import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { TranslateFn } from '../../../i18n'
import type { useApp } from '../../../shared/shell/AppContext'
import type { useLocalizedNavigate } from '../../../shared/hooks/useLocalizedNavigate'
import { toastErrorBody } from '../../../shared/lib/apiErrors'
import type { DicomFramePreview } from '../../../shared/lib/dicomPreview'
import type { AnnotateCommitPayload } from '../../../shared/dicom/DicomViewer'
import {
  PollingCancelledError,
  addManualCaseEvidence,
  createLesson,
  regenerateBackendReport,
  resendCaseToAI,
  reviewCaseEvidence,
  submitBackendReview,
} from '../../../shared/api'
import type { ReportSections, VetCase } from '../../../shared/types'
import type { EvidenceFocus } from '../AIFindingsPanel'
import type { ReviewModal } from './ReviewModals'

type App = ReturnType<typeof useApp>

export interface ReviewActionContext {
  caseRow: VetCase
  caseKey: string
  immutable: boolean
  text: ReportSections | undefined
  setText: Dispatch<SetStateAction<ReportSections | undefined>>
  reason: string
  reasonCodes: string[]
  rememberLesson: boolean
  setReason: (v: string) => void
  setReasonCodes: (v: string[]) => void
  setModal: (m: ReviewModal) => void
  setError: (e: string | null) => void
  setResendingAi: (v: boolean) => void
  setRegenerating: (v: boolean) => void
  resendAbortRef: MutableRefObject<AbortController | null>
  evidenceFocus: EvidenceFocus | null
  setEvidenceFocus: (f: EvidenceFocus | null) => void
  activeViewerFrame: DicomFramePreview | null
  onSaveDraft: (opts?: { silent?: boolean }) => Promise<boolean>
  refreshVersions: (caseKey: string) => Promise<void>
  goToApprovedReport: (caseId: string) => void
  hydrateBackendCase: App['hydrateBackendCase']
  updateCase: App['updateCase']
  pushToast: App['pushToast']
  nav: ReturnType<typeof useLocalizedNavigate>
  t: TranslateFn
}

/** Review decisions (approve / revise / reject), AI resend / rewrite and manual evidence marks. */
export function createReviewActions(ctx: ReviewActionContext) {
  const {
    caseRow,
    caseKey,
    immutable,
    text,
    setText,
    reason,
    reasonCodes,
    rememberLesson,
    setReason,
    setReasonCodes,
    setModal,
    setError,
    setResendingAi,
    setRegenerating,
    resendAbortRef,
    evidenceFocus,
    setEvidenceFocus,
    activeViewerFrame,
    onSaveDraft,
    refreshVersions,
    goToApprovedReport,
    hydrateBackendCase,
    updateCase,
    pushToast,
    nav,
    t,
  } = ctx

  /** Save the revision reason as a lesson for similar cases; never blocks the revision itself. */
  async function maybeSaveLesson(note: string, codes: string[]) {
    if (!rememberLesson || !caseKey.startsWith('case-')) return
    try {
      await createLesson(caseKey, note, codes)
      pushToast({ tone: 'success', title: t('review.workspace.lessonSaved'), body: t('review.workspace.lessonSavedBody') })
    } catch (err) {
      pushToast({
        tone: 'error',
        title: t('review.workspace.lessonFailed'),
        body: toastErrorBody(err, t),
      })
    }
  }

  async function decide(action: 'approve' | 'reject' | 'request_revision') {
    if (!text || !caseRow) return
    try {
      if (!caseKey.startsWith('case-')) {
        pushToast({
          tone: 'error',
          title: t('review.workspace.toastOpFailed'),
          body: t('review.workspace.approveNeedsDraft'),
        })
        setModal(null)
        return
      }

      if (action === 'approve') {
        const fresh = await hydrateBackendCase(caseKey)
        if (fresh?.status === 'onaylandi' || fresh?.backendDraft?.immutable) {
          setModal(null)
          goToApprovedReport(caseKey)
          return
        }
        if (!fresh?.backendDraft) {
          setText(fresh?.report ?? fresh?.aiDraft)
          pushToast({
            tone: 'error',
            title: t('review.workspace.toastOpFailed'),
            body: t('review.workspace.approveNeedsDraft'),
          })
          setModal(null)
          return
        }
        const saved = await onSaveDraft({ silent: true })
        if (!saved) {
          setModal(null)
          return
        }
        const reviewed = await submitBackendReview(caseKey, {
          action: 'approve',
          comment: reason || undefined,
          edited_technique: text.klinikOzet,
          edited_findings: text.bulgular,
          edited_impression: text.degerlendirme,
          edited_recommendations: text.oneriler,
        })
        await hydrateBackendCase(caseKey)
        setModal(null)
        setReason('')
        setReasonCodes([])
        // Approval stands even if the report-ready email to the vet failed (issue #90).
        if (reviewed.vet_email_delivery_status === 'failed') {
          pushToast({ tone: 'warning', title: t('reportEmail.failed') })
        } else if (reviewed.vet_email_delivery_status === 'sent') {
          pushToast({ tone: 'success', title: t('reportEmail.sent') })
        }
        // Hard navigation — do not use SPA nav (was leaving users on the worklist).
        goToApprovedReport(caseKey)
        return
      }

      await submitBackendReview(caseKey, {
        action,
        comment: reason || undefined,
        reason_codes: reasonCodes.length ? reasonCodes : undefined,
        edited_technique: text.klinikOzet,
        edited_findings: text.bulgular,
        edited_impression: text.degerlendirme,
        edited_recommendations: text.oneriler,
      })
      const mapped = await hydrateBackendCase(caseKey)
      if (action === 'request_revision') {
        await maybeSaveLesson(reason, reasonCodes)
        setText(mapped?.report ?? mapped?.aiDraft)
        await refreshVersions(caseKey)
      }
      setModal(null)
      setReason('')
      setReasonCodes([])
      pushToast({
        tone: 'info',
        title:
          action === 'reject'
            ? t('review.workspace.toastRejected')
            : immutable
              ? t('review.workspace.toastNewVersionOpened')
              : t('review.workspace.toastRevisionRequested'),
        body:
          action === 'request_revision' && immutable
            ? t('review.workspace.toastApprovedStaysLocked')
            : undefined,
      })
      if (action === 'reject') nav('/kuyruk')
      // request_revision: stay in workspace
    } catch (err) {
      pushToast({
        tone: 'error',
        title: t('review.workspace.toastOpFailed'),
        body: toastErrorBody(err, t),
      })
    }
  }

  /** Full imaging + LLM re-analyze (same as /ai-tekrar). Not the LLM-only rewrite.
   * Approved/immutable cases: opens a revision fork first, then analyzes. */
  async function resendFullPipelineToAI() {
    if (!caseRow || !caseKey.startsWith('case-')) return
    resendAbortRef.current?.abort()
    const controller = new AbortController()
    resendAbortRef.current = controller
    const openRevisionFirst = immutable
    setResendingAi(true)
    setError(null)
    try {
      if (openRevisionFirst) {
        pushToast({
          tone: 'info',
          title: t('review.workspace.toastRevisionOpening'),
          body: t('review.workspace.toastRevisionBody'),
        })
      }
      const result = await resendCaseToAI(caseKey, {
        signal: controller.signal,
        cancelBackendOnAbort: true,
        openRevisionFirst,
        revisionComment: t('ai.resend.revisionComment'),
      })
      const mapped = await hydrateBackendCase(caseKey)
      if (mapped?.report || mapped?.aiDraft) setText(mapped.report ?? mapped.aiDraft)
      await refreshVersions(caseKey)
      if (result.outcome === 'failed') {
        pushToast({
          tone: 'error',
          title: t('review.workspace.toastResendFailed'),
          body: [result.job.error_message, openRevisionFirst ? t('ai.resend.revisionLeftOpen') : null]
            .filter(Boolean)
            .join(' ') || undefined,
        })
      } else {
        pushToast({
          tone: 'success',
          title: t('review.workspace.toastResendDone'),
          body: openRevisionFirst
            ? t('review.workspace.toastResendApprovedKept')
            : t('review.workspace.toastResendPipelineDone'),
        })
      }
    } catch (err) {
      if (err instanceof PollingCancelledError) {
        pushToast({ tone: 'info', title: t('review.workspace.toastAnalysisStopped'), body: openRevisionFirst ? t('ai.resend.revisionLeftOpen') : undefined })
        await hydrateBackendCase(caseKey)
        return
      }
      pushToast({
        tone: 'error',
        title: t('review.workspace.toastResendError'),
        body: toastErrorBody(err, t),
      })
    } finally {
      if (resendAbortRef.current === controller) resendAbortRef.current = null
      setResendingAi(false)
    }
  }

  async function regenerateWithAI() {
    if (!text || !caseRow || !caseKey.startsWith('case-')) return
    setRegenerating(true)
    try {
      await submitBackendReview(caseKey, {
        action: 'request_revision',
        comment: reason,
        reason_codes: reasonCodes.length ? reasonCodes : undefined,
        edited_technique: text.klinikOzet,
        edited_findings: text.bulgular,
        edited_impression: text.degerlendirme,
        edited_recommendations: text.oneriler,
      })
      const updated = await regenerateBackendReport(caseKey, reason)
      // After the rewrite, so the lesson serves later drafts (this one already has the note).
      await maybeSaveLesson(reason, reasonCodes)
      const mapped = await hydrateBackendCase(caseKey)
      if (mapped?.report || mapped?.aiDraft) setText(mapped.report ?? mapped.aiDraft)
      // Case status can read the same before and after, so refresh history explicitly.
      await refreshVersions(caseKey)
      setModal(null)
      setReason('')
      setReasonCodes([])
      pushToast({
        tone: 'success',
        title: t('review.workspace.toastRegenerated', { version: updated.draft_report?.version ?? '?' }),
        body: t('review.workspace.toastRegeneratedBody'),
      })
    } catch (err) {
      pushToast({
        tone: 'error',
        title: t('review.workspace.toastRegenerateFailed'),
        body: toastErrorBody(err, t),
      })
    } finally {
      setRegenerating(false)
    }
  }

  async function onAnnotateCommit(payload: AnnotateCommitPayload) {
    if (!caseRow.backendCaseId) throw new Error('Backend case missing')
    const findings = caseRow.backendFindings?.findings || []
    const nativeBbox = {
      ...payload.bbox,
      coordinate_space: 'pixel_2d_native' as const,
      transform_chain: [] as { name: string; params: Record<string, number> }[],
    }
    if (payload.mode === 'edit' && payload.evidenceId) {
      const sf = await reviewCaseEvidence(caseRow.backendCaseId, payload.evidenceId, {
        action: 'edit',
        bbox: nativeBbox,
        vet_note: 'Radiologist bbox edit',
      })
      updateCase(caseRow.id, { backendFindings: sf })
      const neu = sf.findings
        .flatMap((f) => f.evidence_references || [])
        .find((e) => e.supersedes_evidence_id === payload.evidenceId)
      if (neu) {
        setEvidenceFocus({
          evidenceId: neu.evidence_id,
          sop: neu.sop_instance_uid,
          frameIndex: neu.frame_index,
          bbox: neu.bbox,
          origin: neu.origin,
          reviewStatus: neu.review_status,
        })
      }
      return
    }
    const findingId =
      findings.find((f) =>
        f.evidence_references?.some((e) => e.evidence_id === evidenceFocus?.evidenceId),
      )?.finding_id || findings[0]?.finding_id
    if (!findingId) throw new Error('No finding to attach bbox')
    const sf = await addManualCaseEvidence(caseRow.backendCaseId, {
      finding_id: findingId,
      bbox: nativeBbox,
      sop_instance_uid: payload.sopInstanceUid || activeViewerFrame?.sopInstanceUid || undefined,
      frame_index: payload.frameIndex ?? evidenceFocus?.frameIndex ?? 0,
      description: 'Radiologist manual mark',
    })
    updateCase(caseRow.id, { backendFindings: sf })
  }

  return { decide, resendFullPipelineToAI, regenerateWithAI, onAnnotateCommit }
}
