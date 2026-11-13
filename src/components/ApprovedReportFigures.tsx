import { useEffect, useMemo, useState } from 'react'
import { ImageIcon, ImagePlus, Loader2 } from 'lucide-react'
import {
  appendReportFigures,
  fetchApprovedEvidenceOverlayObjectUrl,
  fetchEvidenceOverlayObjectUrl,
  getCaseFindings,
} from '../lib/backend'
import { Button } from './Button'
import { Modal } from './Modal'
import type { BackendEvidenceReference, BackendFinding, BackendReportEvidenceFigure } from '../types'

function FigureCard({
  caseId,
  version,
  fig,
}: {
  caseId: string
  version: number
  fig: BackendReportEvidenceFigure
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setLoading(true)
    setErr(false)
    setSrc(null)
    void (async () => {
      try {
        objectUrl = await fetchApprovedEvidenceOverlayObjectUrl(caseId, version, fig.evidence_id)
        if (!cancelled) setSrc(objectUrl)
      } catch {
        if (!cancelled) setErr(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [caseId, version, fig.evidence_id])

  return (
    <figure className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex aspect-[4/3] items-center justify-center bg-slate-950/95">
        {loading ? (
          <Loader2 className="h-6 w-6 animate-spin text-teal-300" />
        ) : err || !src ? (
          <div className="flex flex-col items-center gap-1 px-3 text-center text-xs text-slate-400">
            <ImageIcon className="h-5 w-5" />
            Görsel yüklenemedi
          </div>
        ) : (
          <img src={src} alt={fig.caption || fig.evidence_id} className="max-h-full max-w-full object-contain" />
        )}
      </div>
      <figcaption className="space-y-1 px-3 py-2 text-[11px] leading-snug text-slate-600">
        <p className="font-medium text-navy-900">{fig.caption || fig.finding_id}</p>
        {fig.disclaimer ? <p className="text-slate-400">{fig.disclaimer}</p> : null}
      </figcaption>
    </figure>
  )
}

type Candidate = {
  finding: BackendFinding
  evidence: BackendEvidenceReference
}

function CandidateThumb({ caseId, evidenceId }: { caseId: string; evidenceId: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        objectUrl = await fetchEvidenceOverlayObjectUrl(caseId, evidenceId)
        if (!cancelled) setSrc(objectUrl)
      } catch {
        if (!cancelled) setSrc(null)
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [caseId, evidenceId])
  return (
    <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-900">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <ImageIcon className="h-4 w-4 text-slate-500" />
      )}
    </div>
  )
}

/** Frozen approve-time evidence figures on the approved report page / print. */
export function ApprovedReportFigures({
  caseId,
  version,
  figures,
  canAdd = false,
  onFiguresAdded,
}: {
  caseId: string
  version: number
  figures?: BackendReportEvidenceFigure[] | null
  /** Expert/admin: allow appending workspace evidence after approve. */
  canAdd?: boolean
  onFiguresAdded?: () => void | Promise<void>
}) {
  const list = figures ?? []
  const already = useMemo(() => new Set(list.map((f) => f.evidence_id)), [list])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!pickerOpen) return
    let cancelled = false
    setLoadingCandidates(true)
    setError(null)
    setSelected(new Set())
    void (async () => {
      try {
        const findings = await getCaseFindings(caseId)
        if (cancelled) return
        const next: Candidate[] = []
        for (const finding of findings?.findings ?? []) {
          for (const ev of finding.evidence_references ?? []) {
            if (already.has(ev.evidence_id)) continue
            if (ev.review_status === 'rejected') continue
            const renderable =
              Boolean(ev.overlay_ref) || Boolean(ev.bbox && ev.sop_instance_uid)
            if (!renderable) continue
            next.push({ finding, evidence: ev })
          }
        }
        setCandidates(next)
      } catch (err) {
        if (!cancelled) {
          setCandidates([])
          setError(err instanceof Error ? err.message : 'Kanıtlar yüklenemedi')
        }
      } finally {
        if (!cancelled) setLoadingCandidates(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pickerOpen, caseId, already])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onSave = () => {
    if (!selected.size || saving) return
    setSaving(true)
    setError(null)
    void appendReportFigures(caseId, [...selected])
      .then(async () => {
        setPickerOpen(false)
        await onFiguresAdded?.()
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Fotoğraflar eklenemedi')
      })
      .finally(() => setSaving(false))
  }

  return (
    <section className="border-t border-slate-100 px-8 py-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-teal-700">Rapor görselleri</h3>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] text-slate-400">
            {list.length ? `${list.length} onaylı kanıt görseli` : 'Kanıt görseli yok'}
          </p>
          {canAdd ? (
            <Button
              variant="secondary"
              size="sm"
              className="no-print"
              icon={<ImagePlus className="h-3.5 w-3.5" />}
              onClick={() => setPickerOpen(true)}
            >
              Foto ekle
            </Button>
          ) : null}
        </div>
      </div>
      {!list.length ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
          Onay öncesi workspace’te kanıtları <strong>Kabul et</strong> + <strong>PDF’e ekle</strong> işaretlemezseniz
          burada (ve indirilen PDF’te) fotoğraf görünmez.
          {canAdd ? (
            <>
              {' '}
              Yanındaki <strong>Foto ekle</strong> ile bu sayfadan da ekleyebilirsiniz.
            </>
          ) : null}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((fig) => (
            <FigureCard key={fig.evidence_id} caseId={caseId} version={version} fig={fig} />
          ))}
        </div>
      )}

      <Modal
        open={pickerOpen}
        onClose={() => {
          if (!saving) setPickerOpen(false)
        }}
        title="Rapora fotoğraf ekle"
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={saving} onClick={() => setPickerOpen(false)}>
              İptal
            </Button>
            <Button size="sm" disabled={saving || selected.size === 0} onClick={onSave}>
              {saving ? 'Ekleniyor…' : `Seçilenleri ekle (${selected.size})`}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Workspace kanıtlarından seçin. Rapor metni değişmez; yalnızca görseller onaylı pakete eklenir.
          </p>
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}
          {loadingCandidates ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Kanıtlar yükleniyor…
            </div>
          ) : !candidates.length ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
              Eklenebilecek yeni kanıt görseli yok. Overlay’i olan AI / manuel işaretler burada listelenir.
            </p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {candidates.map(({ finding, evidence }) => {
                const id = evidence.evidence_id
                const checked = selected.has(id)
                return (
                  <li key={id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-2 py-2 hover:border-teal-300">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-teal-600"
                        checked={checked}
                        onChange={() => toggle(id)}
                      />
                      <CandidateThumb caseId={caseId} evidenceId={id} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-navy-900">
                          {finding.finding_code || finding.finding_id}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          {evidence.description || finding.description || id}
                        </p>
                      </div>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Modal>
    </section>
  )
}
