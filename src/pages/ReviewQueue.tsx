import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Clock, Info, LayoutPanelLeft, Loader2, RefreshCw, Search, Trash2, UserPlus } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Button } from '../components/Button'
import { Card, CardHeader } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { PriorityBadge, StatusBadge } from '../components/StatusBadge'
import { currentActorId } from '../lib/auth'
import { deleteBackendCase, listBackendWorklist, updateCaseAssignment } from '../lib/backend'
import { summaryToVetCase } from '../lib/caseMapper'
import {
  compareBySlaUrgency,
  formatSlaRemaining,
  isSlaAttention,
  slaBadgeClass,
  slaHoursForPriority,
  slaRowClass,
  slaTone,
} from '../lib/reviewSla'
import type { BackendCaseSummary, VetCase } from '../types'

export default function ReviewQueue() {
  const { cases, pushToast, hydrateBackendCase, removeCase } = useApp()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<BackendCaseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [modality, setModality] = useState('')
  const [priority, setPriority] = useState('')
  const [status, setStatus] = useState('awaiting_review')
  const [assigned, setAssigned] = useState('')
  const [pendingDelete, setPendingDelete] = useState<VetCase | null>(null)
  const [deleting, setDeleting] = useState(false)
  const slaOnly = params.get('sla') === 'az'

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

  const baseDisplay = rows.length
    ? rows.map(summaryToVetCase)
    : error
      ? localFallback
      : rows.map(summaryToVetCase)

  const display = useMemo(() => {
    const list = slaOnly
      ? baseDisplay.filter((c) => isSlaAttention(c.reviewDueAt))
      : baseDisplay
    if (!slaOnly) return list
    return [...list].sort((a, b) => compareBySlaUrgency(a.reviewDueAt, b.reviewDueAt))
  }, [baseDisplay, slaOnly])

  const setSlaFilter = (on: boolean) => {
    const next = new URLSearchParams(params)
    if (on) next.set('sla', 'az')
    else next.delete('sla')
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Radyolog İş Listesi"
        subtitle="Acil/STAT → 24 saat · diğerleri → 48 saat · süresi az kalanlara tek tıkla filtre"
        crumbs={[{ label: 'Kontrol Paneli', to: '/' }, { label: 'İş Listesi' }]}
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={load} disabled={loading}>
            Yenile
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSlaFilter(false)}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
            !slaOnly ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Tüm kuyruk
        </button>
        <button
          type="button"
          onClick={() => setSlaFilter(true)}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
            slaOnly
              ? 'bg-rose-600 text-white shadow-sm'
              : 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200 hover:bg-rose-100'
          }`}
        >
          <Clock className="h-4 w-4" aria-hidden />
          Süresi az kalanlar
          <span
            className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
              slaOnly ? 'bg-white/20 text-white' : 'bg-rose-600 text-white'
            }`}
          >
            {baseDisplay.filter((c) => isSlaAttention(c.reviewDueAt)).length}
          </span>
        </button>
      </div>

      {slaOnly && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <strong>Süresi az kalanlar</strong> gösteriliyor (gecikme veya ≤12 saat). En acil üstte.
            {' '}
            <button type="button" className="font-semibold underline" onClick={() => setSlaFilter(false)}>
              Filtreyi kaldır
            </button>
          </p>
        </div>
      )}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="label" htmlFor="wl-q">
            Ara
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                id="wl-q"
                className="input pl-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && load()}
                placeholder="hasta / vaka / klinik"
              />
            </div>
          </label>
          <label className="label" htmlFor="wl-status">
            Durum
            <select id="wl-status" className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tümü</option>
              <option value="awaiting_review">Uzman inceleme</option>
              <option value="revision_requested">Revizyon</option>
              <option value="manual_review">Manuel inceleme</option>
              <option value="analyzing">Analiz</option>
            </select>
          </label>
          <label className="label" htmlFor="wl-modality">
            Modalite
            <select id="wl-modality" className="input mt-1" value={modality} onChange={(e) => setModality(e.target.value)}>
              <option value="">Tümü</option>
              <option value="MR">MR</option>
              <option value="CT">CT</option>
              <option value="XR">XR</option>
            </select>
          </label>
          <label className="label" htmlFor="wl-priority">
            Öncelik
            <select id="wl-priority" className="input mt-1" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">Tümü</option>
              <option value="stat">STAT</option>
              <option value="urgent">Acil (URGENT)</option>
              <option value="high">Yüksek</option>
              <option value="normal">Normal</option>
            </select>
          </label>
          <label className="label" htmlFor="wl-assigned">
            Atama
            <select id="wl-assigned" className="input mt-1" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
              <option value="">Tümü</option>
              <option value="unassigned">Atanmamış</option>
              <option value={currentActorId()}>Bana atananlar</option>
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
          subtitle={
            error
              ? `API: ${error} · yerel kuyruk gösteriliyor`
              : slaOnly
                ? 'Süresi az kalanlar · en acil üstte'
                : 'Acil vakalar üstte · süre ≤12 sa “az kalan” filtresinde'
          }
        />
        {loading ? (
          <p className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> İş listesi yükleniyor…
          </p>
        ) : display.length === 0 ? (
          <EmptyState
            compact
            icon={<LayoutPanelLeft className="h-5 w-5" />}
            title={slaOnly ? 'Süresi az kalan vaka yok' : 'Eşleşen vaka yok'}
            text={
              slaOnly
                ? 'Şu an gecikmiş veya 12 saatin altında kalan vaka yok.'
                : error
                  ? `API: ${error}. Filtreleri temizleyip yenileyin.`
                  : 'Filtreleri genişletin veya yeni vaka bekleyin.'
            }
            action={
              slaOnly ? (
                <Button size="sm" variant="secondary" onClick={() => setSlaFilter(false)}>
                  Tüm kuyruğu göster
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={load}>
                  Yenile
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="th">Vaka</th>
                  <th className="th">Hasta</th>
                  <th className="th">Modalite</th>
                  <th className="th">Öncelik</th>
                  <th className="th">Yanıt süresi</th>
                  <th className="th">Durum</th>
                  <th className="th">Atama</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {display.map((c) => {
                  const tone = slaTone(c.reviewDueAt)
                  const attention = isSlaAttention(c.reviewDueAt)
                  const displayTone = attention && (tone === 'ok' || tone === 'none') ? 'warn' : tone
                  const hours = slaHoursForPriority(c.priority)
                  return (
                  <tr key={c.id} className={slaRowClass(displayTone) || (attention ? 'bg-rose-50/60' : '')}>
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
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${slaBadgeClass(displayTone)}`}
                        title={`${hours} saat SLA`}
                      >
                        <Clock className="h-3 w-3" aria-hidden />
                        {c.reviewDueAt ? formatSlaRemaining(c.reviewDueAt) : `${hours}s SLA`}
                      </span>
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
                              assigned_reviewer_id: currentActorId(),
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
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:text-rose-900"
                          onClick={() => setPendingDelete(c)}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Sil
                        </button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <Info className="h-3.5 w-3.5" /> Hiçbir AI taslağı uzman onayı olmadan iletilmez. Onaylı raporlar değiştirilemez.
      </p>

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => {
          if (!deleting) setPendingDelete(null)
        }}
        title="Vakayı silmek istediğinize emin misiniz?"
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={deleting} onClick={() => setPendingDelete(null)}>
              Vazgeç
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={deleting}
              icon={deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              onClick={() => {
                if (!pendingDelete || deleting) return
                const target = pendingDelete
                setDeleting(true)
                void deleteBackendCase(target.backendCaseId || target.id)
                  .then(() => {
                    removeCase(target.id)
                    setPendingDelete(null)
                    pushToast({ tone: 'success', title: 'Vaka silindi', body: `${target.patient.name} · ${target.no}` })
                    load()
                  })
                  .catch((err) =>
                    pushToast({
                      tone: 'error',
                      title: 'Silinemedi',
                      body: err instanceof Error ? err.message : undefined,
                    }),
                  )
                  .finally(() => setDeleting(false))
              }}
            >
              {deleting ? 'Siliniyor…' : 'Evet, sil'}
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              <strong className="text-navy-900">{pendingDelete.patient.name}</strong> vakasını kalıcı olarak silmek
              istediğinize emin misiniz?
            </p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
              {pendingDelete.no} · {pendingDelete.id}
            </p>
            <p className="text-xs text-rose-700">Bu işlem geri alınamaz.</p>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
