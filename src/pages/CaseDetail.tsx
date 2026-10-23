import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertCircle, AlertTriangle, BookOpen, Brain, CheckCircle2, ChevronDown, ClipboardList, FileSearch, FileText, FolderOpen, History, Image as ImageIcon, Info, LayoutGrid, Loader2, MessageSquare, Microscope, Stethoscope, UploadCloud, XCircle,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../context/AppContext'
import { Card, CardHeader } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { PriorityBadge, SeverityBadge, StatusBadge } from '../components/StatusBadge'
import { AIDisclaimer } from '../components/AIDisclaimer'
import { Citations } from '../components/CitationChip'
import { RagCitations } from '../components/RagCitations'
import { EmptyState } from '../components/EmptyState'
import { CaseProgressTracker } from '../components/CaseProgressTracker'
import { CaseMessaging } from '../components/CaseMessaging'
import { ReportVersionCompare } from '../components/ReportVersionCompare'
import { DicomViewer } from '../components/DicomViewer'
import { localize } from '../lib/localization'
import { fmtDate } from '../lib/format'
import {
  BackendUnavailableError,
  fetchCaseDicomFiles,
  fetchDemoDicomFiles,
  listCaseActivity,
  resolveDemoKindForCase,
} from '../lib/backend'
import { buildDicomPreviews, type DicomFramePreview } from '../lib/dicomPreview'
import {
  MAX_VIEWER_FRAMES,
  collectFilesFromDataTransfer,
  collectFilesFromFileList,
} from '../lib/dicomFolder'
import { cacheCaseDicomFiles, loadCachedCaseDicomFiles } from '../lib/dicomCaseCache'
import { analysisStatusLabel, expertReviewLabel } from '../lib/caseMapper'
import type { ValidationItem, VetCase } from '../types'

const TABS = [
  { key: 'genel', label: 'Genel Bakış', icon: <LayoutGrid className="h-4 w-4" /> },
  { key: 'bulgular', label: 'AI Bulgular', icon: <Brain className="h-4 w-4" /> },
  { key: 'goruntu', label: 'Görüntüler', icon: <ImageIcon className="h-4 w-4" /> },
  { key: 'rapor', label: 'Rapor', icon: <ClipboardList className="h-4 w-4" /> },
  { key: 'mesajlar', label: 'Mesajlar', icon: <MessageSquare className="h-4 w-4" /> },
  { key: 'gecmis', label: 'İşlem Geçmişi', icon: <History className="h-4 w-4" /> },
  { key: 'belgeler', label: 'Belgeler', icon: <FileText className="h-4 w-4" /> },
]

function DetailSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Vaka yükleniyor">
      <div className="h-10 w-2/3 rounded-lg bg-slate-100" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-48 rounded-xl bg-slate-100" />
        <div className="h-48 rounded-xl bg-slate-100" />
      </div>
      <div className="h-40 rounded-xl bg-slate-100" />
    </div>
  )
}

export default function CaseDetail() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { getCase, role, hydrateBackendCase } = useApp()
  const nav = useNavigate()
  const c = getCase(id)
  const [loading, setLoading] = useState(() => Boolean(id.startsWith('case-') && !c))
  const [loadError, setLoadError] = useState<string | null>(null)
  const rawTab = params.get('tab') ?? 'genel'
  const tab = rawTab === 'ai' ? 'bulgular' : rawTab

  const reload = () => {
    if (!id.startsWith('case-')) return
    setLoading(true)
    setLoadError(null)
    void hydrateBackendCase(id).then((mapped) => {
      if (!mapped) {
        setLoadError('Vaka backend’den yüklenemedi. Yetki veya ağ sorununu kontrol edin.')
      }
      setLoading(false)
    })
  }

  useEffect(() => {
    if (!id.startsWith('case-')) {
      setLoading(false)
      setLoadError(null)
      return
    }
    if (c?.fromBackend && (c.ai || c.backendFindings || c.status === 'taslak' || c.modality)) {
      setLoading(false)
      setLoadError(null)
      return
    }
    setLoading(true)
    setLoadError(null)
    let cancelled = false
    void hydrateBackendCase(id).then((mapped) => {
      if (cancelled) return
      if (!mapped && !getCase(id)) {
        setLoadError('Vaka backend’den yüklenemedi.')
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id, c?.fromBackend, c?.ai, c?.backendFindings, c?.status, c?.modality, hydrateBackendCase, getCase])

  if (!c && loading) {
    return (
      <Card className="p-6">
        <DetailSkeleton />
      </Card>
    )
  }

  if (!c) {
    return (
      <Card>
        <EmptyState
          icon={<FileSearch className="h-6 w-6" />}
          title="Vaka bulunamadı"
          text={loadError ?? 'Bu kimlik için kayıt yok veya erişim yok.'}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {id.startsWith('case-') && (
                <Button size="sm" variant="secondary" onClick={reload}>
                  Tekrar dene
                </Button>
              )}
              <Link className="text-sm font-medium text-teal-700" to="/vakalar">
                Vakalara dön
              </Link>
            </div>
          }
        />
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        crumbs={[
          { label: role === 'expert' ? 'İş Listesi' : 'Vakalar', to: role === 'expert' ? '/kuyruk' : '/vakalar' },
          { label: c.no },
        ]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>{c.patient.name}</span>
            <StatusBadge status={c.status} />
            <PriorityBadge priority={c.priority} />
            {c.unreadMessages && c.unreadMessages > 0 ? (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                {c.unreadMessages} mesaj
              </span>
            ) : null}
          </span>
        }
        subtitle={`${c.no} · ${c.patient.species}, ${c.patient.breed} · ${c.module} · ${fmtDate(c.createdAt)}`}
        actions={
          <>
            {(c.status === 'isleniyor' || (c.status === 'ai_analizi' && c.processingStartedAt)) && (
              <Button variant="secondary" icon={<Loader2 className="h-4 w-4 animate-spin" />} onClick={() => nav(`/vakalar/${c.id}/isleme`)}>İşlem hattını izle</Button>
            )}
            {role === 'expert' && (c.status === 'uzman_incelemesinde' || c.status === 'revizyon' || c.status === 'manuel_inceleme') && (
              <Button icon={<Microscope className="h-4 w-4" />} onClick={() => nav(`/vakalar/${c.id}/calisma`)}>Çalışma alanı</Button>
            )}
            {role === 'vet' && (
              <Button variant="secondary" size="sm" icon={<MessageSquare className="h-4 w-4" />} onClick={() => setParams({ tab: 'mesajlar' }, { replace: true })}>
                Mesajlar
              </Button>
            )}
            {c.status === 'onaylandi' && (
              <Button variant="success" icon={<FileText className="h-4 w-4" />} onClick={() => nav(`/raporlar/${c.id}`)}>Onaylı raporu görüntüle</Button>
            )}
          </>
        }
      />

      {c.status === 'revizyon' && c.statusNote && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>Uzman revizyon talebi:</strong> {c.statusNote}</p>
        </div>
      )}
      {c.status === 'analiz_basarisiz' && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>Analiz başarısız (AI adapter):</strong> {c.statusNote ?? 'Onaylanabilir AI taslak yoktur. Bu, uzman revizyon talebi değildir.'}</p>
        </div>
      )}
      {c.status === 'manuel_inceleme' && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm text-slate-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>Manuel inceleme:</strong> {c.statusNote ?? 'Desteklenmeyen vaka — AI draft onayı kapalıdır.'}</p>
        </div>
      )}
      {c.status === 'reddedildi' && c.statusNote && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p><strong>Ret gerekçesi:</strong> {c.statusNote}</p>
        </div>
      )}

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setParams({ tab: t.key }, { replace: true })}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === t.key ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-navy-800'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'genel' && <Overview c={c} onOpenAiTab={() => setParams({ tab: 'bulgular' }, { replace: true })} />}
      {tab === 'bulgular' && <AssessmentView c={c} />}
      {tab === 'goruntu' && <Imaging c={c} />}
      {tab === 'rapor' && <ReportWorkspace c={c} />}
      {tab === 'mesajlar' && <CaseMessaging caseId={c.id} enabled={Boolean(c.fromBackend)} />}
      {tab === 'gecmis' && <CaseHistoryPanel c={c} />}
      {tab === 'belgeler' && <Documents c={c} />}
    </>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-5 gap-3 py-2 text-sm">
      <dt className="col-span-2 text-slate-500">{k}</dt>
      <dd className="col-span-3 text-navy-900">{v}</dd>
    </div>
  )
}

function Overview({ c, onOpenAiTab }: { c: VetCase; onOpenAiTab: () => void }) {
  const p = c.patient
  const n = c.neuro
  const loc = localize(n, c.clinical)
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader title="Hasta" icon={<ClipboardList className="h-5 w-5" />} />
            <dl className="divide-y divide-slate-50 px-5 py-2">
              <Row k="Ad" v={p.name} />
              <Row k="Tür / Irk" v={`${p.species} · ${p.breed}`} />
              <Row k="Cinsiyet" v={`${p.sex}, ${p.neutered ? 'kısırlaştırılmış' : 'kısırlaştırılmamış'}`} />
              <Row k="Yaş / Kilo" v={`${p.age} yaş · ${p.weight} kg`} />
              <Row
                k="Sahip"
                v={
                  c.petOwnerSubject || p.ownerName !== '—'
                    ? `${c.petOwnerSubject || p.ownerName}${p.ownerPhone ? ` · ${p.ownerPhone}` : ''}`
                    : '—'
                }
              />
              <Row k="Klinik / Hekim" v={`${c.clinic} · ${c.vetName}`} />
              <Row k="Öncelik / Atama" v={`${c.priority}${c.assignedReviewerId ? ` · ${c.assignedReviewerId}` : ''}`} />
            </dl>
          </Card>
          <Card>
            <CardHeader title="Klinik Bilgiler" icon={<Stethoscope className="h-5 w-5" />} />
            <dl className="divide-y divide-slate-50 px-5 py-2">
              <Row k="Şikâyet" v={c.clinical.complaint} />
              <Row k="Başlangıç" v={c.clinical.onset} />
              <Row k="Seyir" v={c.clinical.course} />
              <Row k="Klinik geçmiş" v={c.clinical.history || '—'} />
              <Row k="İlaçlar" v={c.clinical.medications || '—'} />
            </dl>
          </Card>
        </div>
        <Card>
          <CardHeader title="Görüntüleme & sınıflandırma" icon={<ImageIcon className="h-5 w-5" />} />
          <dl className="divide-y divide-slate-50 px-5 py-2">
            <Row k="Modalite / Bölge" v={`${c.modality ?? '—'} · ${c.anatomicalRegion ?? '—'}`} />
            <Row
              k="Sınıflandırma"
              v={
                c.classificationConfirmed
                  ? 'Onaylandı (vaka oluşturuldu)'
                  : 'Onay bekleniyor / bilinmiyor'
              }
            />
            <Row
              k="Study UID"
              v={
                <span className="break-all font-mono text-xs" title={c.studyInstanceUid}>
                  {c.studyInstanceUid ?? '—'}
                </span>
              }
            />
            <Row
              k="Seri / görüntü"
              v={
                c.seriesCount != null || c.instanceCount != null
                  ? `${c.seriesCount ?? '—'} seri · ${c.instanceCount ?? '—'} görüntü`
                  : '—'
              }
            />
            <Row k="Demo analiz" v={analysisStatusLabel(c.status)} />
            <Row k="Uzman inceleme" v={expertReviewLabel(c.status)} />
            <Row
              k="Rapor"
              v={
                c.status === 'onaylandi' ? (
                  <Link className="font-medium text-teal-700 hover:underline" to={`/raporlar/${c.id}`}>
                    Onaylı raporu aç
                  </Link>
                ) : c.backendDraft || c.aiDraft ? (
                  <button type="button" className="font-medium text-teal-700 hover:underline" onClick={onOpenAiTab}>
                    AI taslak (mock) — AI sekmesi
                  </button>
                ) : (
                  'Henüz yok'
                )
              }
            />
          </dl>
          <div className="border-t border-slate-100 px-5 py-3">
            <Link
              to={`/vakalar/${c.id}?tab=goruntu`}
              className="text-sm font-medium text-teal-700 hover:underline"
            >
              DICOM görüntüleyiciye git →
            </Link>
          </div>
        </Card>
        <Card>
          <CardHeader title="Nörolojik Muayene Özeti" icon={<Brain className="h-5 w-5" />} action={loc && <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 ring-1 ring-inset ring-teal-200">Olası lokalizasyon: {loc.region}</span>} />
          <div className="grid gap-x-8 px-5 py-2 md:grid-cols-2">
            <dl className="divide-y divide-slate-50">
              <Row k="Bilinç" v={n.consciousness} />
              <Row k="Yürüyüş" v={`${n.gait}${n.limbs.length ? ` — ${n.limbs.join(', ')}` : ''}`} />
              <Row k="Postüral (ön / arka)" v={`${n.posturalThoracic} / ${n.posturalPelvic}`} />
              <Row k="Refleksler (tor. / pel.)" v={`${n.reflexThoracic} / ${n.reflexPelvic}`} />
            </dl>
            <dl className="divide-y divide-slate-50">
              <Row k="Kraniyal sinirler" v={n.cranialNerves.join(', ') || 'Normal'} />
              <Row k="Derin ağrı" v={n.deepPain === 'Değerlendirilmedi' ? <span className="font-medium text-amber-700">Değerlendirilmedi</span> : n.deepPain} />
              <Row k="Spinal hiperestezi" v={n.hyperesthesia} />
            </dl>
          </div>
        </Card>
      </div>
      <div className="space-y-6">
      <CaseProgressTracker status={c.status} handoffNotes={c.handoffNotes} />
      <Card>
        <CardHeader title="Durum Zaman Çizelgesi" />
        <ol className="relative px-5 py-4">
          {c.timeline.map((t, i) => {
            const last = i === c.timeline.length - 1
            return (
              <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
                {!last && <span className="absolute left-[7px] top-4 h-full w-px bg-slate-200" />}
                <span className={`relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 ${last ? 'border-teal-500 bg-teal-100' : 'border-slate-300 bg-white'}`} />
                <div>
                  <p className="text-sm font-medium text-navy-900">{t.label}</p>
                  <p className="text-xs text-slate-500">{fmtDate(t.date)}{t.by ? ` · ${t.by}` : ''}</p>
                </div>
              </li>
            )
          })}
        </ol>
      </Card>
      </div>
    </div>
  )
}

function Documents({ c }: { c: VetCase }) {
  const [sel, setSel] = useState(c.documents[0]?.id)
  const doc = c.documents.find((d) => d.id === sel)
  if (!c.documents.length) return <Card><EmptyState icon={<FileText className="h-6 w-6" />} title="Henüz belge yüklenmemiş" text="Vaka taslak durumunda." /></Card>
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <Card className="lg:col-span-3">
        <CardHeader title={`Belgeler (${c.documents.length})`} />
        <ul className="p-2">
          {c.documents.map((d) => (
            <li key={d.id}>
              <button onClick={() => setSel(d.id)} className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition ${sel === d.id ? 'bg-teal-50 ring-1 ring-inset ring-teal-200' : 'hover:bg-slate-50'}`}>
                <FileText className={`mt-0.5 h-5 w-5 shrink-0 ${sel === d.id ? 'text-teal-600' : 'text-slate-400'}`} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-navy-900">{d.name}</p>
                  <p className="text-xs text-slate-500">{d.type} · {d.pages} sf · {d.size}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><CheckCircle2 className="h-3 w-3" /> İşlendi</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {doc && (
        <>
          <Card className="lg:col-span-5">
            <CardHeader title="Ham metin" subtitle={`${doc.name} — metne dönüştürülmüş içerik`} />
            <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap p-5 font-mono text-[12.5px] leading-relaxed text-navy-800">{doc.rawText}</pre>
          </Card>
          <Card className="lg:col-span-4">
            <CardHeader title="Çıkarılmış yapılandırılmış veri" subtitle="Veri İşleme Katmanı çıktısı" />
            <ul className="space-y-3 p-4">
              {doc.extracted.map((e, i) => (
                <li key={i} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">{e.field}</p>
                  <p className="mt-0.5 text-sm font-medium text-navy-900">{e.value}</p>
                  <p className="mt-2 border-l-2 border-slate-200 pl-2 text-xs italic text-slate-500">Kaynak cümle: {e.source}</p>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}

function Imaging({ c }: { c: VetCase }) {
  const { pushToast } = useApp()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [frames, setFrames] = useState<DicomFramePreview[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [seriesKey, setSeriesKey] = useState<string | null>(null)
  const [sourceLabel, setSourceLabel] = useState('DICOM')

  const caseKey = c.backendCaseId || c.id
  const explicitDemoKind = c.dicomDemoKind
  const fallbackDemoKind = useMemo(
    () =>
      resolveDemoKindForCase({
        dicomDemoKind: c.dicomDemoKind,
        statusNote: c.statusNote,
        documents: c.documents,
      }),
    [c.dicomDemoKind, c.statusNote, c.documents],
  )

  const seriesOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>()
    for (const f of frames) {
      if (!f.ok) continue
      const key = f.seriesInstanceUid || (f.seriesDescription ? `desc:${f.seriesDescription}` : 'default')
      const label = f.seriesDescription || f.modality || 'Series'
      const prev = map.get(key)
      if (prev) prev.count += 1
      else map.set(key, { key, label, count: 1 })
    }
    return Array.from(map.values())
  }, [frames])

  const activeSeriesKey = seriesKey && seriesOptions.some((s) => s.key === seriesKey) ? seriesKey : seriesOptions[0]?.key ?? null

  const viewFrames = useMemo(() => {
    if (!activeSeriesKey) return frames
    return frames.filter((f) => {
      const key = f.seriesInstanceUid || (f.seriesDescription ? `desc:${f.seriesDescription}` : 'default')
      return key === activeSeriesKey
    })
  }, [frames, activeSeriesKey])

  const paintFiles = async (next: File[], label: string) => {
    const capped = next.slice(0, MAX_VIEWER_FRAMES)
    setFiles(capped)
    setSourceLabel(label)
    setFrames(await buildDicomPreviews(capped))
    setSeriesKey(null)
    setError(null)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        // 1) Browser cache from this session's upload (user's real files)
        const cached = await loadCachedCaseDicomFiles(caseKey)
        if (cancelled) return
        if (cached?.length) {
          await paintFiles(cached, `Yüklenen çalışma · ${cached.length} dosya`)
          return
        }

        // 2) Backend quarantine (same bytes that were uploaded for the case)
        if (c.fromBackend || caseKey.startsWith('case-')) {
          try {
            const quarantined = await fetchCaseDicomFiles(caseKey)
            if (cancelled) return
            if (quarantined.length) {
              await paintFiles(quarantined, `Vaka DICOM · ${quarantined.length} dosya`)
              void cacheCaseDicomFiles(caseKey, quarantined)
              return
            }
          } catch (err) {
            // Fall through — may still have explicit demo or local drop
            if (cancelled) return
            if (!(err instanceof BackendUnavailableError) && !explicitDemoKind) {
              // Keep going to empty/demo paths
            }
          }
        }

        // 3) Only if this case was explicitly created from a demo fixture
        if (explicitDemoKind) {
          const demoFiles = await fetchDemoDicomFiles(
            explicitDemoKind,
            explicitDemoKind === 'thorax_xr' ? 1 : 12,
          )
          if (cancelled) return
          await paintFiles(demoFiles, `Demo · ${explicitDemoKind.replace(/_/g, ' ')}`)
          return
        }

        // 4) No study attached — do NOT invent synthetic images
        if (cancelled) return
        setFiles([])
        setFrames([])
        setSourceLabel('DICOM yok')
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof BackendUnavailableError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'DICOM yüklenemedi'
        setError(message)
        setFiles([])
        setFrames([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [caseKey, c.fromBackend, explicitDemoKind])

  const applyLocalFiles = async (incoming: File[], label: string) => {
    if (!incoming.length) {
      pushToast({ tone: 'warning', title: 'DICOM bulunamadı', body: 'Uygun .dcm dosyası seçilmedi.' })
      return
    }
    setBusy(true)
    setLoading(true)
    try {
      await paintFiles(incoming, label)
      void cacheCaseDicomFiles(caseKey, incoming.slice(0, MAX_VIEWER_FRAMES))
      pushToast({ tone: 'success', title: `${Math.min(incoming.length, MAX_VIEWER_FRAMES)} görüntü yüklendi`, body: label })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Önizleme oluşturulamadı')
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }

  const loadDemoOptional = async () => {
    setBusy(true)
    setLoading(true)
    setError(null)
    try {
      const kind = explicitDemoKind ?? fallbackDemoKind
      const demoFiles = await fetchDemoDicomFiles(kind, kind === 'thorax_xr' ? 1 : 12)
      await paintFiles(demoFiles, `Demo · ${kind.replace(/_/g, ' ')} (örnek)`)
    } catch (err) {
      const message =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Demo yüklenemedi'
      setError(message)
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }

  const reloadCaseStudy = async () => {
    setBusy(true)
    setLoading(true)
    setError(null)
    try {
      const quarantined = await fetchCaseDicomFiles(caseKey)
      if (!quarantined.length) {
        pushToast({
          tone: 'warning',
          title: 'Vaka DICOM bulunamadı',
          body: 'Bu vakada quarantine kaydı yok. Kendi dosyalarınızı sürükleyin.',
        })
        setFiles([])
        setFrames([])
        setSourceLabel('DICOM yok')
        return
      }
      await paintFiles(quarantined, `Vaka DICOM · ${quarantined.length} dosya`)
      void cacheCaseDicomFiles(caseKey, quarantined)
    } catch (err) {
      const message =
        err instanceof BackendUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Yükleme başarısız'
      setError(message)
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <span className="mr-1 text-sm font-medium text-navy-800">Seriler:</span>
        {seriesOptions.length > 0 ? (
          seriesOptions.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSeriesKey(s.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
                activeSeriesKey === s.key
                  ? 'bg-navy-900 text-white ring-navy-900'
                  : 'bg-white text-navy-700 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {s.label}
              <span className="ml-1.5 text-[11px] opacity-70">{s.count}</span>
            </button>
          ))
        ) : (
          <span className="text-sm text-slate-500">{loading ? 'Yükleniyor…' : 'Seri yok'}</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500">{sourceLabel}{files.length ? ` · ${files.length} dosya` : ''}</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || loading}
            icon={<FileText className="h-3.5 w-3.5" />}
            onClick={() => fileInputRef.current?.click()}
          >
            Dosya
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || loading}
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            onClick={() => folderInputRef.current?.click()}
          >
            Klasör
          </Button>
          {(c.fromBackend || caseKey.startsWith('case-')) && (
            <Button type="button" variant="ghost" size="sm" disabled={busy || loading} onClick={() => void reloadCaseStudy()}>
              Vakadan yükle
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" disabled={busy || loading} onClick={() => void loadDemoOptional()}>
            Örnek demo
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".dcm,.dicom,application/dicom,*/*"
          className="hidden"
          onChange={(e) => {
            void applyLocalFiles(collectFilesFromFileList(e.target.files), 'Yerel dosya')
            e.target.value = ''
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void applyLocalFiles(collectFilesFromFileList(e.target.files), 'Yerel klasör')
            e.target.value = ''
          }}
          {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
        />
      </div>

      <div className="p-4">
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            void (async () => {
              try {
                const collected = await collectFilesFromDataTransfer(e.dataTransfer)
                await applyLocalFiles(collected, 'Sürükle-bırak')
              } catch (err) {
                pushToast({
                  tone: 'error',
                  title: 'Klasör okunamadı',
                  body: err instanceof Error ? err.message : 'Dosyalar işlenemedi.',
                })
              }
            })()
          }}
          className={`rounded-xl ${drag ? 'ring-2 ring-[#0D827B] ring-offset-2' : ''}`}
        >
          {error && !frames.length ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-6 text-center">
              <AlertCircle className="h-8 w-8 text-rose-500" />
              <p className="mt-3 font-medium text-rose-900">Görüntü yüklenemedi</p>
              <p className="mt-1 max-w-md text-sm text-rose-800">{error}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void reloadCaseStudy()}>
                  Vakadan dene
                </Button>
                <Button size="sm" variant="secondary" icon={<UploadCloud className="h-3.5 w-3.5" />} onClick={() => fileInputRef.current?.click()}>
                  Dosya seç
                </Button>
              </div>
            </div>
          ) : !loading && !busy && !frames.length ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-[#E3EAF0] bg-[#F4F7FA] px-6 text-center">
              <UploadCloud className="h-10 w-10 text-[#0D827B]" />
              <p className="mt-3 font-medium text-[#172B45]">Bu vakaya ait DICOM henüz görüntülenemiyor</p>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                Yüklediğiniz çalışma sunucudan getirilir. Bulunamazsa kendi DICOM klasörünüzü buraya sürükleyin —
                sentetik demo otomatik açılmaz.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void reloadCaseStudy()}>
                  Vakadan yükle
                </Button>
                <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  Dosya seç
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void loadDemoOptional()}>
                  Örnek demo (isteğe bağlı)
                </Button>
              </div>
            </div>
          ) : (
            <DicomViewer frames={viewFrames} loading={loading || busy} />
          )}
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          Önce sizin yüklediğiniz DICOM (quarantine / tarayıcı önbelleği) gösterilir. Sentetik “SYNTHETIC …” görüntüler
          yalnızca isteğe bağlı örnek demoda açılır; yapay zekâ piksel analizi yapmaz.
        </p>
      </div>
    </Card>
  )
}

function ValidationBox({ v }: { v: ValidationItem }) {
  const [open, setOpen] = useState(false)
  const meta = {
    ok: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />, label: 'Kaynakla desteklendi' },
    missing: { cls: 'border-amber-200 bg-amber-50 text-amber-900', icon: <AlertTriangle className="h-4 w-4 text-amber-600" />, label: 'Eksik bilgi' },
    unsupported: { cls: 'border-rose-200 bg-rose-50 text-rose-900', icon: <XCircle className="h-4 w-4 text-rose-600" />, label: 'Kaynakla desteklenmeyen ifade' },
  }[v.kind]
  return (
    <div className={`rounded-lg border ${meta.cls}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 p-3 text-left">
        <span className="mt-0.5">{meta.icon}</span>
        <span className="flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">{meta.label}</span>
          <span className="block text-sm font-medium">{v.text}</span>
        </span>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 opacity-60 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-current/10 px-3 pb-3 pl-10 pt-2 text-sm opacity-90">
          {v.detail} <Citations ids={v.citations} />
        </div>
      )}
    </div>
  )
}

export function AssessmentView({ c, compact = false }: { c: VetCase; compact?: boolean }) {
  const ai = c.ai
  if (!ai) {
    return (
      <Card>
        <EmptyState
          icon={c.status === 'taslak' ? <FileText className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
          title={c.status === 'taslak' ? 'Henüz AI değerlendirmesi yok' : 'AI analizi sürüyor'}
          text={c.status === 'taslak' ? 'Vaka taslak durumunda; tetkikler yüklenip gönderildiğinde ön değerlendirme oluşturulacak.' : 'Ön değerlendirme hazır olduğunda burada görüntülenecek.'}
        />
      </Card>
    )
  }
  const sources = Array.from(new Set([...ai.differentials.flatMap((d) => d.citations), ...ai.findings.flatMap((f) => f.citations ?? []), ...ai.validation.flatMap((v) => v.citations ?? [])])).sort((a, b) => a - b)
  return (
    <div className="space-y-5">
      <AIDisclaimer />
      {c.backendFindings && (
        <Card>
          <CardHeader title="Yapılandırılmış mock bulgular (FastAPI)" subtitle={`${c.backendFindings.source_model_id} · ${c.backendOutcome ?? ''} · source=${c.backendFindings.source_kind}`} icon={<Brain className="h-5 w-5" />} />
          <div className="space-y-3 p-5 text-sm text-navy-800">
            <p className="rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-inset ring-amber-200">
              Bu kayıtlar sentetiktir. Eksik bulgu, hastalığın yokluğu anlamına gelmez (`absences_not_confirmed={String(c.backendFindings.absences_not_confirmed)}`).
            </p>
            {c.backendFindings.findings.length === 0 ? (
              <p>Döndürülen bulgu yok (`no_findings_returned={String(c.backendFindings.no_findings_returned)}`).</p>
            ) : (
              <ul className="space-y-2">
                {c.backendFindings.findings.map((f) => (
                  <li key={f.finding_id} className="rounded-lg border border-slate-200 p-3">
                    <p className="font-mono text-xs text-teal-700">{f.finding_id} · {f.finding_code}</p>
                    <p className="mt-1">{f.description}</p>
                    <p className="mt-1 text-xs text-slate-500">{f.anatomical_location} · status={f.finding_status} · model={f.source_model}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
      <div className={`grid gap-5 ${compact ? '' : 'xl:grid-cols-3'}`}>
        <div className={`space-y-5 ${compact ? '' : 'xl:col-span-2'}`}>
          <Card>
            <CardHeader title="Vaka Özeti" subtitle={`${ai.model} · ${fmtDate(ai.generatedAt)}`} icon={<Brain className="h-5 w-5" />} />
            <p className="p-5 text-[15px] leading-relaxed text-navy-800">{ai.summary}</p>
          </Card>
          <Card>
            <CardHeader title="Dikkat Edilmesi Gereken Bulgular" icon={<AlertCircle className="h-5 w-5" />} />
            <ul className="divide-y divide-slate-100">
              {ai.findings.map((f, i) => (
                <li key={i} className="flex items-start gap-3 px-5 py-3">
                  <SeverityBadge severity={f.severity} />
                  <p className="flex-1 text-sm text-navy-800">{f.text} <Citations ids={f.citations} /></p>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Olası Ayırıcı Tanılar" subtitle="Olasılıklar modelin göreli güvenini gösterir; klinik olasılık değildir." icon={<Stethoscope className="h-5 w-5" />} />
            <div className="divide-y divide-slate-100">
              {ai.differentials.map((d, i) => (
                <div key={i} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-navy-900">{i + 1}. {d.name} <Citations ids={d.citations} /></p>
                    <span className="font-mono text-sm font-semibold text-navy-700">%{d.probability}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${d.probability >= 50 ? 'bg-teal-500' : d.probability >= 20 ? 'bg-sky-400' : 'bg-slate-400'}`} style={{ width: `${d.probability}%` }} />
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Lehine bulgular</p>
                      <ul className="space-y-1 text-sm text-navy-800">
                        {d.pro.length ? d.pro.map((x, j) => <li key={j} className="flex gap-2"><span className="text-emerald-500">+</span>{x}</li>) : <li className="text-slate-400">—</li>}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700">Aleyhine bulgular</p>
                      <ul className="space-y-1 text-sm text-navy-800">
                        {d.con.length ? d.con.map((x, j) => <li key={j} className="flex gap-2"><span className="text-rose-500">−</span>{x}</li>) : <li className="text-slate-400">—</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Önerilen Ek Tetkikler" icon={<ClipboardList className="h-5 w-5" />} />
            <ol className="list-decimal space-y-1.5 py-4 pl-10 pr-5 text-sm text-navy-800">
              {ai.recommendedTests.map((t, i) => <li key={i}>{t}</li>)}
            </ol>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Doğrulama Raporu" subtitle="Ayrıntı için kutulara tıklayın" icon={<CheckCircle2 className="h-5 w-5" />} />
            <div className="flex gap-2 px-5 pt-4 text-xs">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">{ai.validation.filter((v) => v.kind === 'ok').length} doğrulandı</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">{ai.validation.filter((v) => v.kind === 'missing').length} eksik</span>
              <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">{ai.validation.filter((v) => v.kind === 'unsupported').length} kaynaksız</span>
            </div>
            <div className="space-y-2.5 p-5">
              {ai.validation.map((v, i) => <ValidationBox key={i} v={v} />)}
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Kaynaklar / RAG"
              subtitle={c.backendDraft?.rag_citations?.length ? 'Backend lexical/embedding RAG citations' : 'Yerel prototip kaynakları'}
              icon={<BookOpen className="h-5 w-5" />}
            />
            {c.backendDraft?.rag_citations?.length ? (
              <RagCitations citations={c.backendDraft.rag_citations} note={c.backendDraft.rag_note} />
            ) : (
              <SourceList ids={sources} />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function SourceList({ ids }: { ids: number[] }) {
  const { kbSources, openSource } = useApp()
  return (
    <ul className="divide-y divide-slate-100">
      {ids.map((id) => {
        const s = kbSources.find((k) => k.id === id)
        if (!s) return null
        return (
          <li key={id}>
            <button onClick={() => openSource(id)} className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-slate-50">
              <span className="mt-0.5 rounded bg-teal-50 px-1.5 text-[11px] font-semibold text-teal-700 ring-1 ring-inset ring-teal-200">[{id}]</span>
              <span>
                <span className="block text-sm font-medium text-navy-900">{s.title}</span>
                <span className="block text-xs text-slate-500">{s.type} · {s.section}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function ReportWorkspace({ c }: { c: VetCase }) {
  const nav = useNavigate()
  const draft = c.backendDraft
  const prov = draft
    ? `${draft.generation?.model_id ?? '—'} · v${draft.version ?? c.currentReportVersion ?? '—'}${draft.immutable ? ' · immutable' : ''}`
    : c.aiDraft
      ? 'Yerel prototip taslak'
      : null

  if (!draft && !c.aiDraft && !c.report) {
    return (
      <Card>
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="Rapor henüz yok"
          text="Analiz tamamlanıp taslak oluşunca burada görünecek. Desteklenmeyen/başarısız vakalarda AI taslağı yoktur."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-navy-900">Rapor durumu</p>
            <p className="mt-1 text-xs text-slate-600">
              {draft?.status ?? c.status}
              {draft?.expert_review_status ? ` · review=${draft.expert_review_status}` : ''}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500">{prov}</p>
            {draft?.synthetic !== false && (
              <p className="mt-2 text-xs font-semibold text-amber-800">DEMO / MOCK — klinik sertifikasyon değildir</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {c.status === 'onaylandi' && (
              <Button size="sm" onClick={() => nav(`/raporlar/${c.id}`)}>
                Print / PDF
              </Button>
            )}
            {c.status === 'uzman_incelemesinde' && (
              <Button size="sm" variant="secondary" onClick={() => nav(`/vakalar/${c.id}/inceleme`)}>
                Uzman inceleme
              </Button>
            )}
          </div>
        </div>
        {draft?.validation_warnings && draft.validation_warnings.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-950">
            {draft.validation_warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </Card>
      {(draft || c.report || c.aiDraft) && (
        <Card className="p-5">
          <dl className="space-y-4 text-sm">
            {[
              ['Teknik', draft?.technique?.text ?? c.report?.klinikOzet ?? c.aiDraft?.klinikOzet],
              ['Bulgular', draft?.findings?.text ?? c.report?.bulgular ?? c.aiDraft?.bulgular],
              ['Değerlendirme', draft?.impression?.text ?? c.report?.degerlendirme ?? c.aiDraft?.degerlendirme],
              ['Öneriler', draft?.recommendations?.text ?? c.report?.oneriler ?? c.aiDraft?.oneriler],
            ].map(([label, text]) =>
              text ? (
                <div key={String(label)}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-teal-700">{label}</dt>
                  <dd className="mt-1 whitespace-pre-line text-navy-900">{text}</dd>
                </div>
              ) : null,
            )}
          </dl>
        </Card>
      )}
    </div>
  )
}

function CaseHistoryPanel({ c }: { c: VetCase }) {
  const nav = useNavigate()
  const versions = c.reportVersions ?? []
  const [activity, setActivity] = useState<Array<{ event_id: string; kind: string; actor_subject: string; at: string; detail?: string | null }>>([])
  useEffect(() => {
    const key = c.backendCaseId || c.id
    if (!key.startsWith('case-')) {
      setActivity([])
      return
    }
    void listCaseActivity(key)
      .then(setActivity)
      .catch(() => setActivity([]))
  }, [c.backendCaseId, c.id])
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Rapor sürümleri" subtitle="Onaylı sürümler immutable — düzenlenemez" icon={<History className="h-5 w-5" />} />
        {versions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">
            {c.fromBackend ? 'Henüz sürüm kaydı yok (analiz sonrası oluşur).' : 'Yerel prototip — backend sürüm geçmişi yok.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {versions
              .slice()
              .sort((a, b) => b.version - a.version)
              .map((v) => (
                <li key={v.version} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <p className="font-semibold text-navy-900">
                      v{v.version}
                      {v.is_current ? ' · güncel' : ''}
                      {v.immutable ? ' · kilitli' : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {v.status} · {v.expert_review_status}
                      {v.reviewed_by ? ` · ${v.reviewed_by}` : ''} · {fmtDate(v.updated_at)}
                    </p>
                    {v.revision_notes && <p className="mt-1 text-xs text-slate-600">{v.revision_notes}</p>}
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                      {v.source_kind} · {v.model_id}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={v.status !== 'approved'}
                    onClick={() => nav(`/raporlar/${c.id}?version=${v.version}`)}
                  >
                    {v.status === 'approved' ? 'Görüntüle / PDF' : 'Salt okunur'}
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </Card>
      {c.fromBackend ? <ReportVersionCompare caseId={c.id} versions={versions} /> : null}
      <Card>
        <CardHeader title="İlerleme / teslimat" icon={<ClipboardList className="h-5 w-5" />} />
        <dl className="grid gap-2 px-5 py-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">Rapor hazır</dt>
            <dd className="font-medium text-navy-900">{c.reportAvailableAt ? fmtDate(c.reportAvailableAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">İletildi</dt>
            <dd className="font-medium text-navy-900">{c.reportDeliveredAt ? fmtDate(c.reportDeliveredAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Görüntülendi</dt>
            <dd className="font-medium text-navy-900">{c.reportViewedAt ? fmtDate(c.reportViewedAt) : '—'}</dd>
          </div>
        </dl>
      </Card>
      <Card>
        <CardHeader title="Vaka aktivite zaman çizelgesi" subtitle="Gerçek olaylar (sunucu)" icon={<History className="h-5 w-5" />} />
        <ul className="divide-y divide-slate-100 px-5 py-2 text-sm">
          {activity.length === 0 && c.timeline.length === 0 ? (
            <li className="py-3 text-slate-500">Kayıt yok</li>
          ) : null}
          {activity.map((e) => (
            <li key={e.event_id} className="flex gap-3 py-2">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-600" />
              <div>
                <p className="font-medium text-navy-900">{e.kind}</p>
                <p className="text-xs text-slate-500">
                  {fmtDate(e.at)} · {e.actor_subject}
                  {e.detail ? ` · ${e.detail}` : ''}
                </p>
              </div>
            </li>
          ))}
          {activity.length === 0 &&
            c.timeline.map((t, i) => (
              <li key={`${t.date}-${i}`} className="flex gap-3 py-2">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                <div>
                  <p className="font-medium text-navy-900">{t.label}</p>
                  <p className="text-xs text-slate-500">
                    {t.date}
                    {t.by ? ` · ${t.by}` : ''}
                  </p>
                </div>
              </li>
            ))}
        </ul>
      </Card>
    </div>
  )
}
