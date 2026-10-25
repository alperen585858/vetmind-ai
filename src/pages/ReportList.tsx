import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, FileCheck2, FileText, Loader2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { SpeciesIcon } from '../components/CaseTable'
import { fmtDate } from '../lib/format'

export default function ReportList() {
  const { cases, role, session, refreshBackendCases } = useApp()
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Cases live only in the backend; fetch on mount so a page refresh does not show an empty list.
  useEffect(() => {
    let cancelled = false
    void refreshBackendCases().then((r) => {
      if (cancelled) return
      setLoadError(r.ok ? null : 'Raporlar yüklenemedi. Sunucu bağlantısını kontrol edin.')
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [refreshBackendCases])

  // Owners see reports for their own pets (pet_owner_subject is the owner's login email).
  const reports = cases.filter(
    (c) => c.status === 'onaylandi' && (role !== 'owner' || (c.petOwnerSubject ?? c.patient.ownerName) === session?.email),
  )
  return (
    <>
      <PageHeader
        title={role === 'owner' ? 'Raporlarım' : 'Onaylı Raporlar'}
        subtitle="Uzman onayı sonrası yayınlanan raporlar · yazdırılabilir PDF"
        crumbs={[{ label: 'Kontrol Paneli', to: '/' }, { label: role === 'owner' ? 'Raporlarım' : 'Onaylı Raporlar' }]}
      />
      <Card>
        {loading && !reports.length ? (
          <EmptyState icon={<Loader2 className="h-6 w-6 animate-spin" />} title="Raporlar yükleniyor…" />
        ) : loadError && !reports.length ? (
          <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title="Raporlar yüklenemedi" text={loadError} />
        ) : reports.length ? (
          <ul className="divide-y divide-slate-100">
            {reports.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <FileCheck2 className="h-5 w-5" aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-navy-900">
                    <SpeciesIcon species={c.patient.species} /> {c.patient.name} — Nöroloji Değerlendirme Raporu
                  </p>
                  <p className="text-xs text-slate-500">
                    {c.reportNo ?? c.no}
                    {c.approvedBy ? ` · Onaylayan: ${c.approvedBy}` : ''}
                    {c.approvedAt || c.reportAvailableAt ? ` · ${fmtDate(c.approvedAt ?? c.reportAvailableAt)}` : ''}
                    {c.reportViewedAt ? ' · görüldü' : c.reportDeliveredAt ? ' · iletildi' : ''}
                  </p>
                </div>
                <Button variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => nav(`/raporlar/${c.id}`)}>Raporu aç</Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<FileText className="h-6 w-6" />}
            title="Henüz onaylanmış rapor yok"
            text={role === 'owner' ? 'Rapor onaylandığında burada görünecek.' : 'İş listesinden onaylanan vakalar burada listelenir.'}
            action={
              role === 'vet' ? (
                <Button size="sm" onClick={() => nav('/vakalar/yeni')}>
                  Yeni vaka oluştur
                </Button>
              ) : role === 'expert' ? (
                <Button size="sm" onClick={() => nav('/kuyruk')}>
                  İş listesine git
                </Button>
              ) : undefined
            }
          />
        )}
      </Card>
    </>
  )
}
