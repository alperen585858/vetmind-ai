import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FilePlus2,
  FolderOpen,
  RefreshCw,
  Search,
  UploadCloud,
  Users,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { CaseTable } from '../components/CaseTable'
import { EmptyState } from '../components/EmptyState'
import { STATUS_META, STATUS_ORDER } from '../components/StatusBadge'
import type { BackendModality, CaseStatus, VetCase } from '../types'

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-3 p-4" aria-busy="true" aria-label="Vakalar yükleniyor">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="h-10 w-10 rounded bg-slate-100" />
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

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
  active,
  onClick,
}: {
  label: string
  value: number
  hint: string
  icon: ReactNode
  tone: 'slate' | 'amber' | 'emerald' | 'rose'
  active?: boolean
  onClick?: () => void
}) {
  const tones = {
    slate: 'from-slate-50 to-white text-navy-800 ring-slate-200',
    amber: 'from-amber-50 to-white text-amber-950 ring-amber-200',
    emerald: 'from-emerald-50 to-white text-emerald-950 ring-emerald-200',
    rose: 'from-rose-50 to-white text-rose-950 ring-rose-200',
  }
  const iconTone = {
    slate: 'bg-slate-100 text-slate-600',
    amber: 'bg-amber-100 text-amber-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    rose: 'bg-rose-100 text-rose-700',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl bg-gradient-to-br p-4 text-left ring-1 ring-inset transition hover:shadow-sm ${tones[tone]} ${
        active ? 'ring-2 ring-teal-500/50 shadow-sm' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight">{value}</p>
          <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconTone[tone]}`}>{icon}</span>
      </div>
    </button>
  )
}

function expertKey(c: VetCase): string {
  return c.assignedReviewerId?.trim() || ''
}

export default function CaseList() {
  const { cases, role, refreshBackendCases, backendSyncing, pushToast } = useApp()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<CaseStatus | ''>('')
  const [species, setSpecies] = useState('')
  const [modality, setModality] = useState<BackendModality | ''>('')
  const [expert, setExpert] = useState('')
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

  const experts = useMemo(() => {
    const set = new Set<string>()
    for (const c of cases) {
      const k = expertKey(c)
      if (k) set.add(k)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'))
  }, [cases])

  const counts = useMemo(() => {
    const byStatus = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<CaseStatus, number>
    for (const c of cases) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1
    const total = cases.length
    const review = byStatus.uzman_incelemesinde ?? 0
    const approved = byStatus.onaylandi ?? 0
    const failed = (byStatus.analiz_basarisiz ?? 0) + (byStatus.reddedildi ?? 0)
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
    return { byStatus, total, review, approved, failed, pct }
  }, [cases])

  const filtered = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('tr')
    return cases.filter(
      (c) =>
        (!status || c.status === status) &&
        (!species || c.patient.species === species) &&
        (!modality || c.modality === modality) &&
        (!expert || expertKey(c) === expert) &&
        (!s ||
          [c.no, c.patient.name, c.patient.breed, c.modality, c.anatomicalRegion, c.studyInstanceUid, c.assignedReviewerId]
            .filter(Boolean)
            .some((f) => String(f).toLocaleLowerCase('tr').includes(s))),
    )
  }, [cases, q, status, species, modality, expert])

  const onSync = async () => {
    const r = await refreshBackendCases()
    if (r.ok) {
      setSyncError(null)
      pushToast({ tone: 'success', title: 'Vakalar güncellendi', body: `${r.count} vaka yüklendi.` })
    } else {
      setSyncError(r.error ?? 'Backend kapalı olabilir.')
      pushToast({ tone: 'error', title: 'Senkron başarısız', body: r.error ?? 'Backend kapalı olabilir.' })
    }
  }

  const clearFilters = () => {
    setQ('')
    setStatus('')
    setSpecies('')
    setModality('')
    setExpert('')
  }

  const showSkeleton = initialLoad && backendSyncing && cases.length === 0

  return (
    <>
      <PageHeader
        title="Vakalar"
        subtitle="Klinik vaka listesi · filtrele, incele, yönlendir"
        crumbs={[{ label: 'Kontrol Paneli', to: '/' }, { label: 'Vakalar' }]}
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
              <strong>Senkron başarısız.</strong> Yerel kayıtlar gösteriliyor. {syncError}
            </span>
          </p>
          <Button size="sm" variant="secondary" onClick={() => void onSync()} disabled={backendSyncing}>
            Tekrar dene
          </Button>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Toplam Vaka"
          value={counts.total}
          hint={counts.total ? `${counts.pct(counts.total)}% listelenen` : 'Henüz vaka yok'}
          icon={<ClipboardList className="h-5 w-5" />}
          tone="slate"
          active={!status}
          onClick={() => setStatus('')}
        />
        <StatCard
          label="Uzman İncelemesinde"
          value={counts.review}
          hint={counts.total ? `%${counts.pct(counts.review)} aktif` : '—'}
          icon={<Users className="h-5 w-5" />}
          tone="amber"
          active={status === 'uzman_incelemesinde'}
          onClick={() => setStatus(status === 'uzman_incelemesinde' ? '' : 'uzman_incelemesinde')}
        />
        <StatCard
          label="Onaylandı"
          value={counts.approved}
          hint={counts.total ? `%${counts.pct(counts.approved)} tamamlandı` : '—'}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="emerald"
          active={status === 'onaylandi'}
          onClick={() => setStatus(status === 'onaylandi' ? '' : 'onaylandi')}
        />
        <StatCard
          label="Sorunlu Analizler"
          value={counts.failed}
          hint={counts.total ? `%${counts.pct(counts.failed)} dikkat` : '—'}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="rose"
          active={status === 'analiz_basarisiz'}
          onClick={() => setStatus(status === 'analiz_basarisiz' ? '' : 'analiz_basarisiz')}
        />
      </div>

      <Card>
        <div className="border-b border-slate-100 px-4 pb-1 pt-4 sm:px-5">
          <h2 className="text-sm font-semibold text-navy-900">Vaka Listesi</h2>
          <p className="text-xs text-slate-500">
            {filtered.length} / {cases.length} vaka gösteriliyor
          </p>
        </div>

        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-end sm:px-5">
          <label className="relative block flex-1">
            <span className="sr-only">Vaka ara</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              className="input pl-9"
              placeholder="Hasta adı, vaka no, ırk veya study UID ile ara…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <label className="block lg:w-44">
            <span className="label">Durum</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as CaseStatus | '')}>
              <option value="">Tüm durumlar</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </label>
          <label className="block lg:w-32">
            <span className="label">Tür</span>
            <select className="input" value={species} onChange={(e) => setSpecies(e.target.value)}>
              <option value="">Tüm türler</option>
              <option>Köpek</option>
              <option>Kedi</option>
            </select>
          </label>
          <label className="block lg:w-28">
            <span className="label">Modalite</span>
            <select
              className="input"
              value={modality}
              onChange={(e) => setModality(e.target.value as BackendModality | '')}
            >
              <option value="">Tümü</option>
              <option value="MR">MR</option>
              <option value="CT">CT</option>
              <option value="XR">XR</option>
            </select>
          </label>
          <label className="block lg:w-40">
            <span className="label">Uzman</span>
            <select className="input" value={expert} onChange={(e) => setExpert(e.target.value)}>
              <option value="">Tüm uzmanlar</option>
              {experts.map((e) => (
                <option key={e} value={e}>
                  {e.includes('@') ? e.split('@')[0] : e}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => setStatus('')}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
              !status ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            Tümü <span className="ml-1 opacity-70">{counts.total}</span>
          </button>
          {STATUS_ORDER.map((s) => {
            const n = counts.byStatus[s] ?? 0
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
            text="DICOM yükleyerek veya Yeni Vaka ile başlayın."
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
              <Button size="sm" variant="secondary" className="mt-3" onClick={clearFilters}>
                Filtreleri temizle
              </Button>
            }
          />
        )}
      </Card>
    </>
  )
}
