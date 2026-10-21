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
  const reports = cases.filter((c) => c.status === 'onaylandi' && (role !== 'owner' || c.patient.ownerName === user?.name))
  return (
    <>
      <PageHeader title={role === 'owner' ? 'Raporlarım' : 'Onaylı Raporlar'} subtitle="Uzman veteriner hekim tarafından onaylanarak yayınlanan raporlar" />
      <Card>
        {reports.length ? (
          <ul className="divide-y divide-slate-100">
            {reports.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <FileCheck2 className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <p className="flex items-center gap-2 font-semibold text-navy-900">
                    <SpeciesIcon species={c.patient.species} /> {c.patient.name} — Nöroloji Değerlendirme Raporu
                  </p>
                  <p className="text-xs text-slate-500">
                    {c.reportNo} · Onaylayan: {c.approvedBy} · {fmtDate(c.approvedAt)}
                  </p>
                </div>
                <Button variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => nav(`/raporlar/${c.id}`)}>Raporu aç</Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<FileText className="h-6 w-6" />} title="Henüz onaylanmış rapor yok" />
        )}
      </Card>
    </>
  )
}
