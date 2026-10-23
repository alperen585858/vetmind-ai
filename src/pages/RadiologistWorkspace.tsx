import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
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
  fetchCaseDicomFiles,
  listReportVersions,
  saveBackendDraftReport,
  submitBackendReview,
} from '../lib/backend'
import { buildDicomPreviews, type DicomFramePreview } from '../lib/dicomPreview'
import { MAX_VIEWER_FRAMES } from '../lib/dicomFolder'
import type { ReportSections } from '../types'

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
  const [modal, setModal] = useState<null | 'revizyon' | 'reddedildi'>(null)
  const [reason, setReason] = useState('')
  const [versions, setVersions] = useState<{ version: number; immutable: boolean; status: string }[]>([])
  const [error, setError] = useState<string | null>(null)

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

  async function onSaveDraft() {
    if (!text || immutable) return
    setSaving(true)
    try {
      if (caseKey.startsWith('case-')) {
        const draft = await saveBackendDraftReport(caseKey, text)
        updateCase(caseRow.id, { report: text, aiDraft: text, backendDraft: draft })
        pushToast({ tone: 'success', title: 'Taslak kaydedildi' })
      } else {
        updateCase(caseRow.id, { report: text, aiDraft: text })
        pushToast({ tone: 'success', title: 'Yerel taslak güncellendi' })
      }
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Taslak kaydedilemedi',
        body: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setSaving(false)
    }
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
        title={`Çalışma alanı · ${c.no}`}
        subtitle={contextBits.join(' · ')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={c.priority} />
            <StatusBadge status={c.status} />
            <Button variant="secondary" size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={() => void onSaveDraft()} disabled={saving || immutable}>
              {saving ? 'Kaydediliyor…' : 'Taslak kaydet ⌘S'}
            </Button>
            <Link to={`/vakalar/${c.id}/inceleme`} className="text-xs font-medium text-teal-700">
              Klasik inceleme
            </Link>
          </div>
        }
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-4">
        <div className="lg:col-span-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vaka bağlamı</p>
          <p className="mt-1">{c.clinical.history || c.clinical.complaint || 'Klinik öykü yok'}</p>
          {c.handoffNotes ? <p className="mt-2 text-xs text-teal-800">Handoff: {c.handoffNotes}</p> : null}
          {c.studyInstanceUid ? (
            <p className="mt-2 font-mono text-[11px] text-slate-500">Study UID: {c.studyInstanceUid}</p>
          ) : null}
        </div>
        <CaseProgressTracker status={c.status} handoffNotes={c.handoffNotes} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-h-[520px] space-y-3">
          {error && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{error}</p>}
          <DicomViewer frames={frames} loading={loadingFrames} className="min-h-[520px]" />
          <p className="text-[11px] text-slate-500">
            Kısayollar: W/L · P pan · Z zoom · M ölçüm · F tam ekran · C karşılaştır · ok tuşları dilim
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
                onClick={() => void decide('approve')}
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
        </div>
      </div>

      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === 'revizyon' ? 'Revizyon iste' : 'Reddet'}>
        <textarea
          className="min-h-[100px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          placeholder="Gerekçe"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setModal(null)}>
            İptal
          </Button>
          <Button
            size="sm"
            variant={modal === 'reddedildi' ? 'danger' : 'primary'}
            onClick={() => void decide(modal === 'revizyon' ? 'request_revision' : 'reject')}
          >
            Onayla
          </Button>
        </div>
      </Modal>
    </>
  )
}
