import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  History,
  Loader2,
  Save,
  Send,
  XCircle,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { AIFindingsPanel } from '../components/AIFindingsPanel'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { CaseProgressTracker } from '../components/CaseProgressTracker'
import { DicomViewer } from '../components/DicomViewer'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import { ReportEditor } from '../components/ReportEditor'
import {
  BackendUnavailableError,
  appendCaseInternalNote,
  createCaseInfoRequest,
  fetchCaseDicomFiles,
  getPetMedicalHistory,
  listBackendWorklist,
  listReportVersions,
  saveBackendDraftReport,
  submitBackendReview,
  type PetHistoryEntry,
} from '../lib/backend'
import { buildDicomPreviews, type DicomFramePreview } from '../lib/dicomPreview'
import { MAX_VIEWER_FRAMES } from '../lib/dicomFolder'
import type { BackendCaseSummary, ReportSections } from '../types'

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
  const [versions, setVersions] = useState<{ version: number; immutable: boolean; status: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [worklist, setWorklist] = useState<BackendCaseSummary[]>([])
  const [priorReports, setPriorReports] = useState<PetHistoryEntry[]>([])
  const [internalNote, setInternalNote] = useState('')
  const [infoAsk, setInfoAsk] = useState('')

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
    setLoadingFrames(true)
    setError(null)
    void (async () => {
      try {
        const caseKey = c.backendCaseId || c.id
        const files = await fetchCaseDicomFiles(caseKey, MAX_VIEWER_FRAMES)
        if (cancelled) return
        setFrames(await buildDicomPreviews(files))
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
    void listBackendWorklist({ assigned_to: 'expert@demo.local' })
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
    return [
      `${c.patient.species} · ${c.patient.breed}`,
      c.patient.age ? `${c.patient.age} yaş` : null,
      c.modality || null,
      c.anatomicalRegion || null,
      c.clinic,
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
  if (!text) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="Düzenlenebilir taslak yok"
          text="Bu çalışma alanı AI/uzman taslağı olan vakalar içindir."
          action={<Link to={`/vakalar/${c.id}`} className="text-sm font-medium text-teal-700">Vaka detayı</Link>}
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
            <Button variant="secondary" size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={() => void onSaveDraft()} disabled={saving || immutable}>
              {saving ? 'Kaydediliyor…' : 'Taslak kaydet ⌘S'}
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-3 p-3 text-sm text-slate-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vaka bağlamı</p>
          <p className="mt-1">{c.clinical.history || c.clinical.complaint || 'Klinik öykü yok'}</p>
          {c.handoffNotes ? <p className="mt-2 text-xs text-teal-800">Handoff: {c.handoffNotes}</p> : null}
          {c.studyInstanceUid ? (
            <p className="mt-2 font-mono text-[11px] text-slate-500">Study UID: {c.studyInstanceUid}</p>
          ) : null}
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

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-h-[420px] space-y-3 xl:min-h-[560px] xl:sticky xl:top-20 xl:self-start">
          {error && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">
              {error}
            </p>
          )}
          <DicomViewer frames={frames} loading={loadingFrames} className="min-h-[420px] xl:min-h-[560px]" />
          <p className="text-[11px] text-slate-500">
            Kısayollar: W/L · P pan · Z zoom · M ölçüm · F tam ekran · C karşılaştır · ok tuşları dilim · tablet/mobilde kaydırarak panelleri gezin
          </p>
        </div>
        <div className="space-y-3">
          <AIFindingsPanel findings={c.backendFindings} analysisMode={c.backendDraft?.generation?.source_kind === 'real' ? 'real' : 'mock'} />
          <Card className="p-4">
            <ReportEditor value={text} onChange={setText} disabled={immutable} />
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <Button
                size="sm"
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                disabled={immutable}
                onClick={() => setModal('approve')}
              >
                Onayla
              </Button>
              <Button size="sm" variant="secondary" icon={<Send className="h-3.5 w-3.5" />} disabled={immutable} onClick={() => setModal('revizyon')}>
                Revizyon
              </Button>
              <Button size="sm" variant="danger" icon={<XCircle className="h-3.5 w-3.5" />} disabled={immutable} onClick={() => setModal('reddedildi')}>
                Reddet
              </Button>
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
          <label className="block">
            <span className="label">Gerekçe</span>
            <textarea
              className="input min-h-[100px]"
              placeholder="Klinik / teknik gerekçe"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setModal(null)}>
            İptal
          </Button>
          <Button
            size="sm"
            variant={modal === 'reddedildi' ? 'danger' : 'primary'}
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
