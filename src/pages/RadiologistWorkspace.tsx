import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
  XCircle,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
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
  appendCaseInternalNote,
  createCaseInfoRequest,
  fetchCaseDicomFiles,
  getPetMedicalHistory,
  listBackendWorklist,
  listReportVersions,
  draftToSections,
  initManualReport,
  saveBackendDraftReport,
  regenerateBackendReport,
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

const REASON_CODE_OPTIONS: { id: string; label: string }[] = [
  { id: 'wrong_finding', label: 'Yanlış bulgu' },
  { id: 'missing_finding', label: 'Eksik bulgu' },
  { id: 'report_quality', label: 'Rapor kalitesi' },
]

export default function RadiologistWorkspace() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { getCase, hydrateBackendCase, pushToast, updateCase } = useApp()
  const c = getCase(id)
  const [hydrating, setHydrating] = useState(() => Boolean(id.startsWith('case-') && !c))
  const [text, setText] = useState<ReportSections | undefined>(c?.report ?? c?.aiDraft)
  const [frames, setFrames] = useState<DicomFramePreview[]>([])
  const [loadingFrames, setLoadingFrames] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modal, setModal] = useState<null | 'approve' | 'revizyon' | 'reddedildi'>(null)
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
              : 'DICOM yüklenemedi',
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
        <EmptyState icon={<Loader2 className="h-6 w-6 animate-spin" />} title="Çalışma alanı yükleniyor…" />
      </Card>
    )
  }
  if (!c) {
    return (
      <Card>
        <EmptyState
          icon={<FileSearch className="h-6 w-6" />}
          title="Vaka bulunamadı"
          action={<Link to="/kuyruk" className="text-sm font-medium text-teal-700">İş listesine dön</Link>}
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
          title="Düzenlenebilir taslak yok"
          text={
            needsManualInit
              ? 'AI taslağı üretilmedi (unsupported/failed). Manuel radyolog taslağı başlatabilirsiniz — AI çıktısı değildir.'
              : 'Bu çalışma alanı AI/uzman taslağı olan vakalar içindir.'
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
              <Link to={`/vakalar/${c.id}`} className="text-sm font-medium text-teal-700">
                Vaka detayı
              </Link>
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
        await hydrateBackendCase(caseKey)
      }
      pushToast({
        tone: action === 'approve' ? 'success' : 'info',
        title:
          action === 'approve' ? 'Rapor onaylandı' : action === 'reject' ? 'Rapor reddedildi' : 'Revizyon istendi',
      })
      setModal(null)
      setReason('')
      setReasonCodes([])
      if (action === 'approve') nav(`/raporlar/${caseRow.id}`)
      else nav('/kuyruk')
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'İşlem başarısız',
        body: err instanceof Error ? err.message : undefined,
      })
    }
  }

  /** Record the revision request (reason codes = training signal), then let the model rewrite. */
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
          { label: 'İş Listesi', to: '/kuyruk' },
          { label: c.no, to: `/vakalar/${c.id}` },
          { label: 'Çalışma alanı' },
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
              Önceki
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!worklistNav.next}
              onClick={() => void goAssigned(worklistNav.next)}
            >
              Sonraki <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => nav(`/vakalar/${c.id}`)}>
              Vaka özeti
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<ImageIcon className="h-3.5 w-3.5" />}
              onClick={() => setShowDicom((v) => !v)}
              aria-pressed={showDicom}
            >
              {showDicom ? 'DICOM gizle' : 'DICOM göster'}
            </Button>
            <Button variant="secondary" size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={() => void onSaveDraft()} disabled={saving || immutable}>
              {saving ? 'Kaydediliyor…' : 'Taslak kaydet ⌘S'}
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3 p-3 text-sm text-slate-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vaka bağlamı</p>
          <p className="mt-1">
            {cleanClinicalHistory(c.clinical.history) || c.clinical.complaint || 'Klinik öykü yok'}
          </p>
          {c.handoffNotes ? <p className="mt-2 text-xs text-teal-800">Handoff: {c.handoffNotes}</p> : null}
          {priorReports.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-2">
              <p className="text-xs font-semibold text-slate-500">Önceki onaylı raporlar (aynı pet)</p>
              <ul className="mt-1 space-y-1 text-xs">
                {priorReports.map((r, i) => (
                  <li key={`${r.case_id}-${i}`}>
                    {r.title}
                    {r.link_path ? (
                      <>
                        {' '}
                        <Link className="text-teal-700 hover:underline" to={r.link_path}>
                          aç
                        </Link>
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
                Onayla
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Send className="h-3.5 w-3.5" />}
                disabled={immutable}
                onClick={() => setModal('revizyon')}
              >
                Revizyon
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<XCircle className="h-3.5 w-3.5" />}
                disabled={immutable}
                onClick={() => setModal('reddedildi')}
              >
                Reddet
              </Button>
              {!showDicom && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  onClick={() => setShowDicom(true)}
                >
                  DICOM yanına aç
                </Button>
              )}
            </div>
            {immutable && (
              <p className="mt-2 text-xs text-emerald-800">Onaylı sürüm kilitli — içerik değiştirilemez.</p>
            )}
          </Card>

          <Card className="p-4">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <History className="h-3.5 w-3.5" /> Rapor geçmişi
            </p>
            {versions.length === 0 ? (
              <p className="text-xs text-slate-500">Sürüm kaydı yok.</p>
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
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">İç not / klinik istek</p>
              <label className="block text-xs text-slate-600">
                İç inceleme notu (yalnız radyolog)
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
                      pushToast({ tone: 'success', title: 'İç not kaydedildi' })
                    })
                    .catch((e) =>
                      pushToast({
                        tone: 'error',
                        title: 'İç not kaydedilemedi',
                        body: e instanceof Error ? e.message : undefined,
                      }),
                    )
                }
              >
                İç not kaydet
              </Button>
              <label className="block text-xs text-slate-600">
                Veterinerden ek klinik bilgi iste
                <input
                  className="input mt-1 text-sm"
                  value={infoAsk}
                  onChange={(e) => setInfoAsk(e.target.value)}
                  placeholder="İstek metni"
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
                      pushToast({ tone: 'info', title: 'Bilgi isteği açıldı (OPEN)' })
                    })
                    .catch((e) =>
                      pushToast({
                        tone: 'error',
                        title: 'İstek açılamadı',
                        body: e instanceof Error ? e.message : undefined,
                      }),
                    )
                }
              >
                İstek gönder
              </Button>
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'approve' ? 'Raporu onayla' : modal === 'revizyon' ? 'Revizyon iste' : 'Reddet'}
      >
        {modal === 'approve' ? (
          <p className="text-sm text-slate-600">
            Onay sonrası sürüm <strong>immutable</strong> olur ve kliniklere teslimata açılır. İçerik sonradan değiştirilemez.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Gerekçe kodları (Feedback Store)
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {REASON_CODE_OPTIONS.map((opt) => {
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
              <span className="label">Gerekçe (zorunlu)</span>
              <textarea
                className="input min-h-[100px]"
                placeholder="Klinik / teknik gerekçe"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p className="mt-2 text-xs text-slate-500">
              En az 10 karakter + bir kod. Kodlar training-signal olarak kaydedilir (PHI yok).
            </p>
          </>
        )}
        {modal === 'revizyon' && caseKey.startsWith('case-') && (
          <p className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">
            <strong>Yapay zekâ ile yeniden yaz:</strong> revizyon talebi kaydedilir, ardından model gerekçenizi
            dikkate alarak yeni bir taslak sürümü yazar. Görüntü analizi tekrarlanmaz.
          </p>
        )}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setModal(null)} disabled={regenerating}>
            İptal
          </Button>
          {modal === 'revizyon' && caseKey.startsWith('case-') && (
            <Button
              size="sm"
              variant="secondary"
              icon={regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              disabled={regenerating || reason.trim().length < 10 || reasonCodes.length < 1}
              onClick={() => void regenerateWithAI()}
            >
              {regenerating ? 'Yeni taslak yazılıyor…' : 'Yapay zekâ ile yeniden yaz'}
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
            {modal === 'approve' ? 'Onayı onayla' : 'Gönder'}
          </Button>
        </div>
      </Modal>
    </>
  )
}
