import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { LocalizedLink } from '../../shared/shell/LocalizedLink'
import { useLocalizedNavigate } from '../../shared/hooks/useLocalizedNavigate'
import { localizePath } from '../../i18n/paths'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSearch,
  GraduationCap,
  History,
  Info,
  Loader2,
  Send,
  XCircle,
} from 'lucide-react'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { toastErrorBody } from '../../shared/lib/apiErrors'
import { vhsSpeciesFrom, type VhsResult } from '../../shared/lib/vhs'
import { canonicalizeCaseId, isBackendCaseId } from '../../shared/lib/caseId'
import { AIFindingsPanel, type EvidenceFocus } from './AIFindingsPanel'
import { Button } from '../../shared/ui/Button'
import { Card } from '../../shared/ui/Card'
import { EmptyState } from '../../shared/ui/EmptyState'
import { Breadcrumbs } from '../../shared/ui/Breadcrumbs'
import { ProvenanceBanner, provenanceKindFromSource } from '../../shared/ui/ProvenanceBanner'
import { ReportDocumentEditor } from '../../shared/ui/ReportDocumentEditor'
import { PriorStudiesPanel } from '../patients/PriorStudiesPanel'
import { ComparisonSection } from '../patients/ComparisonSection'
import {
  hideBackendCase,
  draftToSections,
  initManualReport,
  saveBackendDraftReport,
  reviewCaseEvidence,
} from '../../shared/api'
import { type DicomFramePreview } from '../../shared/lib/dicomPreview'
import { cleanClinicalHistory, displayClinic, modalityLabel, regionLabel } from '../../shared/lib/displayClean'
import {
  collectOverlayInputsFromFindings,
  eligibleOverlaysForFrame,
} from '../../shared/lib/overlayEligibility'
import type { BackendCaseSummary, ReportSections } from '../../shared/types'
import { SectionTitle, WorkspaceHero } from './workspace/WorkspaceHero'
import { WorkspaceViewer } from './workspace/WorkspaceViewer'
import { TechToolsPanel } from './workspace/TechToolsPanel'
import { DecisionModal, DeleteCaseModal, type ReviewModal } from './workspace/ReviewModals'
import { createReviewActions } from './workspace/reviewActions'
import { countReportableEvidence, useCaseFrames, useReportVersions, useWorklist } from './workspace/useWorkspaceData'

export default function RadiologistWorkspace() {
  const { id: routeId = '' } = useParams()
  const id = canonicalizeCaseId(routeId)
  const nav = useLocalizedNavigate()
  const { getCase, hydrateBackendCase, pushToast, updateCase, removeCase, role } = useApp()
  const { t, locale } = useLocale()
  const c = getCase(id) ?? (routeId ? getCase(routeId) : undefined)
  const [hydrating, setHydrating] = useState(() => Boolean(isBackendCaseId(id) && !c))
  const [text, setText] = useState<ReportSections | undefined>(c?.report ?? c?.aiDraft)
  const [saving, setSaving] = useState(false)
  const [modal, setModal] = useState<ReviewModal>(null)
  const { frames, loadingFrames, error, setError } = useCaseFrames(c)
  const { versions, refresh: refreshVersions } = useReportVersions(c)
  const worklist = useWorklist(id)
  const [deleting, setDeleting] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonCodes, setReasonCodes] = useState<string[]>([])
  const [rememberLesson, setRememberLesson] = useState(true)
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

  const heroFacts = useMemo(() => {
    if (!c) return []
    const dash = t('common.dash')
    const breed = c.patient.breed && !['—', '-'].includes(c.patient.breed.trim()) ? c.patient.breed : ''
    return [
      { label: t('review.colSpeciesBreed'), value: [c.patient.species, breed].filter(Boolean).join(' · ') || dash },
      { label: t('review.workspace.factAge'), value: c.patient.age ? t('review.workspace.ageYears', { age: c.patient.age }) : dash },
      { label: t('review.workspace.factClinic'), value: displayClinic(c.clinic) || dash },
      {
        label: t('review.workspace.factStudy'),
        value: [modalityLabel(t, c.modality), regionLabel(t, c.anatomicalRegion)].filter(Boolean).join(' · ') || dash,
      },
    ]
  }, [c, t])

  const provSource = c?.backendFindings?.source_kind || c?.backendDraft?.generation?.source_kind
  const provKind = provenanceKindFromSource(provSource, { analysisMode: (provSource || '').toString().toLowerCase() })
  const provModel = c?.backendFindings?.source_model_id || c?.backendDraft?.generation?.model_id || undefined

  const clinicalText = c ? cleanClinicalHistory(c.clinical.history) || c.clinical.complaint || '' : ''

  const worklistNav = useMemo(() => {
    const caseKey = c?.backendCaseId || c?.id || id
    const idx = worklist.findIndex((w) => w.case_id === caseKey)
    return {
      idx,
      prev: idx > 0 ? worklist[idx - 1] : null,
      next: idx >= 0 && idx < worklist.length - 1 ? worklist[idx + 1] : null,
    }
  }, [worklist, c?.backendCaseId, c?.id, id])

  const reportableEvidenceCount = useMemo(() => countReportableEvidence(c), [c])

  // Ctrl/Cmd+S saves the draft. These hooks must run before the early returns below
  // (loading / not found / no draft), or React sees a different hook count between
  // renders and the page crashes when the case finishes loading.
  const onSaveDraftRef = useRef<(opts?: { silent?: boolean }) => Promise<boolean | void>>(async () => undefined)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void onSaveDraftRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
  // Backend "analyzing" maps to ai_analizi; isleniyor = documents still being processed.
  const isAnalyzing = c.status === 'ai_analizi' || c.status === 'isleniyor'
  const needsManualInit =
    !text &&
    (c.status === 'manuel_inceleme' ||
      c.status === 'analiz_basarisiz' ||
      c.backendOutcome === 'unsupported' ||
      c.backendOutcome === 'failed' ||
      (!c.backendDraft && !isAnalyzing))

  if (!text) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title={t('review.workspace.noDraftTitle')}
          text={
            isAnalyzing
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
                        body: toastErrorBody(err, t),
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
        title: t('review.workspace.toastDraftSaveFailed'),
        body: toastErrorBody(err, t),
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  onSaveDraftRef.current = onSaveDraft

  async function goAssigned(target: BackendCaseSummary | null) {
    if (!target) return
    if (!immutable) await onSaveDraft({ silent: true })
    nav(`/vakalar/${target.case_id}/calisma`)
  }

  /** VHS measurement → one line at the end of the Findings section (radiologist edits/saves). */
  function appendVhsToReport(r: VhsResult) {
    const line = t('vhs.reportLine', {
      vhs: r.vhs.toFixed(1),
      category: t(`vhs.category.${r.category}`),
      reference: r.reference ? t('vhs.reportReference', { min: r.reference.min, max: r.reference.max }) : '',
      long: r.longV.toFixed(1),
      short: r.shortV.toFixed(1),
    })
    setText((prev) => {
      if (!prev) return prev
      const current = prev.bulgular.trimEnd()
      return { ...prev, bulgular: current ? `${current}\n${line}` : line }
    })
    pushToast({ tone: 'success', title: t('vhs.added'), body: t('vhs.addedBody') })
  }

  const { decide, resendFullPipelineToAI, regenerateWithAI, onAnnotateCommit } = createReviewActions({
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
  })

  function deleteCase() {
    if (!caseRow || deleting || !caseKey.startsWith('case-')) return
    setDeleting(true)
    void hideBackendCase(caseKey)
      .then(() => {
        removeCase(caseRow.id)
        pushToast({ tone: 'success', title: t('review.workspace.toastDeleted'), body: caseRow.patient.name })
        nav('/kuyruk')
      })
      .catch((err) =>
        pushToast({
          tone: 'error',
          title: t('review.workspace.toastDeleteFailed'),
          body: toastErrorBody(err, t),
        }),
      )
      .finally(() => setDeleting(false))
  }

  return (
    <>
      <div className="mb-2">
        <Breadcrumbs
          items={[
            { label: t('review.queue'), to: '/kuyruk' },
            { label: c.no, to: `/vakalar/${c.id}` },
            { label: t('review.workspace.crumbWorkspace') },
          ]}
        />
      </div>
      <WorkspaceHero
        c={c}
        facts={heroFacts}
        clinicalText={clinicalText}
        hasPrev={Boolean(worklistNav.prev)}
        hasNext={Boolean(worklistNav.next)}
        onPrev={() => void goAssigned(worklistNav.prev)}
        onNext={() => void goAssigned(worklistNav.next)}
        showDicom={showDicom}
        onToggleDicom={() => setShowDicom((v) => !v)}
        saving={saving}
        immutable={immutable}
        onSave={() => void onSaveDraft()}
      />

      <div className="mb-4 mt-5 space-y-2">
        {c.radiologistQuestions ? (
          <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <p className="text-xs font-semibold">{t('newCase.radiologistQuestions')}</p>
            <p className="mt-0.5 whitespace-pre-line">{c.radiologistQuestions}</p>
          </div>
        ) : null}
        {(c.backendCaseId || isBackendCaseId(c.id)) && (
          <details className="group rounded-xl bg-white ring-1 ring-slate-200">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold text-navy-900 marker:hidden hover:bg-slate-50">
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 text-slate-400" aria-hidden />
                {t('patients.priorTitle')}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t border-slate-100 p-3">
              {/* Issue #108: radiologists read prior studies; linking is the referring vet's job. */}
              <PriorStudiesPanel caseId={canonicalizeCaseId(c.backendCaseId || c.id)} canLink={false} />
            </div>
          </details>
        )}
      </div>

      <div className={`grid gap-4 ${showDicom ? 'xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]' : ''}`}>
        {showDicom && (
          <WorkspaceViewer
            error={error}
            frames={frames}
            loadingFrames={loadingFrames}
            overlaysVisible={overlaysVisible}
            onToggleOverlays={() => setOverlaysVisible((v) => !v)}
            overlays={viewerOverlays}
            focusSopUid={evidenceFocus?.sop}
            focusRequestId={focusRequestId}
            onActiveFrameChange={(fr) => setActiveViewerFrame(fr)}
            vhsEnabled={c.modality === 'XR'}
            vhsSpecies={vhsSpeciesFrom(c.patient.species)}
            onVhsCommit={immutable ? undefined : appendVhsToReport}
            annotateEnabled={Boolean(c.backendCaseId && !immutable && c.backendFindings?.findings?.length)}
            selectedEvidenceId={evidenceFocus?.evidenceId ?? null}
            onAnnotateCommit={onAnnotateCommit}
          />
        )}

        <div className={`space-y-3 ${showDicom ? '' : 'mx-auto w-full max-w-[920px]'}`}>
          <SectionTitle step={1} title={t('ai.findings')} />
          {provKind !== 'real' ? <ProvenanceBanner kind={provKind} detail={provModel} compact /> : null}
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
            headerExtra={
              provKind === 'real' ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-800 ring-1 ring-inset ring-sky-200"
                  title={`${t('ai.provRealText')}${provModel ? ` · ${provModel}` : ''}`}
                >
                  <Info className="h-3 w-3" aria-hidden />
                  {provModel || t('ai.provRealLabel')}
                </span>
              ) : null
            }
            findings={c.backendFindings}
            analysisMode={
              (c.backendFindings?.source_kind || c.backendDraft?.generation?.source_kind || '')
                .toString()
                .toLowerCase() || undefined
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
                  setError(err instanceof Error ? err.message : t('review.workspace.evidenceReviewFailed'))
                })
            }}
            onVerifyEvidence={(evidenceId, action) => {
              if (!c.backendCaseId) return
              void reviewCaseEvidence(c.backendCaseId, evidenceId, { action })
                .then((sf) => {
                  updateCase(c.id, { backendFindings: sf })
                })
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : t('review.workspace.verificationFailed'))
                })
            }}
          />

          <SectionTitle step={2} title={t('review.workspace.sectionReport')} />
          <ReportDocumentEditor
            caseData={c}
            value={text}
            onChange={setText}
            disabled={immutable}
            aiDraft={c.aiDraft ?? null}
            findings={c.backendFindings}
            frames={frames}
          />

          {c.backendDraft?.comparison && c.backendCaseId && (
            <ComparisonSection
              caseId={c.backendCaseId}
              comparison={c.backendDraft.comparison}
              editable={!immutable}
              onSaved={(draft) => updateCase(c.id, { backendDraft: draft })}
            />
          )}

          <SectionTitle step={3} title={t('review.workspace.sectionDecision')} />
          <Card className="sticky bottom-3 z-20 p-4 shadow-[0_12px_32px_-12px_rgba(15,23,42,0.35)] ring-1 ring-teal-100 backdrop-blur supports-[backdrop-filter]:bg-white/90">
            <div className="flex flex-wrap gap-2">
              <Button
                icon={<CheckCircle2 className="h-4 w-4" />}
                disabled={approveBlocked}
                onClick={() => setModal('approve')}
                title={
                  validationFailed
                    ? t('review.approveBlockedValidation')
                    : undefined
                }
              >
                {t('review.approve')}
              </Button>
              {worklistNav.next ? (
                <Button
                  variant="secondary"
                  icon={<ChevronRight className="h-4 w-4" />}
                  onClick={() => void goAssigned(worklistNav.next)}
                >
                  {t('review.workspace.nextCaseCta')}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                icon={<Send className="h-4 w-4" />}
                onClick={() => setModal('revizyon')}
              >
                {immutable ? t('review.workspace.reviseBtn') : t('review.workspace.revisionBtn')}
              </Button>
              <Button
                variant="danger"
                icon={<XCircle className="h-4 w-4" />}
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

          <TechToolsPanel
            caseKey={caseKey}
            immutable={immutable}
            saving={saving}
            resendingAi={resendingAi}
            onResend={() => void resendFullPipelineToAI()}
            onStopResend={() => resendAbortRef.current?.abort()}
            onDelete={() => setModal('sil')}
            versions={versions}
          />
        </div>
      </div>

      <DeleteCaseModal
        open={modal === 'sil'}
        deleting={deleting}
        patientName={caseRow.patient.name}
        caseNo={caseRow.no}
        caseKey={caseKey}
        onClose={() => setModal(null)}
        onConfirm={deleteCase}
      />

      <DecisionModal
        modal={modal}
        immutable={immutable}
        isBackendCase={caseKey.startsWith('case-')}
        reportableEvidenceCount={reportableEvidenceCount}
        reason={reason}
        setReason={setReason}
        reasonCodes={reasonCodes}
        setReasonCodes={setReasonCodes}
        rememberLesson={rememberLesson}
        setRememberLesson={setRememberLesson}
        regenerating={regenerating}
        onClose={() => setModal(null)}
        onRegenerate={() => void regenerateWithAI()}
        onDecide={(action) => void decide(action)}
      />
    </>
  )
}
