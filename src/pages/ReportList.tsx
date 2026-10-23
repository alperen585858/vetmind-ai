import { useNavigate } from 'react-router-dom'
import { FileCheck2, FileText } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { SpeciesIcon } from '../components/CaseTable'
import { fmtDate } from '../lib/format'

export default function ReportList() {
  const { cases, role, user } = useApp()
  const nav = useNavigate()
  const reports = cases.filter((c) => {
    if (c.status !== 'onaylandi') return false
    if (role !== 'owner') return true
    // Backend cases: ACL already scoped; match by pet owner subject or legacy display name.
    if (c.fromBackend) {
      return !c.petOwnerSubject || c.petOwnerSubject === user?.email || c.patient.ownerName === user?.email
    }
    return c.patient.ownerName === user?.name
  })
  return (
    <>
      <PageHeader
        title={role === 'owner' ? 'Raporlarım' : 'Onaylı raporlar'}
        subtitle="Onaylanmış, yazdırılabilir raporlar"
        crumbs={[{ label: 'Ana sayfa', to: '/' }, { label: role === 'owner' ? 'Raporlarım' : 'Raporlar' }]}
      />
      <Card>
        {reports.length ? (
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
                    {c.reportNo ?? c.no} · Onaylayan: {c.approvedBy ?? '—'} · {fmtDate(c.approvedAt)}
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
