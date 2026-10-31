import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  Phone,
  Send,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { Logo } from '../components/Logo'
import { ReportRevisionSimple } from '../components/ReportRevisionSimple'
import {
  downloadApprovedReportPdf,
  getReportVersion,
  listReportVersions,
  markReportViewed,
  submitBackendReview,
} from '../lib/backend'
import { fmtDate } from '../lib/format'
import {
  canExportApprovedReport,
  caseWithDraftVersion,
  printSectionsForCase,
} from '../lib/reportPrint'
import type { BackendDraftReport, BackendReportVersionSummary, VetCase } from '../types'

export default function ApprovedReport() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const versionParam = params.get('version')
  const selectedVersion = versionParam ? Number(versionParam) : null
  const { getCase, role, user, hydrateBackendCase, pushToast } = useApp()
  const nav = useNavigate()
  const base = getCase(id)
  const [loading, setLoading] = useState(() => id.startsWith('case-') && !canExportApprovedReport(base))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [versionDraft, setVersionDraft] = useState<BackendDraftReport | null>(null)
  const [versionList, setVersionList] = useState<BackendReportVersionSummary[]>([])
  const [pdfBusy, setPdfBusy] = useState(false)
  const [reviseOpen, setReviseOpen] = useState(false)
  const [reviseNote, setReviseNote] = useState('')
  const [revising, setRevising] = useState(false)
  const [versionSwitching, setVersionSwitching] = useState(false)
  const viewedRef = useRef<string | null>(null)

  // Load case + version list once per case id (do NOT depend on hydrate fields — that caused a flash loop).
  useEffect(() => {
    if (!id.startsWith('case-')) {
      setLoading(false)
      setLoadError(null)
      setVersionDraft(null)
      setVersionList([])
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    void (async () => {
      const mapped =
        base?.fromBackend && canExportApprovedReport(base) ? base : await hydrateBackendCase(id)
      if (cancelled) return
      if (!mapped) {
        setLoadError(
          'Backend raporu yüklenemedi. API kapalıysa veya oturum yoksa PDF/print kullanılamaz.',
        )
        setLoading(false)
        return
      }
      try {
        const versions = await listReportVersions(id)
        if (!cancelled) setVersionList(versions)
      } catch {
        if (!cancelled) setVersionList(mapped.reportVersions ?? [])
      }
      if (!cancelled) setLoading(false)
      if (mapped.status === 'onaylandi' && mapped.fromBackend && viewedRef.current !== id) {
        viewedRef.current = id
        void markReportViewed(id).catch(() => undefined)
      }
    })()
    return () => {
      cancelled = true
    }
    // intentionally only re-run when navigating to another case
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hydrateBackendCase])

  // Soft-switch printable body when ?version= changes — keep old text until new arrives (no flash).
  useEffect(() => {
    if (!id.startsWith('case-')) {
      setVersionDraft(null)
      return
    }
    if (selectedVersion == null || Number.isNaN(selectedVersion)) {
      setVersionDraft(null)
      setVersionSwitching(false)
      return
    }
    let cancelled = false
    setVersionSwitching(true)
    void getReportVersion(id, selectedVersion)
      .then((snap) => {
        if (!cancelled) setVersionDraft(snap.content)
      })
      .catch((err) => {
        if (cancelled) return
        pushToast({
          tone: 'error',
          title: 'Sürüm yüklenemedi',
          body: err instanceof Error ? err.message : undefined,
        })
      })
      .finally(() => {
        if (!cancelled) setVersionSwitching(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, selectedVersion, pushToast])

  const c: VetCase | undefined = useMemo(() => {
    if (!base) return undefined
    if (versionDraft) return caseWithDraftVersion(base, versionDraft)
    return base
  }, [base, versionDraft])

  const downloadServerPdf = async () => {
    const caseKey = c?.backendCaseId || c?.id || id
    if (!caseKey.startsWith('case-')) {
      window.print()
      return
    }
    setPdfBusy(true)
    try {
      const blob = await downloadApprovedReportPdf(
        caseKey,
        selectedVersion && Number.isFinite(selectedVersion) ? selectedVersion : undefined,
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vetmind-${caseKey}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      pushToast({
        tone: 'error',
        title: 'PDF indirilemedi',
        body: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setPdfBusy(false)
    }
  }

  const openRevision = async () => {
    const caseKey = c?.backendCaseId || c?.id || id
    if (!caseKey.startsWith('case-') || revising) return
    const note = reviseNote.trim()
    if (note.length < 10) {
      pushToast({ tone: 'warning', title: 'Gerekçe gerekli', body: 'En az 10 karakter yazın.' })
      return
    }
    setRevising(true)
    try {
      await submitBackendReview(caseKey, {
        action: 'request_revision',
        comment: note,
        reason_codes: ['report_quality'],
      })
      await hydrateBackendCase(caseKey)
      setReviseOpen(false)
      setReviseNote('')
      pushToast({
        tone: 'success',
        title: 'Yeni sürüm açıldı',
        body: 'Önceki onaylı sürüm kilitli kaldı. Çalışma alanında düzenleyip yeniden onaylayın.',
      })
      nav(`/vakalar/${caseKey}/calisma`)
    } catch (e) {
      pushToast({
        tone: 'error',
        title: 'Revizyon açılamadı',
        body: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setRevising(false)
    }
  }

  if (loading) {
    return (
      <Card className="flex items-center gap-3 p-6 text-sm text-slate-600">
        <Loader2 className="h-5 w-5 animate-spin text-teal-600" />
        Onaylı rapor yükleniyor…
      </Card>
    )
  }

  if (loadError && !c) {
    return (
      <Card>
        <EmptyState
          icon={<AlertCircle className="h-6 w-6" />}
          title="Rapor yüklenemedi"
          text={loadError}
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setLoading(true)
                void hydrateBackendCase(id).then((mapped) => {
                  if (!mapped) {
                    setLoadError(
                      'Backend raporu yüklenemedi. API kapalıysa veya oturum yoksa PDF/print kullanılamaz.',
                    )
                  } else {
                    setLoadError(null)
                  }
                  setLoading(false)
                })
              }}
            >
              Tekrar dene
            </Button>
          }
        />
      </Card>
    )
  }

  // Seed owner gate: match owner name. Backend cases rely on route Gate roles.
  if (
    !c ||
    (role === 'owner' &&
      !c.fromBackend &&
      c.patient.ownerName !== user?.name &&
      c.petOwnerSubject !== user?.email)
  ) {
    return <Card><EmptyState icon={<FileText className="h-6 w-6" />} title="Rapor bulunamadı" /></Card>
  }

  if (c.status !== 'onaylandi' || !canExportApprovedReport(c)) {
    return (
      <Card>
        <EmptyState
          icon={<Clock className="h-6 w-6" />}
          title="Rapor henüz onaylanmadı"
          text={
            loadError ||
            'Rapor uzman veteriner hekim tarafından onaylandığında burada görüntülenecek. Backend taslağı yoksa print/PDF açılamaz.'
          }
          action={<Link to="/" className="text-sm font-medium text-teal-700">Ana sayfaya dön</Link>}
        />
      </Card>
    )
  }

  const p = c.patient
  const sections = printSectionsForCase(c)
  const showDemoPatientExtras = !c.fromBackend
  const versions =
    versionList.length > 0
      ? versionList
      : c.reportVersions ?? []
  const sortedVersions = [...versions].sort((a, b) => a.version - b.version)
  const hasRevisionHistory = sortedVersions.length > 1
  const currentVer =
    selectedVersion && Number.isFinite(selectedVersion)
      ? selectedVersion
      : c.currentReportVersion ?? sortedVersions[sortedVersions.length - 1]?.version ?? 1
  const reviewStatus =
    c.status === 'onaylandi'
      ? `Onaylandı${c.approvedBy ? ` · ${c.approvedBy}` : ''}`
      : c.status === 'reddedildi'
        ? 'Reddedildi'
        : c.status === 'revizyon'
          ? 'Revizyon istendi'
          : c.backendDraft?.status || c.status

  const selectVersion = (v: number) => {
    const next = new URLSearchParams(params)
    next.set('version', String(v))
    setParams(next, { replace: true })
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print">
        <PageHeader
          title="Onaylı rapor"
          subtitle={`${c.patient.name} · ${c.no}`}
          crumbs={[
            { label: role === 'owner' ? 'Raporlarım' : 'Vakalar', to: role === 'owner' ? '/raporlar' : '/vakalar' },
            { label: c.no, to: `/vakalar/${c.id}` },
            { label: 'Rapor' },
          ]}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => nav(-1)}>
                Geri
              </Button>
              {role === 'expert' && id.startsWith('case-') && (
                <Button variant="secondary" icon={<Send className="h-4 w-4" />} onClick={() => setReviseOpen(true)}>
                  Revize et
                </Button>
              )}
              {import.meta.env.MODE !== 'share' && (
                <>
                  <Button
                    icon={<Download className="h-4 w-4" />}
                    onClick={() => void downloadServerPdf()}
                    disabled={!sections.length || pdfBusy}
                  >
                    {pdfBusy ? 'PDF hazırlanıyor…' : 'PDF indir'}
                  </Button>
                  <Button variant="secondary" onClick={() => window.print()} disabled={!sections.length}>
                    Yazdır
                  </Button>
                </>
              )}
            </div>
          }
        />
      </div>

      {loadError && (
        <div className="no-print mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {loadError}
        </div>
      )}

      {hasRevisionHistory && (
        <div className="no-print mb-5 space-y-3">
          <div className="inline-flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {sortedVersions.map((v) => {
                const active = v.version === currentVer
                const isLatest = v.version === sortedVersions[sortedVersions.length - 1]?.version
                return (
                  <button
                    key={v.version}
                    type="button"
                    onClick={() => selectVersion(v.version)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                      active ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600 hover:text-navy-900'
                    }`}
                  >
                    {isLatest ? `Güncel (v${v.version})` : `Önceki (v${v.version})`}
                  </button>
                )
              })}
            </div>
            {versionSwitching ? (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </span>
            ) : null}
          </div>
          <ReportRevisionSimple caseId={id} versions={sortedVersions} />
        </div>
      )}

      {role === 'owner' && (
        <div className="no-print mb-6 rounded-xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-navy-50 p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-7 w-7 text-sky-600" />
            <h2 className="text-xl font-semibold text-navy-900">Raporunuz hazır</h2>
          </div>
          <p className="mt-3 text-[15px] leading-relaxed text-navy-800">
            <strong>{p.name}</strong> için hazırlanan değerlendirme raporu
            {c.approvedBy ? (
              <>
                , uzman <strong>{c.approvedBy}</strong> tarafından {fmtDate(c.approvedAt)} tarihinde incelenip onaylanmıştır.
              </>
            ) : (
              <> onaylanmıştır.</>
            )}
          </p>
          {c.clinic && (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <Phone className="h-4 w-4" /> {c.clinic}
            </p>
          )}
        </div>
      )}

      <article
        className={`rounded-xl border border-slate-200 bg-white shadow-soft print:border-0 print:shadow-none ${
          versionSwitching ? 'opacity-70 transition-opacity' : ''
        }`}
      >
        <header
          className={`flex flex-col gap-4 border-b-4 px-8 py-6 sm:flex-row sm:items-start sm:justify-between ${
            role === 'owner' ? 'border-sky-500' : 'border-teal-600'
          }`}
        >
          <div>
            <Logo accent={role === 'owner' ? 'sky' : 'teal'} />
          </div>
          <div className="text-left text-sm sm:text-right">
            <p className="text-lg font-semibold text-navy-900">Veteriner Radyoloji Değerlendirme Raporu</p>
            <p className="text-slate-500">
              Rapor No: <span className="font-mono font-medium text-navy-800">{c.reportNo ?? '—'}</span>
            </p>
            <p className="text-slate-500">
              Vaka No: <span className="font-mono">{c.no}</span>
              {hasRevisionHistory ? (
                <>
                  {' '}
                  · <span className="font-semibold text-navy-800">v{currentVer}</span>
                </>
              ) : null}
            </p>
          </div>
        </header>

        <section className="grid gap-6 border-b border-slate-100 px-8 py-5 text-sm sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Hasta bilgileri</p>
            <dl className="space-y-1">
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">Ad</dt>
                <dd className="font-medium text-navy-900">{p.name}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">Tür / Irk</dt>
                <dd className="text-navy-900">
                  {p.species} · {p.breed}
                </dd>
              </div>
              {showDemoPatientExtras && (
                <>
                  <div className="flex gap-2">
                    <dt className="w-28 text-slate-500">Cinsiyet</dt>
                    <dd className="text-navy-900">
                      {p.sex}, {p.neutered ? 'kısırlaştırılmış' : 'kısırlaştırılmamış'}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 text-slate-500">Yaş / Kilo</dt>
                    <dd className="text-navy-900">
                      {p.age} yaş · {p.weight} kg
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 text-slate-500">Sahip</dt>
                    <dd className="text-navy-900">{p.ownerName}</dd>
                  </div>
                </>
              )}
            </dl>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">İnceleme / klinik</p>
            <dl className="space-y-1">
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">Klinik</dt>
                <dd className="text-navy-900">{c.clinic || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">Modalite</dt>
                <dd className="text-navy-900">{c.modality ?? '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">Bölge</dt>
                <dd className="text-navy-900">{c.anatomicalRegion ?? '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">Başvuru</dt>
                <dd className="text-navy-900">{fmtDate(c.createdAt)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">İnceleme</dt>
                <dd className="text-navy-900">{reviewStatus}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">Radyolog</dt>
                <dd className="text-navy-900">{c.approvedBy || c.backendDraft?.reviewed_by || '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">Onay tarihi</dt>
                <dd className="text-navy-900">
                  {c.approvedAt
                    ? fmtDate(c.approvedAt)
                    : c.reportAvailableAt
                      ? fmtDate(c.reportAvailableAt)
                      : c.backendDraft?.updated_at
                        ? fmtDate(c.backendDraft.updated_at)
                        : '—'}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 text-slate-500">Teslimat</dt>
                <dd className="text-navy-900">
                  {c.reportViewedAt
                    ? `Görüldü · ${fmtDate(c.reportViewedAt)}`
                    : c.reportDeliveredAt
                      ? `İletildi · ${fmtDate(c.reportDeliveredAt)}`
                      : c.reportAvailableAt
                        ? 'Hazır'
                        : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="space-y-6 px-8 py-6">
          {sections.length === 0 ? (
            <p className="text-sm text-rose-700">Rapor gövdesi boş — print/PDF içeriği yok.</p>
          ) : (
            sections.map((s) => (
              <div key={s.key}>
                <h3
                  className={`mb-2 border-b border-slate-100 pb-1 text-sm font-semibold uppercase tracking-wide ${
                    role === 'owner' ? 'text-sky-700' : 'text-teal-700'
                  }`}
                >
                  {s.label}
                </h3>
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-navy-900">{s.text}</p>
              </div>
            ))
          )}
        </section>

        <footer className="border-t border-slate-200 bg-slate-50/70 px-8 py-5 print:bg-white">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-start gap-3">
              <BadgeCheck className="h-8 w-8 text-emerald-600" />
              <div className="text-sm">
                <p className="text-slate-500">Onaylayan uzman</p>
                <p className="font-semibold text-navy-900">{c.approvedBy ?? '—'}</p>
              </div>
            </div>
            <div className="text-sm sm:text-right">
              <p className="text-slate-500">Onay tarihi</p>
              <p className="font-semibold text-navy-900">{fmtDate(c.approvedAt)}</p>
            </div>
          </div>
          <p className="mt-5 border-t border-slate-200/80 pt-4 text-[10px] font-medium text-slate-500">
            VRM Görüntüleme ve Veteriner Sağlık Hizmetleri Tic. A.Ş. işbirliğiyle
          </p>
        </footer>
      </article>

      <Modal
        open={reviseOpen}
        onClose={() => {
          if (!revising) setReviseOpen(false)
        }}
        title="Onaylı raporu revize et?"
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={revising} onClick={() => setReviseOpen(false)}>
              Vazgeç
            </Button>
            <Button
              size="sm"
              disabled={revising || reviseNote.trim().length < 10}
              icon={revising ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              onClick={() => void openRevision()}
            >
              {revising ? 'Açılıyor…' : 'Yeni sürüm aç'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            Mevcut onaylı sürüm <strong className="text-navy-900">kilitli kalır</strong>. Yeni düzenlenebilir sürüm
            açılır; çalışma alanında düzenleyip yeniden onaylarsınız.
          </p>
          <label className="block">
            <span className="label">Revizyon gerekçesi (zorunlu)</span>
            <textarea
              data-autofocus
              className="input mt-1 min-h-[96px]"
              placeholder="Örn. İzlem bölümü netleştirilecek, ayırıcı tanılar güncellenecek…"
              value={reviseNote}
              onChange={(e) => setReviseNote(e.target.value)}
              disabled={revising}
            />
          </label>
          <p className={`text-xs ${reviseNote.trim().length < 10 ? 'font-medium text-amber-700' : 'text-slate-500'}`}>
            {reviseNote.trim().length < 10
              ? `En az 10 karakter gerekli (${reviseNote.trim().length}/10)`
              : `${reviseNote.trim().length} karakter · hazır`}
          </p>
        </div>
      </Modal>
    </div>
  )
}
