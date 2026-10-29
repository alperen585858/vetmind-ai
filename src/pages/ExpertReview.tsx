import { useEffect, useState, type FC } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Bot, CheckCircle2, ExternalLink, FileSearch, GraduationCap, History, Image as ImageIcon, PenLine, RotateCcw, Send, XCircle } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, CardHeader } from '../components/Card'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import { DicomViewer } from '../components/DicomViewer'
import { Citations } from '../components/CitationChip'
import { RagCitations } from '../components/RagCitations'
import { CitedText } from '../components/CitedText'
import { GroundingWarnings } from '../components/GroundingWarnings'
import { EmptyState } from '../components/EmptyState'
import { SECTION_LABELS, USERS } from '../data/mock'
import { nowStamp, today } from '../lib/format'
import { BackendUnavailableError, fetchCaseDicomFiles, fetchDemoDicomFiles, submitBackendReview } from '../lib/backend'
import { MAX_VIEWER_FRAMES } from '../lib/dicomFolder'
import { buildDicomPreviews, type DicomFramePreview } from '../lib/dicomPreview'
import { cacheCaseDicomFiles, loadCachedCaseDicomFiles } from '../lib/dicomCaseCache'
import type { CorrectionCategory, ReportSections, SectionKey } from '../types'

const KEYS = Object.keys(SECTION_LABELS) as SectionKey[]
const CATEGORIES: CorrectionCategory[] = ['Klinik hata', 'Eksik bilgi', 'Üslup', 'Kaynak hatası']

/** Training-signal codes for Feedback Store (ISS-AUD-01). */
const REASON_CODE_OPTIONS: { id: string; label: string }[] = [
  { id: 'wrong_finding', label: 'Yanlış bulgu' },
  { id: 'missing_finding', label: 'Eksik bulgu' },
  { id: 'report_quality', label: 'Rapor kalitesi' },
]

const ExpertReview: FC = () => {
  const { id = '' } = useParams()
  const { getCase, updateCase, pushToast, hydrateBackendCase } = useApp()
  const nav = useNavigate()
  const c = getCase(id)
  const [hydrating, setHydrating] = useState(() => Boolean(id.startsWith('case-') && !c))
  const [text, setText] = useState<ReportSections | undefined>(c?.report)
  const [cats, setCats] = useState<Partial<Record<SectionKey, CorrectionCategory>>>({})
  const [modal, setModal] = useState<null | 'revizyon' | 'reddedildi'>(null)
  const [reason, setReason] = useState('')
  const [reasonCodes, setReasonCodes] = useState<string[]>([])
  const [dicomFrames, setDicomFrames] = useState<DicomFramePreview[]>([])
  const [dicomLoading, setDicomLoading] = useState(true)
  const [dicomError, setDicomError] = useState<string | null>(null)
  const [dicomSource, setDicomSource] = useState('DICOM')
  const caseKey = c?.backendCaseId || c?.id || id

  useEffect(() => {
    if (!c) return
    let cancelled = false
    setDicomLoading(true)
    setDicomError(null)

    void (async () => {
      try {
        let files = await loadCachedCaseDicomFiles(caseKey)
        let source = files?.length ? `Yüklenen çalışma · ${files.length} dosya` : ''

        if (!files?.length && (c.fromBackend || caseKey.startsWith('case-'))) {
          try {
            files = await fetchCaseDicomFiles(caseKey)
            if (files.length) {
              source = `Vaka DICOM · ${files.length} dosya`
              void cacheCaseDicomFiles(caseKey, files)
            }

          } catch (error) {
            if (!(error instanceof BackendUnavailableError) && !c.dicomDemoKind) {
              throw error
            }
          }
        }

        if ((!files || files.length === 0) && c.dicomDemoKind) {
          files = await fetchDemoDicomFiles(c.dicomDemoKind, c.dicomDemoKind === 'thorax_xr' ? 1 : 12)
          source = `Demo · ${c.dicomDemoKind.replace(/_/g, ' ')}`
        }

        if (cancelled) return
        if (!files?.length) {
          setDicomFrames([])
          setDicomSource('DICOM bulunamadı')
          return
        }
        const cappedFiles = files.slice(0, MAX_VIEWER_FRAMES)
        const previews = await buildDicomPreviews(cappedFiles)
        if (cancelled) return
        setDicomFrames(previews)
        setDicomSource(source)
      } catch (error) {
        if (cancelled) return
        setDicomFrames([])
        setDicomSource('DICOM yüklenemedi')
        setDicomError(
          error instanceof BackendUnavailableError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'DICOM önizlemesi yüklenemedi.',
        )
      } finally {
        if (!cancelled) setDicomLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [caseKey, c?.fromBackend, c?.dicomDemoKind])

  useEffect(() => {
    if (!id.startsWith('case-')) {
      setHydrating(false)
      return
    }
    if (c?.aiDraft || c?.backendDraft) {
      setHydrating(false)
      if (c.report || c.aiDraft) setText((prev) => prev ?? c.report ?? c.aiDraft)
      return
    }
    let cancelled = false
    setHydrating(true)
    void hydrateBackendCase(id).then((mapped) => {
      if (cancelled) return
      if (mapped?.report || mapped?.aiDraft) {
        setText(mapped.report ?? mapped.aiDraft)
      }
      setHydrating(false)
    })
    return () => {
      cancelled = true
    }
  }, [id, c?.aiDraft, c?.backendDraft, c?.report, hydrateBackendCase])

  if (hydrating) {
    return (
      <Card>
        <EmptyState
          icon={<FileSearch className="h-6 w-6" />}
          title="Uzman inceleme yükleniyor…"
          text="Vaka yüklenirken lütfen bekleyin."
        />
      </Card>
    )
  }

  if (!c) {
    return <Card><EmptyState icon={<FileSearch className="h-6 w-6" />} title="Vaka bulunamadı" action={<Link to="/kuyruk" className="text-sm font-medium text-teal-700">Onay kuyruğuna dön</Link>} /></Card>
  }
  if (c.status === 'analiz_basarisiz' || c.backendOutcome === 'failed') {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="AI analizi başarısız — onaylanabilir taslak yok"
          text="Bu durum uzman revizyon talebi değildir. Mock/FastAPI adapter hatası nedeniyle AI draft üretilmedi."
          action={<Link to={`/vakalar/${c.id}`} className="text-sm font-medium text-teal-700">Vaka detayına dön</Link>}
        />
      </Card>
    )
  }
  if (c.status === 'manuel_inceleme' || c.backendOutcome === 'unsupported') {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="Manuel inceleme — AI draft onayı kapalı"
          text="Desteklenmeyen vaka. Bu ekran AI taslağı onaylamak için değildir; orijinal çalışma manuel radyolog incelemesi gerektirir."
          action={<Link to={`/vakalar/${c.id}?tab=ai`} className="text-sm font-medium text-teal-700">Bulgulara / vaka detayına git</Link>}
        />
      </Card>
    )
  }
  if (!c.aiDraft || !text) {
    return <Card><EmptyState icon={<FileSearch className="h-6 w-6" />} title="İncelenecek taslak bulunamadı" action={<Link to="/kuyruk" className="text-sm font-medium text-teal-700">Onay kuyruğuna dön</Link>} /></Card>
  }
  const draft = c.aiDraft
  const draftEligible =
    !c.backendCaseId
    || (c.backendOutcome === 'success' || c.backendOutcome === 'partial')
      && c.backendDraft?.status !== 'validation_failed'
  const reviewable = c.status === 'uzman_incelemesinde' && draftEligible
  const edited = KEYS.filter((k) => text[k].trim() !== draft[k].trim())
  const corrections = edited.map((k) => ({ section: k, before: draft[k], after: text[k], category: cats[k] ?? 'Eksik bilgi' }))
  const warnings = c.ai?.validation.filter((v) => v.kind !== 'ok') ?? []

  const syncBackendReview = async (
    action: 'approve' | 'reject' | 'request_revision',
    comment?: string,
    codes?: string[],
  ) => {
    if (!c.backendCaseId) return true
    try {
      await submitBackendReview(c.backendCaseId, {
        action,
        comment,
        reason_codes: codes?.length ? codes : undefined,
        edited_technique: text.klinikOzet,
        edited_findings: text.bulgular,
        edited_impression: text.degerlendirme,
        edited_recommendations: text.oneriler,
      })
      // Re-hydrate so ApprovedReport / print-PDF uses persisted draft + review_history.
      await hydrateBackendCase(c.backendCaseId)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Review reddedildi'
      pushToast({ tone: 'error', title: 'Backend review reddedildi', body: msg })
      return false
    }
  }

  const approve = async () => {
    if (!reviewable) {
      pushToast({ tone: 'error', title: 'Onaylanamaz', body: 'Bu vaka için AI draft onayı uygun değil.' })
      return
    }
    const ok = await syncBackendReview('approve')
    if (!ok) return
    const stamp = nowStamp()
    if (!c.backendCaseId) {
      updateCase(c.id, (x) => ({
        status: 'onaylandi',
        report: text,
        corrections,
        approvedBy: USERS.expert.name,
        approvedAt: today(),
        reportNo: x.no.replace('VM-', 'VMR-'),
        statusNote: undefined,
        timeline: [
          ...x.timeline,
          {
            date: stamp,
            label: `Uzman tarafından AI taslağı onaylandı ve yayınlandı${corrections.length ? ` (${corrections.length} düzeltme)` : ''}`,
            by: USERS.expert.name,
          },
        ],
      }))
    }
    pushToast({
      tone: 'success',
      title: 'Rapor onaylandı ve yayınlandı',
      body: `${c.patient.name} — veteriner hekim ve hayvan sahibi bilgilendirildi.`,
    })
    nav(`/raporlar/${c.id}`)
  }

  const decide = async () => {
    if (!modal) return
    if (reasonCodes.length < 1) {
      pushToast({ tone: 'error', title: 'Gerekçe kodu gerekli', body: 'En az bir training-signal kodu seçin.' })
      return
    }
    const ok = await syncBackendReview(
      modal === 'revizyon' ? 'request_revision' : 'reject',
      reason.trim() || undefined,
      reasonCodes,
    )
    if (!ok) return
    const stamp = nowStamp()
    if (!c.backendCaseId) {
      updateCase(c.id, (x) => ({
        status: modal,
        report: text,
        corrections,
        statusNote: reason.trim(),
        timeline: [
          ...x.timeline,
          {
            date: stamp,
            label: modal === 'revizyon' ? 'Revizyon istendi' : 'Rapor reddedildi',
            by: USERS.expert.name,
          },
        ],
      }))
    }
    setReasonCodes([])
    pushToast({
      tone: modal === 'revizyon' ? 'warning' : 'error',
      title: modal === 'revizyon' ? 'Revizyon istendi' : 'Rapor reddedildi',
      body: `${c.patient.name} — gerekçe kaydedildi.`,
    })
    setModal(null)
    setReason('')
    nav('/kuyruk')
  }

  return (
    <>
      <div className="-mx-4 -my-5 min-h-[calc(100vh-4rem)] sm:-mx-6 sm:-my-6 lg:-mx-8 xl:h-[calc(100vh-4rem)]">
        <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 xl:h-full xl:min-h-0 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <aside className="flex min-h-[55vh] flex-col bg-vet-navy p-4 text-white sm:p-6 xl:sticky xl:top-0 xl:h-full xl:min-h-0">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to="/kuyruk" className="text-xs font-medium text-slate-300 hover:text-white">
                  ← Onay Kuyruğu
                </Link>
                <h2 className="mt-2 flex items-center gap-2 text-lg font-semibold">
                  <ImageIcon className="h-5 w-5 text-vet-turquoise" />
                  DICOM görüntüleme
                </h2>
                <p className="mt-1 truncate text-sm text-slate-300">{c.patient.name} · {dicomSource}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs text-slate-200">{c.no}</span>
            </div>
            <div className="flex min-h-[min(62vh,640px)] flex-1 flex-col overflow-hidden xl:min-h-0">
              {dicomLoading ? (
                <div className="flex flex-1 items-center justify-center rounded-xl border border-white/10 bg-black/30 text-sm text-slate-300" role="status">
                  DICOM görüntüleri yükleniyor…
                </div>
              ) : dicomFrames.length > 0 ? (
                <DicomViewer frames={dicomFrames} className="min-h-0 flex-1 rounded-xl" />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-black/20 px-6 py-10 text-center">
                  <ImageIcon className="h-10 w-10 text-slate-400" />
                  <p className="mt-3 font-medium text-white">
                    {dicomError ? 'DICOM görüntüsü yüklenemedi' : 'Bu vakaya ait DICOM bulunamadı'}
                  </p>
                  <p className="mt-2 max-w-md text-sm text-slate-300">
                    {dicomError ?? 'Görüntüleri vaka detayındaki Görüntüler sekmesinden yükleyip bu incelemeye geri dönebilirsiniz.'}
                  </p>
                  <Link
                    to={`/vakalar/${c.id}?tab=goruntu`}
                    className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-vet-turquoise px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
                  >
                    Vaka görüntülerine git
                  </Link>
                </div>
              )}
            </div>
          </aside>

          <section className="min-w-0 bg-vet-navy p-4 text-white sm:p-6 xl:h-full xl:overflow-y-auto">
            <header className="mb-5 border-b border-white/10 pb-5">
              <div className="mb-2 text-xs text-slate-300">
                <Link to="/kuyruk" className="hover:text-white">Onay Kuyruğu</Link>
                <span className="mx-2 text-slate-500">/</span>
                Uzman İnceleme
              </div>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold tracking-tight text-white">
                    {c.patient.name}
                  </h1>
                  <p className="mt-1 text-sm text-slate-300">
                    {c.no} · {c.patient.species}, {c.patient.breed}, {c.patient.age} yaş · {c.clinic}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <StatusBadge status={c.status} />
                    <PriorityBadge priority={c.priority} />
                  </div>
                </div>
                <Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />} onClick={() => nav(`/vakalar/${c.id}?tab=ai`)}>
                  Tam AI değerlendirmesi
                </Button>
              </div>
            </header>

            <div className="mb-5 rounded-xl border border-white/10 bg-white p-4 text-sm text-slate-700">
              <p>
                <span className="font-semibold text-navy-900">Rapor durumu:</span>{' '}
                {c.backendDraft?.status ?? c.status}
                {c.backendDraft?.version != null ? ` · v${c.backendDraft.version}` : ''}
                {c.backendDraft?.immutable ? ' · immutable' : ''}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Uzman onayı klinik sertifikasyon değildir.
              </p>
              {warnings.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">
                  {warnings.map((w) => (
                    <li key={w.text + w.detail}>
                      {w.text}: {w.detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!reviewable && (
              <div className="mb-5 rounded-xl border border-white/10 bg-white p-4 text-sm text-slate-600">
                Bu vaka şu anda inceleme kuyruğunda değil; editör salt okunurdur.
              </div>
            )}

            <div className="space-y-5">
              <GroundingWarnings warnings={c.backendDraft?.validation_warnings} checked={Boolean(c.backendDraft?.generation.prompt_version)} />
              {/* Backend drafts: pipeline notes are in the status box, grounding in the card above. */}
              {warnings.length > 0 && !c.backendDraft && (
                <Card className="border-amber-200">
                  <CardHeader title="Doğrulama katmanı uyarıları" icon={<AlertTriangle className="h-5 w-5 text-amber-600" />} />
                  <ul className="space-y-2 p-4">
                    {warnings.map((w, i) => (
                      <li key={i} className={`rounded-lg p-3 text-sm ${w.kind === 'missing' ? 'bg-amber-50 text-amber-900' : 'bg-rose-50 text-rose-900'}`}>
                        <span className="font-semibold">{w.kind === 'missing' ? 'Eksik bilgi: ' : 'Kaynaksız ifade: '}</span>
                        {w.text}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <Card>
                <CardHeader title="AI taslağı" subtitle={`${c.ai?.model} tarafından oluşturuldu`} icon={<Bot className="h-5 w-5" />} />
                <div className="divide-y divide-slate-100">
                  {KEYS.map((k) => (
                    <div key={k} className="px-5 py-4">
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{SECTION_LABELS[k]}</p>
                      <CitedText text={draft[k]} citationMap={c.backendDraft?.citation_map} sources={c.backendDraft?.rag_citations} className="text-sm leading-relaxed text-navy-800" />
                      {k === 'ayiriciTanilar' && c.ai && !c.backendDraft?.rag_citations?.length && (
                        <p className="mt-2 text-xs text-slate-500">Kaynaklar: <Citations ids={Array.from(new Set(c.ai.differentials.flatMap((d) => d.citations)))} /></p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
              {c.backendDraft?.rag_citations && c.backendDraft.rag_citations.length > 0 && (
                <Card>
                  <CardHeader title="Kaynak pasajlar (RAG)" subtitle="Taslaktaki [S#] atıflarına tıklayınca ilgili pasaj vurgulanır — klinik kanıt değildir" />
                  <RagCitations
                    citations={c.backendDraft.rag_citations}
                    note={c.backendDraft.rag_note}
                    citationMap={c.backendDraft.citation_map}
                    usedPassageIds={c.backendDraft.used_passage_ids}
                  />
                </Card>
              )}
              <Card>
                <CardHeader title="Rapor editörü" subtitle="Düzenlemeleriniz düzeltme kaydına otomatik eklenir" icon={<PenLine className="h-5 w-5" />} />
                <div className="divide-y divide-slate-100">
                  {KEYS.map((k) => {
                    const isEdited = edited.includes(k)
                    return (
                      <div key={k} className="px-5 py-4">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <label className="text-sm font-semibold text-navy-900">{SECTION_LABELS[k]}</label>
                          <div className="flex items-center gap-2">
                            {isEdited && (
                              <>
                                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">Düzenlendi</span>
                                <button type="button" disabled={!reviewable} onClick={() => setText({ ...text, [k]: draft[k] })} title="AI metnine geri al" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        <textarea
                          disabled={!reviewable}
                          rows={k === 'klinikOzet' || k === 'ayiriciTanilar' ? 4 : 5}
                          value={text[k]}
                          onChange={(e) => setText({ ...text, [k]: e.target.value })}
                          className={`input leading-relaxed ${isEdited ? 'border-violet-300 bg-violet-50/30' : ''}`}
                        />
                        {isEdited && (
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs text-slate-500">Düzeltme kategorisi:</span>
                            <select disabled={!reviewable} value={cats[k] ?? 'Eksik bilgi'} onChange={(e) => setCats({ ...cats, [k]: e.target.value as CorrectionCategory })} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
                              {CATEGORIES.map((x) => <option key={x}>{x}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {reviewable && (
                  <div className="sticky bottom-0 z-10 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-surface-elevated/95 px-5 py-4 backdrop-blur">
                    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vet-red px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vet-red" onClick={() => setModal('reddedildi')}>
                      <XCircle className="h-4 w-4" /> Reddet
                    </button>
                    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vet-amber px-4 py-2 text-sm font-semibold text-vet-navy transition hover:bg-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vet-amber" onClick={() => setModal('revizyon')}>
                      <RotateCcw className="h-4 w-4" /> Revizyon İste
                    </button>
                    <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vet-turquoise px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vet-turquoise" onClick={approve}>
                      <CheckCircle2 className="h-4 w-4" /> Onayla ve Yayınla
                    </button>
                  </div>
                )}
              </Card>
              <Card>
                <CardHeader title={`Düzeltme Kaydı (${corrections.length})`} subtitle="AI metni → uzman metni" icon={<History className="h-5 w-5" />} />
                <div className="flex items-start gap-2 border-b border-slate-100 bg-navy-50/50 px-5 py-3 text-xs text-navy-700">
                  <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                  Bu düzeltmeler, ileride modelin iyileştirilmesi (ince ayar / değerlendirme seti) için anonimleştirilerek toplanan uzman geri bildirimidir.
                </div>
                {corrections.length ? (
                  <ul className="divide-y divide-slate-100">
                    {corrections.map((cr) => (
                      <li key={cr.section} className="grid gap-3 px-5 py-4 lg:grid-cols-12">
                        <div className="lg:col-span-2">
                          <p className="text-sm font-semibold text-navy-900">{SECTION_LABELS[cr.section]}</p>
                          <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{cr.category}</span>
                        </div>
                        <p className="whitespace-pre-line rounded-lg bg-rose-50 p-3 text-sm text-rose-900 line-through decoration-rose-300 lg:col-span-5">{cr.before}</p>
                        <p className="whitespace-pre-line rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 lg:col-span-5">{cr.after}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500">
                    <Send className="h-4 w-4" /> Henüz düzeltme yok. Editörde bir bölümü değiştirdiğinizde burada görünecek.
                  </p>
                )}
              </Card>
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'revizyon' ? 'Revizyon iste' : 'Raporu reddet'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Vazgeç</Button>
            <Button
              variant={modal === 'revizyon' ? 'warning' : 'danger'}
              disabled={reason.trim().length < 10 || reasonCodes.length < 1}
              onClick={decide}
            >
              {modal === 'revizyon' ? 'Revizyon iste' : 'Reddet'}
            </Button>
          </>
        }
      >
        <label className="label">Gerekçe kodları (Feedback Store)</label>
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
        <label className="label">Gerekçe (zorunlu)</label>
        <textarea rows={4} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={modal === 'revizyon' ? 'ör. Derin ağrı algısı değerlendirilip forma eklenmeli.' : 'ör. Yüklenen MR raporu farklı bir hastaya ait.'} />
        <p className="mt-2 text-xs text-slate-500">
          En az 10 karakter + bir kod. Gerekçe hekime iletilir; kodlar Feedback Store training-signal’e yazılır (PHI yok).
        </p>
      </Modal>
    </>
  )
}

export default ExpertReview
