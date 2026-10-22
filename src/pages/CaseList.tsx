import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FilePlus2, FolderOpen, RefreshCw, Search, UploadCloud } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { CaseTable } from '../components/CaseTable'
import { EmptyState } from '../components/EmptyState'
import { STATUS_META, STATUS_ORDER } from '../components/StatusBadge'
import type { CaseStatus } from '../types'

export default function CaseList() {
  const { cases, role, refreshBackendCases, backendSyncing, pushToast } = useApp()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<CaseStatus | ''>('')
  const [species, setSpecies] = useState('')

  useEffect(() => {
    void refreshBackendCases().then((r) => {
      if (!r.ok && r.error) {
        // Soft fail: keep local seeds; user can retry.
        console.warn(r.error)
      }
    })
  }, [refreshBackendCases])

  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('tr')
    return cases.filter(
      (c) =>
        (!status || c.status === status) &&
        (!species || c.patient.species === species) &&
        (!s || [c.no, c.patient.name, c.patient.breed, c.patient.ownerName].some((f) => f.toLocaleLowerCase('tr').includes(s))),
    )
  }, [cases, q, status, species])

  const backendCount = cases.filter((c) => c.fromBackend).length

  const onSync = async () => {
    const r = await refreshBackendCases()
    if (r.ok) {
      pushToast({ tone: 'success', title: 'Backend senkronize', body: `${r.count} vaka SQLite’tan yüklendi.` })
    } else {
      pushToast({ tone: 'error', title: 'Senkron başarısız', body: r.error ?? 'Backend kapalı olabilir.' })
    }
  }

  return (
    <>
      <PageHeader
        title="Vakalar"
        subtitle={`${cases.length} vaka · ${backendCount} backend · Nöroloji`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<RefreshCw className={`h-4 w-4 ${backendSyncing ? 'animate-spin' : ''}`} />} onClick={() => void onSync()} disabled={backendSyncing}>
              Backend’den yenile
            </Button>
            {role === 'vet' && (
              <>
                <Button variant="secondary" icon={<UploadCloud className="h-4 w-4" />} onClick={() => nav('/dicom-yukle')}>
                  DICOM Yükle
                </Button>
                <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => nav('/vakalar/yeni')}>
                  Yeni Vaka
                </Button>
              </>
            )}
          </div>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Vaka no, hasta adı, ırk veya sahip ara…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input md:w-56" value={status} onChange={(e) => setStatus(e.target.value as CaseStatus | '')}>
            <option value="">Tüm durumlar</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUS_META[s].label}</option>
            ))}
          </select>
          <select className="input md:w-40" value={species} onChange={(e) => setSpecies(e.target.value)}>
            <option value="">Tüm türler</option>
            <option>Köpek</option>
            <option>Kedi</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
          {STATUS_ORDER.map((s) => {
            const n = cases.filter((c) => c.status === s).length
            const active = status === s
            return (
              <button
                key={s}
                onClick={() => setStatus(active ? '' : s)}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${active ? STATUS_META[s].cls : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
              >
                {STATUS_META[s].label} <span className="ml-1 opacity-70">{n}</span>
              </button>
            )
          })}
        </div>
        {filtered.length ? <CaseTable cases={filtered} showPriority={role === 'expert'} /> : <EmptyState icon={<FolderOpen className="h-6 w-6" />} title="Eşleşen vaka bulunamadı" text="Filtreleri temizleyerek tekrar deneyin." />}
      </Card>
    </>
  )
}
