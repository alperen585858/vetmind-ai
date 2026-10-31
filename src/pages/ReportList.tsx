import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, FileCheck2, FileText, Loader2, Send, Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card } from '../components/Card'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { Modal } from '../components/Modal'
import { SpeciesIcon } from '../components/CaseTable'
import { deleteBackendCase, submitBackendReview } from '../lib/backend'
import { caseBelongsToOwner } from '../lib/caseMapper'
import { fmtDate } from '../lib/format'
import type { VetCase } from '../types'

export default function ReportList() {
  const { cases, role, session, user, refreshBackendCases, removeCase, hydrateBackendCase, pushToast } = useApp()
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<VetCase | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingRevise, setPendingRevise] = useState<VetCase | null>(null)
  const [reviseNote, setReviseNote] = useState('')
  const [revising, setRevising] = useState(false)

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
    (c) =>
      c.status === 'onaylandi' &&
      (role !== 'owner' ||
        caseBelongsToOwner(c, { email: session?.email ?? user?.email, name: user?.name })),
  )

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return
    const target = pendingDelete
    setDeleting(true)
    try {
      await deleteBackendCase(target.id)
      removeCase(target.id)
      setPendingDelete(null)
      pushToast({
        tone: 'success',
        title: 'Rapor silindi',
        body: `${target.patient.name} · ${target.reportNo ?? target.no}`,
      })
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Silinemedi',
        body: err instanceof Error ? err.message : 'Sunucu hatası',
      })
    } finally {
      setDeleting(false)
    }
  }

  const confirmRevise = async () => {
    if (!pendingRevise || revising) return
    const note = reviseNote.trim()
    if (note.length < 10) {
      pushToast({ tone: 'warning', title: 'Gerekçe gerekli', body: 'En az 10 karakter yazın.' })
      return
    }
    const target = pendingRevise
    setRevising(true)
    try {
      await submitBackendReview(target.id, {
        action: 'request_revision',
        comment: note,
        reason_codes: ['report_quality'],
      })
      await hydrateBackendCase(target.id)
      setPendingRevise(null)
      setReviseNote('')
      pushToast({
        tone: 'success',
        title: 'Yeni sürüm açıldı',
        body: `${target.patient.name} — çalışma alanında düzenleyebilirsiniz.`,
      })
      nav(`/vakalar/${target.id}/calisma`)
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Revizyon açılamadı',
        body: err instanceof Error ? err.message : 'Sunucu hatası',
      })
    } finally {
      setRevising(false)
    }
  }

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
            {reports.map((c) => {
              const version = c.currentReportVersion ?? c.reportVersionCount ?? 1
              const revised = version > 1 || (c.reportVersionCount ?? 0) > 1
              return (
              <li key={c.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    revised ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-600'
                  }`}
                >
                  <FileCheck2 className="h-5 w-5" aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-navy-900">
                    <SpeciesIcon species={c.patient.species} /> {c.patient.name} — Nöroloji Değerlendirme Raporu
                    {revised ? (
                      <span className="inline-flex items-center rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 ring-1 ring-inset ring-violet-200">
                        Revize edilmiş · v{version}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
                        v{version}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {c.reportNo ?? c.no}
                    {c.approvedBy ? ` · Onaylayan: ${c.approvedBy}` : ''}
                    {c.approvedAt || c.reportAvailableAt ? ` · ${fmtDate(c.approvedAt ?? c.reportAvailableAt)}` : ''}
                    {c.reportViewedAt ? ' · görüldü' : c.reportDeliveredAt ? ' · iletildi' : ''}
                    {revised ? ' · önceki onaylı sürüm kilitli' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    icon={<FileText className="h-4 w-4" />}
                    onClick={() => nav(`/raporlar/${c.id}`)}
                  >
                    Raporu aç
                  </Button>
                  {role === 'expert' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Send className="h-4 w-4" />}
                      onClick={() => {
                        setReviseNote('')
                        setPendingRevise(c)
                      }}
                    >
                      Revize et
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-rose-700 hover:bg-rose-50"
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => setPendingDelete(c)}
                    aria-label={`${c.patient.name} raporunu sil`}
                  >
                    Sil
                  </Button>
                </div>
              </li>
              )
            })}
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

      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => {
          if (!deleting) setPendingDelete(null)
        }}
        title="Raporu sil?"
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
              onClick={() => void confirmDelete()}
            >
              {deleting ? 'Siliniyor…' : 'Evet, sil'}
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              <strong className="text-navy-900">{pendingDelete.patient.name}</strong> için onaylı raporu kalıcı olarak
              silmek istediğinize emin misiniz?
            </p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
              {pendingDelete.reportNo ?? pendingDelete.no} · {pendingDelete.id}
            </p>
            <p className="text-xs text-rose-700">Bu işlem geri alınamaz.</p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(pendingRevise)}
        onClose={() => {
          if (!revising) setPendingRevise(null)
        }}
        title="Onaylı raporu revize et?"
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={revising} onClick={() => setPendingRevise(null)}>
              Vazgeç
            </Button>
            <Button
              size="sm"
              disabled={revising || reviseNote.trim().length < 10}
              icon={revising ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              onClick={() => void confirmRevise()}
            >
              {revising ? 'Açılıyor…' : 'Yeni sürüm aç'}
            </Button>
          </>
        }
      >
        {pendingRevise ? (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              <strong className="text-navy-900">{pendingRevise.patient.name}</strong> için onaylı sürüm kilitli kalır; yeni
              düzenlenebilir sürüm açılır.
            </p>
            <label className="block">
              <span className="label">Revizyon gerekçesi (zorunlu)</span>
              <textarea
                data-autofocus
                className="input mt-1 min-h-[96px]"
                placeholder="Örn. İzlem netleştirilecek, ayırıcı tanılar güncellenecek…"
                value={reviseNote}
                onChange={(e) => setReviseNote(e.target.value)}
                disabled={revising}
              />
            </label>
            <p className={`text-xs ${reviseNote.trim().length < 10 ? 'font-medium text-amber-700' : 'text-slate-500'}`}>
              {reviseNote.trim().length < 10
                ? `En az 10 karakter gerekli (${reviseNote.trim().length}/10)`
                : `${reviseNote.trim().length} karakter · hazır`}
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
