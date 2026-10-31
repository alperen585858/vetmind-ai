import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { LocalizedLink } from '../components/LocalizedLink'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileSearch,
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
import { AIFindingsPanel } from '../components/AIFindingsPanel'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { CaseProgressTracker } from '../components/CaseProgressTracker'
import { DicomViewer } from '../components/DicomViewer'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import { ReportDocumentEditor } from '../components/ReportDocumentEditor'
import {
  BackendUnavailableError,
  PollingCancelledError,
  appendCaseInternalNote,
  createCaseInfoRequest,
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
  submitBackendReview,
  type PetHistoryEntry,
} from '../lib/backend'
import { buildDicomPreviews, type DicomFramePreview } from '../lib/dicomPreview'
import { MAX_VIEWER_FRAMES } from '../lib/dicomFolder'
import { cleanClinicalHistory, displayClinic } from '../lib/displayClean'
import {
  formatSlaRemaining,
  slaBadgeClass,
  slaHoursForPriority,
  slaTone,
} from '../lib/reviewSla'
import type { BackendCaseSummary, ReportSections } from '../types'

export default function RadiologistWorkspace() {
  const { id = '' } = useParams()
  const nav = useLocalizedNavigate()
  const { getCase, hydrateBackendCase, pushToast, updateCase, removeCase } = useApp()
  const { t } = useLocale()
  const reasonCodeOptions = useMemo(
    () => [
      { id: 'wrong_finding', label: t('review.workspace.wrongFinding') },
      { id: 'missing_finding', label: t('review.workspace.missingFinding') },
      { id: 'report_quality', label: t('review.workspace.reportQuality') },
    ],
    [t],
  )
  const c = getCase(id)
  const [hydrating, setHydrating] = useState(() => Boolean(id.startsWith('case-') && !c))
  const [text, setText] = useState<ReportSections | undefined>(c?.report ?? c?.aiDraft)
  const [frames, setFrames] = useState<DicomFramePreview[]>([])
  const [loadingFrames, setLoadingFrames] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modal, setModal] = useState<null | 'approve' | 'revizyon' | 'reddedildi' | 'sil'>(null)
  const [deleting, setDeleting] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonCodes, setReasonCodes] = useState<string[]>([])
  const [versions, setVersions] = useState<{ version: number; immutable: boolean; status: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [worklist, setWorklist] = useState<BackendCaseSummary[]>([])
  const [priorReports, setPriorReports] = useState<PetHistoryEntry[]>([])
  const [internalNote, setInternalNote] = useState('')
  const [infoAsk, setInfoAsk] = useState('')
  const [showDicom, setShowDicom] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [resendingAi, setResendingAi] = useState(false)
  const resendAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!id.startsWith('case-')) {
      setHydrating(false)
      return
    }
    let cancelled = false
    setHydrating(true)
    void hydrateBackendCase(id).then((mapped) => {
      if (cancelled) return
      if (mapped?.report || mapped?.aiDraft) setText(mapped.report ?? mapped.aiDraft)
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
      try {
        const caseKey = c.backendCaseId || c.id
        // Fetches all linked DICOM ingests (primary + attachment_refs); decode yields for large studies.
        const files = await fetchCaseDicomFiles(caseKey, MAX_VIEWER_FRAMES)
        if (cancelled) return
        const decoded = await buildDicomPreviews(files, { signal: ac.signal })
        if (cancelled) return
        setFrames(decoded)
      } catch (err) {
        if (cancelled) return
        setFrames([])
        setError(
          err instanceof BackendUnavailableError
            ? err.message
            : err instanceof Error
              ? err.message
              : t('review.workspace.dicomLoadFailed'),
        )
      } finally {
        if (!cancelled) setLoadingFrames(false)
      }
    })()
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [c?.id, c?.backendCaseId])

  useEffect(() => {
    if (!c?.backendCaseId && !c?.id.startsWith('case-')) return
    const caseKey = c.backendCaseId || c.id
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
      c.patient.age ? `${c.patient.age} yaş` : null,
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
    (c.status === 'manuel_inceleme' || c.status === 'analiz_basarisiz' || c.backendOutcome === 'unsupported' || c.backendOutcome === 'failed')

  if (!text) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title={t('review.workspace.noDraftTitle')}
          text={
            needsManualInit
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
                      pushToast({ tone: 'success', title: 'Manuel taslak başlatıldı' })
                    })
                    .catch((err) =>
                      pushToast({
                        tone: 'error',
                        title: 'Manuel taslak başlatılamadı',
                        body: err instanceof Error ? err.message : undefined,
                      }),
                    )
                    .finally(() => setSaving(false))
                }}
              >
                {saving ? 'Başlatılıyor…' : 'Manuel taslak başlat'}
              </Button>
            ) : (
              <LocalizedLink to={`/vakalar/${c.id}`} className="text-sm font-medium text-teal-700">
                Vaka detayı
              </LocalizedLink>
            )
          }
        />
      </Card>
    )
  }

  const caseRow = c
  const caseKey = caseRow.backendCaseId || caseRow.id
  const immutable = Boolean(caseRow.backendDraft?.immutable) || caseRow.status === 'onaylandi'

  async function onSaveDraft(opts?: { silent?: boolean }) {
    if (!text || immutable) return false
    setSaving(true)
    try {
      if (caseKey.startsWith('case-')) {
        const draft = await saveBackendDraftReport(caseKey, text)
        updateCase(caseRow.id, { report: text, aiDraft: text, backendDraft: draft })
        if (!opts?.silent) pushToast({ tone: 'success', title: 'Taslak kaydedildi' })
      } else {
        updateCase(caseRow.id, { report: text, aiDraft: text })
        if (!opts?.silent) pushToast({ tone: 'success', title: 'Yerel taslak güncellendi' })
      }
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

  async function decide(action: 'approve' | 'reject' | 'request_revision') {
    if (!text || !caseRow) return
    try {
      if (caseKey.startsWith('case-')) {
        await submitBackendReview(caseKey, {
          action,
          comment: reason || undefined,
          reason_codes:
            action !== 'approve' && reasonCodes.length ? reasonCodes : undefined,
          edited_technique: text.klinikOzet,
          edited_findings: text.bulgular,
          edited_impression: text.degerlendirme,
          edited_recommendations: text.oneriler,
        })
        const mapped = await hydrateBackendCase(caseKey)
        if (action === 'request_revision') {
          if (mapped?.report || mapped?.aiDraft) setText(mapped.report ?? mapped.aiDraft)
          const history = await listReportVersions(caseKey)
          setVersions(history.map((x) => ({ version: x.version, immutable: x.immutable, status: x.status })))
        }
      }
      pushToast({
        tone: action === 'approve' ? 'success' : 'info',
        title:
          action === 'approve'
            ? 'Rapor onaylandı'
            : action === 'reject'
              ? 'Rapor reddedildi'
              : immutable
                ? 'Yeni sürüm açıldı — düzenleyebilirsiniz'
                : 'Revizyon istendi',
        body:
          action === 'request_revision' && immutable
            ? 'Önceki onaylı sürüm kilitli kaldı. Değişiklikleri kaydedip yeniden onaylayın.'
            : undefined,
      })
      setModal(null)
      setReason('')
      setReasonCodes([])
      if (action === 'approve') nav(`/raporlar/${caseRow.id}`)
      else if (action === 'reject') nav('/kuyruk')
      // request_revision: stay in workspace so the expert can edit the new mutable version
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
      })
      const mapped = await hydrateBackendCase(caseKey)
      if (mapped?.report || mapped?.aiDraft) setText(mapped.report ?? mapped.aiDraft)
      const history = await listReportVersions(caseKey)
      setVersions(history.map((x) => ({ version: x.version, immutable: x.immutable, status: x.status })))
      if (result.outcome === 'failed') {
        pushToast({
          tone: 'error',
          title: 'AI yeniden gönderim başarısız',
          body: result.job.error_message || undefined,
        })
      } else {
        pushToast({
          tone: 'success',
          title: 'AI yeniden çalıştı',
          body: openRevisionFirst
            ? 'Onaylı sürüm korundu; yeni AI taslağı hazır.'
            : 'Görüntü + taslak pipeline tamamlandı.',
        })
      }
    } catch (err) {
      if (err instanceof PollingCancelledError) {
        pushToast({ tone: 'info', title: 'Analiz durduruldu' })
        await hydrateBackendCase(caseKey)
        return
      }
      pushToast({
        tone: 'error',
        title: 'AI yeniden gönderilemedi',
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
        title: `Yeni taslak hazır (v${updated.draft_report?.version ?? '?'})`,
        body: 'Yapay zekâ gerekçenizi dikkate alarak yeniden yazdı. Önceki sürüm geçmişte duruyor.',
      })
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Yeniden yazma başarısız',
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
            <StatusBadge status={c.status} />
            {c.reviewDueAt ? (
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${slaBadgeClass(slaTone(c.reviewDueAt))}`}
                title={`${slaHoursForPriority(c.priority)} saat uzman yanıt SLA`}
              >
                <Clock className="h-3 w-3" aria-hidden />
                {formatSlaRemaining(c.reviewDueAt)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
                <Clock className="h-3 w-3" aria-hidden />
                {slaHoursForPriority(c.priority)}s SLA
              </span>
            )}
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
            <Button variant="secondary" size="sm" onClick={() => nav(`/vakalar/${c.id}`)}>
              {t('review.workspace.caseSummary')}
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

      <div className="mb-4 grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3 p-3 text-sm text-slate-700">
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
        <CaseProgressTracker status={c.status} handoffNotes={c.handoffNotes} />
      </div>

      <div className={`grid gap-4 ${showDicom ? 'xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]' : ''}`}>
        {showDicom && (
          <div className="min-h-[420px] space-y-3 xl:min-h-[560px] xl:sticky xl:top-20 xl:self-start">
            {error && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">
                {error}
              </p>
            )}
            <DicomViewer frames={frames} loading={loadingFrames} className="min-h-[420px] xl:min-h-[560px]" />
            <p className="text-[11px] text-slate-500">
              Kısayollar: W/L · P pan · Z zoom · M mesafe · A açı · O ROI · Space cine · F tam ekran · C seri
              karşılaştır · R reset · ok tuşları dilim.
            </p>
          </div>
        )}

        <div className={`space-y-3 ${showDicom ? '' : 'mx-auto w-full max-w-[920px]'}`}>
          <AIFindingsPanel
            findings={c.backendFindings}
            analysisMode={c.backendDraft?.generation?.source_kind === 'real' ? 'real' : 'mock'}
          />

          <ReportDocumentEditor caseData={c} value={text} onChange={setText} disabled={immutable} />

          <Card className="p-4">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                disabled={immutable}
                onClick={() => setModal('approve')}
              >
                {t('review.approve')}
              </Button>
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
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-700 hover:bg-rose-50"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => setModal('sil')}
              >
                {t('review.workspace.deleteCase')}
              </Button>
              {!showDicom && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  onClick={() => setShowDicom(true)}
                >
                  {t('review.workspace.openDicomSide')}
                </Button>
              )}
            </div>
            {immutable && (
              <p className="mt-2 text-xs text-emerald-800">
                {t('review.workspace.immutableHint')}
              </p>
            )}
          </Card>

          <Card className="p-4">
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
            </div>
            {immutable && !resendingAi && (
              <p className="mt-2 text-xs text-amber-800">
                {t('review.workspace.approvedProtected')}
              </p>
            )}
          </Card>

          <Card className="p-4">
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
          </Card>

          {caseKey.startsWith('case-') && (
            <Card className="space-y-3 p-4">
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
            </Card>
          )}
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
            <strong className="text-navy-900">{caseRow.patient.name}</strong> vakasını kalıcı olarak silmek istediğinize
            emin misiniz?
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
            {modal === 'approve' ? t('review.workspace.confirmApprove') : t('common.send')}
          </Button>
        </div>
      </Modal>
    </>
  )
}
