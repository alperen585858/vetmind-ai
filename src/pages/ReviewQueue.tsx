import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, LayoutPanelLeft, Loader2, RefreshCw, Search, UserPlus } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Button } from '../components/Button'
import { Card, CardHeader } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import { listBackendWorklist, updateCaseAssignment } from '../lib/backend'
import { summaryToVetCase } from '../lib/caseMapper'
import type { BackendCaseSummary } from '../types'

export default function ReviewQueue() {
  const { cases, pushToast, hydrateBackendCase } = useApp()
  const [rows, setRows] = useState<BackendCaseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [modality, setModality] = useState('')
  const [priority, setPriority] = useState('')
  const [status, setStatus] = useState('awaiting_review')
  const [assigned, setAssigned] = useState('')

  const load = () => {
    setLoading(true)
    setError(null)
    void listBackendWorklist({
      status: status || undefined,
      modality: modality || undefined,
      priority: priority || undefined,
      assigned_to: assigned || undefined,
      q: q || undefined,
    })
      .then(setRows)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'İş listesi alınamadı')
        // Fallback: local awaiting queue
        setRows([])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, modality, priority, assigned])

  const localFallback = useMemo(
    () => cases.filter((c) => c.status === 'uzman_incelemesinde').map((c) => c),
    [cases],
  )

  const display = rows.length
    ? rows.map(summaryToVetCase)
    : error
      ? localFallback
      : rows.map(summaryToVetCase)

  return (
    <>
      <PageHeader
        title="Radyolog İş Listesi"
        subtitle="Öncelik · modalite · durum · atama ile filtrelenebilir kuyruk"
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={load} disabled={loading}>
            Yenile
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs text-slate-600">
            Ara
            <div className="mt-1 flex items-center gap-1 rounded-md border border-slate-200 px-2">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input
                className="w-full py-1.5 text-sm outline-none"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load()}
                placeholder="hasta / vaka / klinik"
              />
            </div>
          </label>
          <label className="text-xs text-slate-600">
            Durum
            <select className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tümü</option>
              <option value="awaiting_review">Uzman inceleme</option>
              <option value="revision_requested">Revizyon</option>
              <option value="manual_review">Manuel inceleme</option>
              <option value="analyzing">Analiz</option>
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Modalite
            <select className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" value={modality} onChange={(e) => setModality(e.target.value)}>
              <option value="">Tümü</option>
              <option value="MR">MR</option>
              <option value="CT">CT</option>
              <option value="XR">XR</option>
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Öncelik
            <select className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">Tümü</option>
              <option value="stat">STAT</option>
              <option value="urgent">Acil (URGENT)</option>
              <option value="high">Yüksek</option>
              <option value="normal">Normal</option>
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Atama
            <select className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
              <option value="">Tümü</option>
              <option value="unassigned">Atanmamış</option>
              <option value="expert-demo">expert-demo</option>
            </select>
          </label>
        </div>
        <div className="mt-3">
          <Button size="sm" onClick={load}>
            Filtrele
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={`${display.length} vaka`}
          subtitle={error ? `API: ${error} · yerel kuyruk gösteriliyor` : 'Acil vakalar üstte'}
        />
        {loading ? (
          <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </p>
        ) : display.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-500">Eşleşen vaka yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="th">Vaka</th>
                  <th className="th">Hasta</th>
                  <th className="th">Modalite</th>
                  <th className="th">Öncelik</th>
                  <th className="th">Durum</th>
                  <th className="th">Atama</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {display.map((c) => (
                  <tr key={c.id}>
                    <td className="td font-mono text-xs">{c.no}</td>
                    <td className="td">
                      <p className="font-medium text-navy-900">{c.patient.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {c.patient.species} · {c.patient.breed}
                        {c.patient.age ? ` · ${c.patient.age}y` : ''}
                      </p>
                    </td>
                    <td className="td text-xs">{c.modality || '—'}</td>
                    <td className="td">
                      <PriorityBadge priority={c.priority} />
                    </td>
                    <td className="td">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="td text-xs text-slate-600">{c.assignedReviewerId || '—'}</td>
                    <td className="td">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          to={`/vakalar/${c.id}/calisma`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700"
                        >
                          <LayoutPanelLeft className="h-3.5 w-3.5" /> Çalışma alanı
                        </Link>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-navy-900"
                          onClick={() => {
                            void updateCaseAssignment(c.backendCaseId || c.id, {
                              assigned_reviewer_id: 'expert-demo',
                              priority:
                                c.priority === 'STAT'
                                  ? 'stat'
                                  : c.priority === 'Acil'
                                    ? 'urgent'
                                    : c.priority === 'Yüksek'
                                      ? 'high'
                                      : 'normal',
                            })
                              .then(() => {
                                pushToast({ tone: 'success', title: 'Vaka size atandı' })
                                void hydrateBackendCase(c.backendCaseId || c.id)
                                load()
                              })
                              .catch((err) =>
                                pushToast({
                                  tone: 'error',
                                  title: 'Atama başarısız',
                                  body: err instanceof Error ? err.message : undefined,
                                }),
                              )
                          }}
                        >
                          <UserPlus className="h-3.5 w-3.5" /> Üstlen
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <Info className="h-3.5 w-3.5" /> Hiçbir AI taslağı uzman onayı olmadan iletilmez. Onaylı raporlar değiştirilemez.
      </p>
    </>
  )
}
