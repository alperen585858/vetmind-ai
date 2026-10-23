import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, BadgeCheck, CheckCircle2, Clock, Download, FileText, Loader2, Phone } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { ProvenanceBanner, provenanceKindFromSource } from '../components/ProvenanceBanner'
import { Logo } from '../components/Logo'
import { RagCitations } from '../components/RagCitations'
import { downloadApprovedReportPdf, getReportVersion, markReportViewed } from '../lib/backend'
import { fmtDate } from '../lib/format'
import {
  canExportApprovedReport,
  caseWithDraftVersion,
  printSectionsForCase,
  reportProvenance,
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
        Onaylı rapor backend’den yükleniyor…
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
  const provenance = reportProvenance(c)
  const showDemoPatientExtras = !c.fromBackend

  const provKind = provenanceKindFromSource(c.backendDraft?.generation?.source_kind ?? c.backendFindings?.source_kind, {
    synthetic: c.backendDraft?.synthetic ?? true,
  })

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
        <ProvenanceBanner kind={provKind} className="mb-4" compact />
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
          <p className="mt-2 text-sm text-slate-600">
            Raporda yer alan tıbbi terimler hakkında en doğru bilgiyi veteriner hekiminiz verecektir.
          </p>
          {c.clinic && (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <Phone className="h-4 w-4" /> {c.clinic}
            </p>
          )}
        </div>
      )}

      <article className="rounded-xl border border-slate-200 bg-white shadow-soft print:border-0 print:shadow-none">
        <div className="border-b border-amber-200 bg-amber-50 px-8 py-2 text-center text-[11px] font-semibold tracking-wide text-amber-950">
          {provenance.banner}
        </div>

        <header className="flex flex-col gap-4 border-b-4 border-teal-600 px-8 py-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Logo />
            <p className="mt-1 pl-[46px] text-[11px] text-slate-500">VRM Teknoloji iş birliğiyle</p>
          </div>
          <div className="text-left text-sm sm:text-right">
            <p className="text-lg font-semibold text-navy-900">Veteriner Radyoloji Değerlendirme Raporu</p>
            <p className="text-slate-500">
              Rapor No: <span className="font-mono font-medium text-navy-800">{c.reportNo ?? '—'}</span>
            </p>
            <p className="text-slate-500">
              Vaka No: <span className="font-mono">{c.no}</span>
            </p>
            <p className="text-slate-500">
              Sürüm: <span className="font-mono">{provenance.versionLabel}</span>
            </p>
            {c.backendCaseId && (
              <p className="text-slate-500">
                Case ID: <span className="font-mono text-xs">{c.backendCaseId}</span>
              </p>
            )}
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
                <dd className="text-navy-900">{provenance.reviewStatus}</dd>
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

        <section className="border-t border-slate-100 px-8 py-5 text-sm">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Kaynaklar ve provenance
          </p>
          <dl className="space-y-1">
            <div className="flex gap-2">
              <dt className="w-36 text-slate-500">Model</dt>
              <dd className="font-mono text-xs text-navy-900">{provenance.modelLine}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-36 text-slate-500">source_kind</dt>
              <dd className="font-mono text-xs uppercase text-navy-900">{provenance.sourceKind}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-36 text-slate-500">synthetic</dt>
              <dd className="font-mono text-xs text-navy-900">{String(provenance.synthetic)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-36 text-slate-500">Klinik doğrulama</dt>
              <dd className="text-navy-900">
                {c.backendDraft?.clinically_validated ? 'Evet' : 'Hayır (iddia edilmez)'}
              </dd>
            </div>
          </dl>
          {c.backendDraft?.validation_warnings && c.backendDraft.validation_warnings.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-900">
              {c.backendDraft.validation_warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </section>

        {c.backendDraft?.rag_citations && c.backendDraft.rag_citations.length > 0 && (
          <section className="border-t border-slate-100 px-8 py-6">
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-teal-700">
              RAG kaynakları (klinik kanıt değil)
            </h3>
            <p className="mb-3 text-xs text-slate-500">
              {c.backendDraft.rag_note ||
                'Lexical/embedding eşleşmeleri — görüntüleme bulgularından ayrı tutulur.'}
            </p>
            <RagCitations citations={c.backendDraft.rag_citations} note={c.backendDraft.rag_note} />
          </section>
        )}

        <footer className="flex flex-col gap-4 border-t border-slate-200 bg-slate-50/70 px-8 py-5 sm:flex-row sm:items-end sm:justify-between print:bg-white">
          <div className="flex items-start gap-3">
            <BadgeCheck className="h-8 w-8 text-emerald-600" />
            <div className="text-sm">
              <p className="text-slate-500">Onaylayan uzman</p>
              <p className="font-semibold text-navy-900">{c.approvedBy ?? '—'}</p>
              <p className="text-slate-500">Uzman onayı ≠ otomatik klinik sertifikasyon</p>
            </div>
          </div>
          <div className="text-sm sm:text-right">
            <p className="text-slate-500">Onay tarihi</p>
            <p className="font-semibold text-navy-900">{fmtDate(c.approvedAt)}</p>
          </div>
        </footer>
        <p className="px-8 py-4 text-[11px] leading-relaxed text-slate-400">
          Bu çıktı tarayıcı yazdır / PDF kaydet ile üretilir; sunucuda PDF dosyası saklanmaz. Demo veya
          yapılandırılmış adapter çıktısıdır. Uzman onayı klinik validasyon belgesi değildir.
        </p>
      </article>
    </div>
  )
}
