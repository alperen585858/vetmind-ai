import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, FilePlus2, FolderOpen, RefreshCw, Search, UploadCloud } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { CaseTable } from '../components/CaseTable'
import { EmptyState } from '../components/EmptyState'
import { STATUS_META, STATUS_ORDER } from '../components/StatusBadge'
import type { BackendModality, CaseStatus } from '../types'

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-3 p-4" aria-busy="true" aria-label="Vakalar yükleniyor">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="h-10 w-24 rounded bg-slate-100" />
          <div className="h-10 flex-1 rounded bg-slate-100" />
          <div className="h-10 w-28 rounded bg-slate-100" />
          <div className="h-10 w-20 rounded bg-slate-100" />
          <div className="h-10 w-24 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

export default function CaseList() {
  const { cases, role, refreshBackendCases, backendSyncing, pushToast } = useApp()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<CaseStatus | ''>('')
  const [species, setSpecies] = useState('')
  const [modality, setModality] = useState<BackendModality | ''>('')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [initialLoad, setInitialLoad] = useState(true)

  useEffect(() => {
    let cancelled = false
    void refreshBackendCases().then((r) => {
      if (cancelled) return
      if (!r.ok && r.error) setSyncError(r.error)
      else setSyncError(null)
      setInitialLoad(false)
    })
    return () => {
      cancelled = true
    }
  }, [refreshBackendCases])

  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('tr')
    return cases.filter(
      (c) =>
        (!status || c.status === status) &&
        (!species || c.patient.species === species) &&
        (!modality || c.modality === modality) &&
        (!s ||
          [c.no, c.patient.name, c.patient.breed, c.modality, c.anatomicalRegion, c.studyInstanceUid]
            .filter(Boolean)
            .some((f) => String(f).toLocaleLowerCase('tr').includes(s))),
    )
  }, [cases, q, status, species, modality])

  const backendCount = cases.filter((c) => c.fromBackend).length

  const onSync = async () => {
    const r = await refreshBackendCases()
    if (r.ok) {
      setSyncError(null)
      pushToast({ tone: 'success', title: 'Vakalar güncellendi', body: `${r.count} backend vakası yüklendi.` })
    } else {
      setSyncError(r.error ?? 'Backend kapalı olabilir.')
      pushToast({ tone: 'error', title: 'Senkron başarısız', body: r.error ?? 'Backend kapalı olabilir.' })
    }
  }

  const showSkeleton = initialLoad && backendSyncing && cases.length === 0

  return (
    <>
      <PageHeader
        title="Vakalar"
        subtitle={`${cases.length} vaka · ${backendCount} backend · görüntüleme vaka yönetimi`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<RefreshCw className={`h-4 w-4 ${backendSyncing ? 'animate-spin' : ''}`} />}
              onClick={() => void onSync()}
              disabled={backendSyncing}
            >
              Yenile
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

      {syncError && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Backend senkronu başarısız.</strong> Yerel kayıtlar gösteriliyor. {syncError}
            </span>
          </p>
          <Button size="sm" variant="secondary" onClick={() => void onSync()} disabled={backendSyncing}>
            Tekrar dene
          </Button>
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Hasta, vaka no, modalite, study UID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="input lg:w-48" value={status} onChange={(e) => setStatus(e.target.value as CaseStatus | '')}>
            <option value="">Tüm durumlar</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
          <select className="input lg:w-36" value={species} onChange={(e) => setSpecies(e.target.value)}>
            <option value="">Tüm türler</option>
            <option>Köpek</option>
            <option>Kedi</option>
          </select>
          <select
            className="input lg:w-32"
            value={modality}
            onChange={(e) => setModality(e.target.value as BackendModality | '')}
          >
            <option value="">Modalite</option>
            <option value="MR">MR</option>
            <option value="CT">CT</option>
            <option value="XR">XR</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
          {STATUS_ORDER.map((s) => {
            const n = cases.filter((c) => c.status === s).length
            const active = status === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(active ? '' : s)}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                  active ? STATUS_META[s].cls : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {STATUS_META[s].label} <span className="ml-1 opacity-70">{n}</span>
              </button>
            )
          })}
        </div>

        {showSkeleton ? (
          <TableSkeleton />
        ) : filtered.length ? (
          <CaseTable cases={filtered} showPriority={role === 'expert'} />
        ) : cases.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-6 w-6" />}
            title="Henüz vaka yok"
            text="DICOM yükleyerek veya Yeni Vaka ile başlayın. Demo analiz mock AI kullanır."
            action={
              role === 'vet' ? (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => nav('/dicom-yukle')}>
                    DICOM Yükle
                  </Button>
                  <Button size="sm" onClick={() => nav('/vakalar/yeni')}>
                    Yeni Vaka
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            icon={<FolderOpen className="h-6 w-6" />}
            title="Eşleşen vaka bulunamadı"
            text="Filtreleri temizleyerek tekrar deneyin."
            action={
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => {
                  setQ('')
                  setStatus('')
                  setSpecies('')
                  setModality('')
                }}
              >
                Filtreleri temizle
              </Button>
            }
          />
        )}
      </Card>
    </>
  )
}
