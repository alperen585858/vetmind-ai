import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { LocalizedLink } from '../components/LocalizedLink'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import { localizePath } from '../i18n/paths'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileSearch,
  GraduationCap,
  History,
  Image as ImageIcon,
  Loader2,
  Save,
  Send,
  Sparkles,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { currentActorId } from '../lib/auth'
import { canonicalizeCaseId, isBackendCaseId } from '../lib/caseId'
import { AIFindingsPanel, type EvidenceFocus } from '../components/AIFindingsPanel'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { DicomViewer } from '../components/DicomViewer'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { ProvenanceBanner, provenanceKindFromSource } from '../components/ProvenanceBanner'
import { PriorityBadge } from '../components/StatusBadge'
import { ReportDocumentEditor } from '../components/ReportDocumentEditor'
import {
  BackendUnavailableError,
  PollingCancelledError,
  appendCaseInternalNote,
  createCaseInfoRequest,
  createLesson,
  deleteBackendCase,
  fetchCaseDicomFiles,
  getPetMedicalHistory,
  listBackendWorklist,
  listReportVersions,
  draftToSections,
  initManualReport,
  saveBackendDraftReport,
  regenerateBackendReport,
  resendCaseToAI,
  addManualCaseEvidence,
  reviewCaseEvidence,
  submitBackendReview,
  type PetHistoryEntry,
} from '../lib/backend'
import { buildDicomPreviews, type DicomFramePreview } from '../lib/dicomPreview'
import { MAX_VIEWER_FRAMES } from '../lib/dicomFolder'
import { cleanClinicalHistory, displayClinic } from '../lib/displayClean'
import {
  collectOverlayInputsFromFindings,
  eligibleOverlaysForFrame,
} from '../lib/overlayEligibility'
import {
  formatSlaRemaining,
  slaBadgeClass,
  slaHoursForPriority,
  slaTone,
} from '../lib/reviewSla'
import type { BackendCaseSummary, ReportSections } from '../types'

export default function RadiologistWorkspace() {
  const { id: routeId = '' } = useParams()
  const id = canonicalizeCaseId(routeId)
  const nav = useLocalizedNavigate()
  const { getCase, hydrateBackendCase, pushToast, updateCase, removeCase, role } = useApp()
  const { t, locale } = useLocale()
  const reasonCodeOptions = useMemo(
    () => [
      { id: 'wrong_finding', label: t('review.workspace.wrongFinding') },
      { id: 'missing_finding', label: t('review.workspace.missingFinding') },
      { id: 'report_quality', label: t('review.workspace.reportQuality') },
    ],
    [t],
  )
  const c = getCase(id) ?? (routeId ? getCase(routeId) : undefined)
  const [hydrating, setHydrating] = useState(() => Boolean(isBackendCaseId(id) && !c))
  const [text, setText] = useState<ReportSections | undefined>(c?.report ?? c?.aiDraft)
  const [frames, setFrames] = useState<DicomFramePreview[]>([])
  const [loadingFrames, setLoadingFrames] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modal, setModal] = useState<null | 'approve' | 'revizyon' | 'reddedildi' | 'sil'>(null)
  const [deleting, setDeleting] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonCodes, setReasonCodes] = useState<string[]>([])
  const [rememberLesson, setRememberLesson] = useState(true)
  const [versions, setVersions] = useState<{ version: number; immutable: boolean; status: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [worklist, setWorklist] = useState<BackendCaseSummary[]>([])
  const [priorReports, setPriorReports] = useState<PetHistoryEntry[]>([])
  const [internalNote, setInternalNote] = useState('')
  const [infoAsk, setInfoAsk] = useState('')
  const [showDicom, setShowDicom] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [resendingAi, setResendingAi] = useState(false)
  const [evidenceFocus, setEvidenceFocus] = useState<EvidenceFocus | null>(null)
  const [focusRequestId, setFocusRequestId] = useState(0)
  const [overlaysVisible, setOverlaysVisible] = useState(true)
  const [activeViewerFrame, setActiveViewerFrame] = useState<DicomFramePreview | null>(null)
  const resendAbortRef = useRef<AbortController | null>(null)

  const viewerOverlays = useMemo(() => {
    const findings = c?.backendFindings?.findings
    if (!findings?.length) return []
    const inputs = collectOverlayInputsFromFindings(findings)
    return eligibleOverlaysForFrame(inputs, {
      activeSopUid: activeViewerFrame?.sopInstanceUid || evidenceFocus?.sop || null,
      // Single-instance SOP → frame 0; multi-frame files keep evidence frame_index via focus.
      activeFrameIndex: evidenceFocus?.frameIndex ?? 0,
      selectedEvidenceId: evidenceFocus?.evidenceId ?? null,
      overlaysVisible,
    })
  }, [c?.backendFindings?.findings, activeViewerFrame, evidenceFocus, overlaysVisible])

  useEffect(() => {
    // Drop previous case's editor text immediately so Approve can't hit a case with no draft.
    setText(undefined)
    if (!isBackendCaseId(id)) {
      setHydrating(false)
      return
    }
    let cancelled = false
    setHydrating(true)
    void hydrateBackendCase(id).then((mapped) => {
      if (cancelled) return
      setText(mapped?.report ?? mapped?.aiDraft)
      setHydrating(false)
    })
    return () => {
      cancelled = true
    }
  }, [id, hydrateBackendCase])

  useEffect(() => {
    if (!c) return
    let cancelled = false
    const ac = new AbortController()
    setLoadingFrames(true)
    setError(null)
    void (async () => {
      const caseKey = canonicalizeCaseId(c.backendCaseId || c.id)
      const load = async () => {
        // Fetches all linked DICOM ingests (primary + attachment_refs); decode yields for large studies.
        const files = await fetchCaseDicomFiles(caseKey, MAX_VIEWER_FRAMES)
        if (cancelled) return
        const decoded = await buildDicomPreviews(files, { signal: ac.signal })
        if (cancelled) return
        setFrames(decoded)
      }
      try {
        await load()
      } catch (firstErr) {
        if (cancelled) return
        const firstName = firstErr instanceof Error ? firstErr.name : ''
        if (firstName === 'AbortError' || firstErr instanceof PollingCancelledError) return
        // One retry: backend reload / brief 404 during analyze handoff.
        try {
          await new Promise((r) => setTimeout(r, 400))
          if (cancelled) return
          await load()
        } catch (err) {
          if (cancelled) return
          setFrames([])
          const raw =
            err instanceof BackendUnavailableError
              ? err.message
              : err instanceof Error
                ? err.message
                : t('review.workspace.dicomLoadFailed')
          setError(/case not found/i.test(raw) ? t('review.workspace.dicomCaseMissing') : raw)
        }
      } finally {
        if (!cancelled) setLoadingFrames(false)
      }
    })()
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [c?.id, c?.backendCaseId, t])

  useEffect(() => {
    if (!c) return
    if (!c.backendCaseId && !isBackendCaseId(c.id)) return
    const caseKey = canonicalizeCaseId(c.backendCaseId || c.id)
    void listReportVersions(caseKey)
      .then((v) => setVersions(v.map((x) => ({ version: x.version, immutable: x.immutable, status: x.status }))))
      .catch(() => setVersions([]))
  }, [c?.id, c?.backendCaseId, c?.status])

  useEffect(() => {
    void listBackendWorklist({ assigned_to: currentActorId() })
      .then(setWorklist)
      .catch(() =>
        listBackendWorklist()
          .then(setWorklist)
          .catch(() => setWorklist([])),
      )
  }, [id])

  useEffect(() => {
    if (!c?.petId) {
      setPriorReports([])
      return
    }
    void getPetMedicalHistory(c.petId)
      .then((h) => setPriorReports(h.timeline.filter((e) => e.kind === 'report' || e.report_available).slice(0, 6)))
      .catch(() => setPriorReports([]))
  }, [c?.petId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void onSaveDraft()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, c?.id])

  const contextBits = useMemo(() => {
    if (!c) return []
    const clinic = displayClinic(c.clinic)
    return [
      `${c.patient.species} · ${c.patient.breed}`,
      c.patient.age ? t('review.workspace.ageYears', { age: c.patient.age }) : null,
      c.modality || null,
      c.anatomicalRegion || null,
      clinic || null,
    ].filter(Boolean) as string[]
  }, [c])

  const worklistNav = useMemo(() => {
    const caseKey = c?.backendCaseId || c?.id || id
    const idx = worklist.findIndex((w) => w.case_id === caseKey)
    return {
      idx,
      prev: idx > 0 ? worklist[idx - 1] : null,
      next: idx >= 0 && idx < worklist.length - 1 ? worklist[idx + 1] : null,
    }
  }, [worklist, c?.backendCaseId, c?.id, id])

  if (hydrating) {
    return (
      <Card>
        <EmptyState icon={<Loader2 className="h-6 w-6 animate-spin" />} title={t('review.workspace.loading')} />
      </Card>
    )
  }
  if (!c) {
    return (
      <Card>
        <EmptyState
          icon={<FileSearch className="h-6 w-6" />}
          title={t('review.workspace.notFound')}
          action={<LocalizedLink to="/kuyruk" className="text-sm font-medium text-teal-700">{t('review.workspace.backToQueue')}</LocalizedLink>}
        />
      </Card>
    )
  }
  const needsManualInit =
    !text &&
    (c.status === 'manuel_inceleme' ||
      c.status === 'analiz_basarisiz' ||
      c.backendOutcome === 'unsupported' ||
      c.backendOutcome === 'failed' ||
      (!c.backendDraft && c.status !== 'analiz_ediliyor'))

  if (!text) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title={t('review.workspace.noDraftTitle')}
          text={
            c.status === 'analiz_ediliyor'
              ? t('review.workspace.noDraftAnalyzing')
              : needsManualInit
                ? t('review.workspace.noDraftManual')
                : t('review.workspace.noDraftDefault')
          }
          action={
            needsManualInit && (c.backendCaseId || c.id).startsWith('case-') ? (
              <Button
                disabled={saving}
                onClick={() => {
                  const caseKey = c.backendCaseId || c.id
                  setSaving(true)
                  void initManualReport(caseKey)
                    .then(async (draft) => {
                      const sections = draftToSections(draft)
                      setText(sections)
                      updateCase(c.id, {
                        report: sections,
                        aiDraft: sections,
                        backendDraft: draft,
                        status: 'uzman_incelemesinde',
                      })
                      await hydrateBackendCase(caseKey)
                      pushToast({ tone: 'success', title: t('review.workspace.manualDraftStarted') })
                    })
                    .catch((err) =>
                      pushToast({
                        tone: 'error',
                        title: t('review.workspace.manualDraftFailed'),
                        body: err instanceof Error ? err.message : undefined,
                      }),
                    )
                    .finally(() => setSaving(false))
                }}
              >
                {saving ? t('review.workspace.manualDraftStarting') : t('review.workspace.manualDraftStart')}
              </Button>
            ) : (
              <LocalizedLink to={`/vakalar/${c.id}`} className="text-sm font-medium text-teal-700">
                {t('review.workspace.caseDetailLink')}
              </LocalizedLink>
            )
          }
        />
      </Card>
    )
  }

  const caseRow = c
  const caseKey = canonicalizeCaseId(caseRow.backendCaseId || caseRow.id)
  const immutable = Boolean(caseRow.backendDraft?.immutable) || caseRow.status === 'onaylandi'

  /** Hard navigate so approve never leaves the user on the worklist/workspace. */
  function goToApprovedReport(id: string) {
    const target = localizePath(`/raporlar/${canonicalizeCaseId(id)}`, locale)
    window.location.assign(target)
  }
  const validationFailed =
    caseRow.backendDraft?.status === 'validation_failed' ||
    String(caseRow.backendDraft?.status || '').toLowerCase() === 'validation_failed'
  const approveBlocked = immutable || validationFailed

  async function onSaveDraft(opts?: { silent?: boolean }) {
    if (!text || immutable) return false
    setSaving(true)
    try {
      const draft = await saveBackendDraftReport(caseKey, text)
      updateCase(caseRow.id, { report: text, aiDraft: text, backendDraft: draft })
      if (!opts?.silent) pushToast({ tone: 'success', title: t('review.workspace.toastDraftSaved') })
      return true
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Taslak kaydedilemedi',
        body: err instanceof Error ? err.message : undefined,
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  async function goAssigned(target: BackendCaseSummary | null) {
    if (!target) return
    if (!immutable) await onSaveDraft({ silent: true })
    nav(`/vakalar/${target.case_id}/calisma`)
  }

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
        body: err instanceof Error ? err.message : undefined,
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
        await submitBackendReview(caseKey, {
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
        const history = await listReportVersions(caseKey)
        setVersions(history.map((x) => ({ version: x.version, immutable: x.immutable, status: x.status })))
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
        body: err instanceof Error ? err.message : undefined,
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
      const history = await listReportVersions(caseKey)
      setVersions(history.map((x) => ({ version: x.version, immutable: x.immutable, status: x.status })))
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
        body: err instanceof Error ? err.message : undefined,
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
      const history = await listReportVersions(caseKey)
      setVersions(history.map((x) => ({ version: x.version, immutable: x.immutable, status: x.status })))
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
        body: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.patient.name}
            <span className="text-base font-normal text-slate-500">{c.no}</span>
          </span>
        }
        subtitle={contextBits.join(' · ')}
        crumbs={[
          { label: t('review.queue'), to: '/kuyruk' },
          { label: c.no, to: `/vakalar/${c.id}` },
          { label: t('review.workspace.crumbWorkspace') },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={c.priority} />
            {c.reviewDueAt ? (
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${slaBadgeClass(slaTone(c.reviewDueAt))}`}
                title={t('review.workspace.slaTitle', { hours: slaHoursForPriority(c.priority) })}
              >
                <Clock className="h-3 w-3" aria-hidden />
                {formatSlaRemaining(c.reviewDueAt)}
              </span>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              icon={<ChevronLeft className="h-3.5 w-3.5" />}
              disabled={!worklistNav.prev}
              onClick={() => void goAssigned(worklistNav.prev)}
            >
              {t('review.workspace.prevCase')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!worklistNav.next}
              onClick={() => void goAssigned(worklistNav.next)}
            >
              {t('review.workspace.nextCase')} <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<ImageIcon className="h-3.5 w-3.5" />}
              onClick={() => setShowDicom((v) => !v)}
              aria-pressed={showDicom}
            >
              {showDicom ? t('review.workspace.hideDicom') : t('review.workspace.showDicom')}
            </Button>
            <Button variant="secondary" size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={() => void onSaveDraft()} disabled={saving || immutable}>
              {saving ? t('review.workspace.savingDraft') : t('review.workspace.saveDraftShortcut')}
            </Button>
          </div>
        }
      />

      <Card className="mb-4 p-3 text-sm text-slate-700">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('review.workspace.caseContext')}</p>
        <p className="mt-1">
          {cleanClinicalHistory(c.clinical.history) || c.clinical.complaint || t('review.workspace.noClinicalHistory')}
        </p>
        {c.handoffNotes ? <p className="mt-2 text-xs text-teal-800">Handoff: {c.handoffNotes}</p> : null}
        {priorReports.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-2">
            <p className="text-xs font-semibold text-slate-500">{t('review.workspace.priorReports')}</p>
            <ul className="mt-1 space-y-1 text-xs">
              {priorReports.map((r, i) => (
                <li key={`${r.case_id}-${i}`}>
                  {r.title}
                  {r.link_path ? (
                    <>
                      {' '}
                      <LocalizedLink className="text-teal-700 hover:underline" to={r.link_path}>
                        {t('review.workspace.openLink')}
                      </LocalizedLink>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div className={`grid gap-4 ${showDicom ? 'xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]' : ''}`}>
        {showDicom && (
          <div className="min-h-[420px] space-y-3 xl:min-h-[560px] xl:sticky xl:top-20 xl:self-start">
            {error && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                aria-pressed={overlaysVisible}
                onClick={() => setOverlaysVisible((v) => !v)}
              >
                {overlaysVisible ? 'Overlay: açık' : 'Overlay: kapalı'}
              </Button>
              <span className="text-[11px] text-slate-500">
                {overlaysVisible
                  ? `${viewerOverlays.length} doğrulanmış kutu`
                  : 'İşaretlemeler gizli'}
              </span>
            </div>
            <DicomViewer
              frames={frames}
              loading={loadingFrames}
              className="min-h-[420px] xl:min-h-[560px]"
              focusSopUid={evidenceFocus?.sop}
              focusRequestId={focusRequestId}
              overlays={viewerOverlays}
              onActiveFrameChange={(fr) => setActiveViewerFrame(fr)}
              annotateEnabled={Boolean(c.backendCaseId && !immutable && c.backendFindings?.findings?.length)}
              selectedEvidenceId={evidenceFocus?.evidenceId ?? null}
              onAnnotateCommit={async (payload) => {
                if (!c.backendCaseId) throw new Error('Backend case missing')
                const findings = c.backendFindings?.findings || []
                const nativeBbox = {
                  ...payload.bbox,
                  coordinate_space: 'pixel_2d_native' as const,
                  transform_chain: [] as { name: string; params: Record<string, number> }[],
                }
                if (payload.mode === 'edit' && payload.evidenceId) {
                  const sf = await reviewCaseEvidence(c.backendCaseId, payload.evidenceId, {
                    action: 'edit',
                    bbox: nativeBbox,
                    vet_note: 'Radiologist bbox edit',
                  })
                  updateCase(c.id, { backendFindings: sf })
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
                const sf = await addManualCaseEvidence(c.backendCaseId, {
                  finding_id: findingId,
                  bbox: nativeBbox,
                  sop_instance_uid: payload.sopInstanceUid || activeViewerFrame?.sopInstanceUid || undefined,
                  frame_index: payload.frameIndex ?? evidenceFocus?.frameIndex ?? 0,
                  description: 'Radiologist manual mark',
                })
                updateCase(c.id, { backendFindings: sf })
              }}
            />
            <p className="text-[11px] text-slate-500">
              {t('review.workspace.shortcutsHelp')}
            </p>
          </div>
        )}

        <div className={`space-y-3 ${showDicom ? '' : 'mx-auto w-full max-w-[920px]'}`}>
          <ProvenanceBanner
            kind={provenanceKindFromSource(
              c.backendFindings?.source_kind || c.backendDraft?.generation?.source_kind,
              {
                analysisMode: (
                  c.backendFindings?.source_kind ||
                  c.backendDraft?.generation?.source_kind ||
                  'mock'
                )
                  .toString()
                  .toLowerCase(),
              },
            )}
            detail={
              c.backendFindings?.source_model_id ||
              c.backendDraft?.generation?.model_id ||
              undefined
            }
            compact
          />
          {c.backendDraft?.generation?.applied_lesson_ids?.length ? (
            <p className="flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">
              <GraduationCap className="h-3.5 w-3.5" aria-hidden />
              {t('review.workspace.appliedLessons', { count: c.backendDraft.generation.applied_lesson_ids.length })}
              <button type="button" className="font-semibold underline" onClick={() => nav('/ai-dersleri')}>
                {t('review.workspace.viewLessons')}
              </button>
            </p>
          ) : null}
          <AIFindingsPanel
            findings={c.backendFindings}
            analysisMode={
              (c.backendFindings?.source_kind || c.backendDraft?.generation?.source_kind || 'mock')
                .toString()
                .toLowerCase()
            }
            selectedEvidenceId={evidenceFocus?.evidenceId ?? null}
            canVerify={role === 'expert' || role === 'admin'}
            onFocusEvidence={(focus) => {
              setEvidenceFocus(focus)
              setFocusRequestId((n) => n + 1)
            }}
            onReviewEvidence={(evidenceId, action, includeInReport) => {
              if (!c.backendCaseId) return
              void reviewCaseEvidence(c.backendCaseId, evidenceId, {
                action,
                include_in_report: includeInReport,
              })
                .then((sf) => {
                  updateCase(c.id, { backendFindings: sf })
                })
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : 'Evidence review failed')
                })
            }}
            onVerifyEvidence={(evidenceId, action) => {
              if (!c.backendCaseId) return
              void reviewCaseEvidence(c.backendCaseId, evidenceId, { action })
                .then((sf) => {
                  updateCase(c.id, { backendFindings: sf })
                })
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : 'Verification failed')
                })
            }}
          />

          <ReportDocumentEditor
            caseData={c}
            value={text}
            onChange={setText}
            disabled={immutable}
            aiDraft={c.aiDraft ?? null}
            findings={c.backendFindings}
            frames={frames}
          />

          <Card className="p-4">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                disabled={approveBlocked}
                onClick={() => setModal('approve')}
                title={
                  validationFailed
                    ? 'Taslak validation_failed — onay kapalı; alıntıları düzeltin.'
                    : undefined
                }
              >
                {t('review.approve')}
              </Button>
              {worklistNav.next ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ChevronRight className="h-3.5 w-3.5" />}
                  onClick={() => void goAssigned(worklistNav.next)}
                >
                  {t('review.workspace.nextCaseCta')}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                icon={<Send className="h-3.5 w-3.5" />}
                onClick={() => setModal('revizyon')}
              >
                {immutable ? t('review.workspace.reviseBtn') : t('review.workspace.revisionBtn')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<XCircle className="h-3.5 w-3.5" />}
                disabled={immutable}
                onClick={() => setModal('reddedildi')}
              >
                {t('review.reject')}
              </Button>
            </div>
            {validationFailed && (
              <p className="mt-2 text-xs text-amber-800">
                validation_failed: yapısal doğrulama geçmeden onaylanamaz (409).
              </p>
            )}
            {immutable && (
              <p className="mt-2 text-xs text-emerald-800">
                {t('review.workspace.immutableHint')}
              </p>
            )}
          </Card>

          <details className="group rounded-vm border border-slate-200/80 bg-surface-elevated">
            <summary className="cursor-pointer list-none px-4 py-3 marker:hidden">
              <span className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-semibold text-navy-900">{t('review.workspace.techTools')}</span>
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">{t('review.workspace.techToolsHint')}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-90" aria-hidden />
              </span>
            </summary>
            <div className="space-y-4 border-t border-slate-100 px-4 py-4">
              <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Sparkles className="h-3.5 w-3.5" /> {t('review.workspace.resendSection')}
                </p>
                <p className="mb-3 text-xs text-slate-600">
                  {t('review.workspace.resendBody')}{' '}
                  <LocalizedLink to="/ai-tekrar" className="font-semibold text-teal-700 underline">
                    {t('ai.resend.title')}
                  </LocalizedLink>
                  .
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={resendingAi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    disabled={resendingAi || !caseKey.startsWith('case-')}
                    onClick={() => void resendFullPipelineToAI()}
                  >
                    {resendingAi
                      ? t('review.workspace.sending')
                      : immutable
                        ? t('review.workspace.reviseOpenResend')
                        : t('review.workspace.resendThisCase')}
                  </Button>
                  {resendingAi && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Square className="h-3.5 w-3.5" />}
                      onClick={() => resendAbortRef.current?.abort()}
                    >
                      {t('review.workspace.stopAnalysis')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[color:var(--vm-danger)]"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => setModal('sil')}
                  >
                    {t('review.workspace.deleteCase')}
                  </Button>
                </div>
              </div>

              <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <History className="h-3.5 w-3.5" /> {t('review.workspace.reportHistory')}
                </p>
                {versions.length === 0 ? (
                  <p className="text-xs text-slate-500">{t('review.workspace.noVersions')}</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {versions.map((v) => (
                      <li key={v.version} className="flex justify-between rounded bg-slate-50 px-2 py-1">
                        <span>
                          v{v.version} · {v.status}
                        </span>
                        <span className={v.immutable ? 'text-emerald-700' : 'text-slate-500'}>
                          {v.immutable ? 'immutable' : 'mutable'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {caseKey.startsWith('case-') && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('review.workspace.internalNotes')}</p>
                  <label className="block text-xs text-slate-600">
                    {t('review.workspace.internalNoteLabel')}
                    <textarea
                      className="input mt-1 min-h-[56px] text-sm"
                      value={internalNote}
                      onChange={(e) => setInternalNote(e.target.value)}
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!internalNote.trim() || saving}
                    onClick={() =>
                      void appendCaseInternalNote(caseKey, internalNote.trim())
                        .then(() => {
                          setInternalNote('')
                          pushToast({ tone: 'success', title: t('review.workspace.toastInternalSaved') })
                        })
                        .catch((e) =>
                          pushToast({
                            tone: 'error',
                            title: t('review.workspace.toastInternalFailed'),
                            body: e instanceof Error ? e.message : undefined,
                          }),
                        )
                    }
                  >
                    {t('review.workspace.saveInternalNote')}
                  </Button>
                  <label className="block text-xs text-slate-600">
                    {t('review.workspace.askVetInfo')}
                    <input
                      className="input mt-1 text-sm"
                      value={infoAsk}
                      onChange={(e) => setInfoAsk(e.target.value)}
                      placeholder={t('review.workspace.requestPlaceholder')}
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!infoAsk.trim()}
                    onClick={() =>
                      void createCaseInfoRequest(caseKey, { body: infoAsk.trim(), to_role: 'vet' })
                        .then(() => {
                          setInfoAsk('')
                          pushToast({ tone: 'info', title: t('review.workspace.toastInfoOpened') })
                        })
                        .catch((e) =>
                          pushToast({
                            tone: 'error',
                            title: t('review.workspace.toastRequestFailed'),
                            body: e instanceof Error ? e.message : undefined,
                          }),
                        )
                    }
                  >
                    {t('review.workspace.sendRequest')}
                  </Button>
                </div>
              )}
            </div>
          </details>
        </div>
      </div>

      <Modal
        open={modal === 'sil'}
        onClose={() => {
          if (!deleting) setModal(null)
        }}
        title={t('review.workspace.deleteConfirmTitle')}
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={deleting} onClick={() => setModal(null)}>
              {t('review.workspace.giveUp')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleting || !caseKey.startsWith('case-')}
              icon={deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              onClick={() => {
                if (!caseRow || deleting || !caseKey.startsWith('case-')) return
                setDeleting(true)
                void deleteBackendCase(caseKey)
                  .then(() => {
                    removeCase(caseRow.id)
                    pushToast({ tone: 'success', title: t('review.workspace.toastDeleted'), body: caseRow.patient.name })
                    nav('/kuyruk')
                  })
                  .catch((err) =>
                    pushToast({
                      tone: 'error',
                      title: t('review.workspace.toastDeleteFailed'),
                      body: err instanceof Error ? err.message : undefined,
                    }),
                  )
                  .finally(() => setDeleting(false))
              }}
            >
              {deleting ? t('review.workspace.deleting') : t('review.workspace.yesDelete')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            <strong className="text-navy-900">{caseRow.patient.name}</strong> {t('review.workspace.deleteConfirmBody')}
          </p>
          <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
            {caseRow.no} · {caseKey}
          </p>
          <p className="text-xs text-rose-700">{t('review.workspace.deleteIrreversible')}</p>
        </div>
      </Modal>

      <Modal
        open={modal !== null && modal !== 'sil'}
        onClose={() => setModal(null)}
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
          <p className="text-sm text-slate-600">{t('review.workspace.approveBody')}</p>
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
                    onClick={() =>
                      setReasonCodes((prev) =>
                        on ? prev.filter((x) => x !== opt.id) : [...prev, opt.id],
                      )
                    }
                    className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                      on
                        ? 'bg-teal-50 text-teal-900 ring-teal-300'
                        : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
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
            {modal === 'revizyon' && caseKey.startsWith('case-') && (
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
        {modal === 'revizyon' && caseKey.startsWith('case-') && (
          <p className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">
            {t('review.workspace.regenerateAiHint')}
          </p>
        )}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setModal(null)} disabled={regenerating}>
            {t('common.cancel')}
          </Button>
          {modal === 'revizyon' && caseKey.startsWith('case-') && (
            <Button
              size="sm"
              variant="secondary"
              icon={regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              disabled={regenerating || reason.trim().length < 10 || reasonCodes.length < 1}
              onClick={() => void regenerateWithAI()}
            >
              {regenerating ? t('review.workspace.regenerating') : t('review.workspace.regenerateWithAi')}
            </Button>
          )}
          <Button
            size="sm"
            variant={modal === 'reddedildi' ? 'danger' : 'primary'}
            disabled={
              regenerating ||
              (modal !== 'approve' &&
                modal !== null &&
                (reason.trim().length < 10 || reasonCodes.length < 1))
            }
            onClick={() =>
              void decide(
                modal === 'approve' ? 'approve' : modal === 'revizyon' ? 'request_revision' : 'reject',
              )
            }
          >
            {modal === 'approve'
              ? t('review.workspace.confirmApprove')
              : modal === 'revizyon'
                ? t('review.workspace.saveRevisionManual')
                : t('review.workspace.confirmReject')}
          </Button>
        </div>
      </Modal>
    </>
  )
}
