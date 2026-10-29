import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, BadgeCheck, CheckCircle2, Clock, Download, FileText, Loader2, Phone } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { Logo } from '../components/Logo'
import { downloadApprovedReportPdf, getReportVersion, markReportViewed } from '../lib/backend'
import { fmtDate } from '../lib/format'
import {
  canExportApprovedReport,
  caseWithDraftVersion,
  printSectionsForCase,
} from '../lib/reportPrint'
import type { BackendDraftReport, VetCase } from '../types'

export default function ApprovedReport() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const versionParam = params.get('version')
  const selectedVersion = versionParam ? Number(versionParam) : null
  const { getCase, role, user, hydrateBackendCase, pushToast } = useApp()
  const nav = useNavigate()
  const base = getCase(id)
  const [loading, setLoading] = useState(() => id.startsWith('case-') && !canExportApprovedReport(base))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [versionDraft, setVersionDraft] = useState<BackendDraftReport | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    if (!id.startsWith('case-')) {
      setLoading(false)
      setLoadError(null)
      setVersionDraft(null)
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
      if (selectedVersion != null && !Number.isNaN(selectedVersion)) {
        try {
          const snap = await getReportVersion(id, selectedVersion)
          if (cancelled) return
          setVersionDraft(snap.content)
        } catch (err) {
          if (cancelled) return
          setLoadError(err instanceof Error ? err.message : 'Rapor sürümü yüklenemedi')
          setVersionDraft(null)
        }
      } else {
        setVersionDraft(null)
      }
      if (mapped?.status === 'onaylandi' && mapped.fromBackend) {
        void markReportViewed(id).then(() => hydrateBackendCase(id)).catch(() => undefined)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [id, base?.fromBackend, base?.backendDraft, base?.status, selectedVersion, hydrateBackendCase])

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
  const reviewStatus =
    c.status === 'onaylandi'
      ? `Onaylandı${c.approvedBy ? ` · ${c.approvedBy}` : ''}`
      : c.status === 'reddedildi'
        ? 'Reddedildi'
        : c.status === 'revizyon'
          ? 'Revizyon istendi'
          : c.backendDraft?.status || c.status

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

      {role === 'owner' && (
        <div className="no-print mb-6 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-7 w-7 text-emerald-600" />
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

      <article className="rounded-xl border border-slate-200 bg-white shadow-soft print:border-0 print:shadow-none">
        <header className="flex flex-col gap-4 border-b-4 border-teal-600 px-8 py-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Logo />
          </div>
          <div className="text-left text-sm sm:text-right">
            <p className="text-lg font-semibold text-navy-900">Veteriner Radyoloji Değerlendirme Raporu</p>
            <p className="text-slate-500">
              Rapor No: <span className="font-mono font-medium text-navy-800">{c.reportNo ?? '—'}</span>
            </p>
            <p className="text-slate-500">
              Vaka No: <span className="font-mono">{c.no}</span>
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
                <h3 className="mb-2 border-b border-slate-100 pb-1 text-sm font-semibold uppercase tracking-wide text-teal-700">
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
    </div>
  )
}
