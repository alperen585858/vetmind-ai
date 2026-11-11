import { useEffect, useMemo, useState } from 'react'
import { ImageIcon, Loader2 } from 'lucide-react'
import { fetchEvidenceOverlayObjectUrl } from '../lib/backend'
import type { DicomFramePreview } from '../lib/dicomPreview'
import { findingOverlayLabel } from '../lib/overlayEligibility'
import type { BackendEvidenceReference, BackendFindings } from '../types'

export type ReportFigureItem = {
  findingId: string
  findingIndex: number
  label: string
  evidence: BackendEvidenceReference
  /** Matches PDF freeze rule: include + accepted/edited + overlay. */
  inPdf: boolean
}

export function collectReportFigures(findings: BackendFindings | null | undefined): ReportFigureItem[] {
  const list = findings?.findings || []
  const out: ReportFigureItem[] = []
  list.forEach((f, findingIndex) => {
    for (const ev of f.evidence_references || []) {
      const hasVisual = Boolean(ev.overlay_ref) || Boolean(ev.bbox && ev.sop_instance_uid)
      if (!hasVisual) continue
      const status = ev.review_status || 'pending'
      const inPdf = Boolean(
        ev.include_in_report && (status === 'accepted' || status === 'edited') && ev.overlay_ref,
      )
      out.push({
        findingId: f.finding_id,
        findingIndex,
        label: findingOverlayLabel(findingIndex, f.finding_id),
        evidence: ev,
        inPdf,
      })
    }
  })
  // Prefer PDF-bound first, then the rest (still shown so expert sees what they approve).
  return out.sort((a, b) => Number(b.inPdf) - Number(a.inPdf) || a.findingIndex - b.findingIndex)
}

function compositeThumbWithBbox(
  thumbUrl: string,
  bbox: NonNullable<BackendEvidenceReference['bbox']>,
  cols: number,
  rows: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas'))
        return
      }
      ctx.drawImage(img, 0, 0)
      const sx = img.naturalWidth / Math.max(1, cols)
      const sy = img.naturalHeight / Math.max(1, rows)
      const x = bbox.x_min * sx
      const y = bbox.y_min * sy
      const w = (bbox.x_max - bbox.x_min) * sx
      const h = (bbox.y_max - bbox.y_min) * sy
      ctx.strokeStyle = '#14b8a6'
      ctx.lineWidth = Math.max(2, Math.round(img.naturalWidth / 180))
      ctx.strokeRect(x, y, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('thumb load'))
    img.src = thumbUrl
  })
}

function FigureCard({
  item,
  caseId,
  frames,
}: {
  item: ReportFigureItem
  caseId: string
  frames: DicomFramePreview[]
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)
  const ev = item.evidence

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setLoading(true)
    setErr(false)
    setSrc(null)

    const run = async () => {
      try {
        if (ev.overlay_ref) {
          objectUrl = await fetchEvidenceOverlayObjectUrl(caseId, ev.evidence_id)
          if (!cancelled) setSrc(objectUrl)
          return
        }
        const frame = frames.find((f) => f.ok && f.sopInstanceUid && f.sopInstanceUid === ev.sop_instance_uid)
        if (frame?.thumbUrl && ev.bbox && frame.cols && frame.rows) {
          const data = await compositeThumbWithBbox(frame.thumbUrl, ev.bbox, frame.cols, frame.rows)
          if (!cancelled) setSrc(data)
          return
        }
        if (frame?.thumbUrl) {
          if (!cancelled) setSrc(frame.thumbUrl)
          return
        }
        if (!cancelled) setErr(true)
      } catch {
        // Fallback to DICOM thumb + bbox when overlay endpoint fails.
        try {
          const frame = frames.find((f) => f.ok && f.sopInstanceUid && f.sopInstanceUid === ev.sop_instance_uid)
          if (frame?.thumbUrl && ev.bbox && frame.cols && frame.rows) {
            const data = await compositeThumbWithBbox(frame.thumbUrl, ev.bbox, frame.cols, frame.rows)
            if (!cancelled) setSrc(data)
            return
          }
          if (frame?.thumbUrl && !cancelled) {
            setSrc(frame.thumbUrl)
            return
          }
        } catch {
          /* ignore */
        }
        if (!cancelled) setErr(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [caseId, ev.evidence_id, ev.overlay_ref, ev.sop_instance_uid, ev.bbox, frames])

  return (
    <figure className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <div className="relative aspect-[4/3] bg-navy-950">
        {loading ? (
          <div className="flex h-full items-center justify-center text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          </div>
        ) : src ? (
          <img src={src} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center text-[11px] text-slate-400">
            <ImageIcon className="h-5 w-5" aria-hidden />
            {err ? 'Görsel yüklenemedi' : 'Görsel yok'}
          </div>
        )}
        <span
          className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${
            item.inPdf ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'
          }`}
        >
          {item.label}
          {item.inPdf ? ' · PDF' : ''}
        </span>
      </div>
      <figcaption className="space-y-0.5 px-2.5 py-2 text-[11px] leading-snug text-slate-600">
        <p className="font-medium text-navy-900">{ev.description || item.findingId}</p>
        <p className="text-slate-400">
          {item.inPdf
            ? 'Onayda PDF’e gömülür'
            : ev.include_in_report
              ? 'PDF’e ekle açık — kabul edilince PDF’e girer'
              : 'PDF dışı · sol panelden “PDF’e ekle”'}
        </p>
      </figcaption>
    </figure>
  )
}

export function ReportEvidenceFigures({
  caseId,
  findings,
  frames = [],
}: {
  caseId?: string | null
  findings?: BackendFindings | null
  frames?: DicomFramePreview[]
}) {
  const items = useMemo(() => collectReportFigures(findings), [findings])
  const pdfCount = items.filter((i) => i.inPdf).length

  if (!caseId) return null

  return (
    <section className="border-t border-slate-100 px-8 py-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-teal-700">Rapor görselleri</h3>
        <p className="text-[11px] text-slate-400">
          {items.length
            ? `${pdfCount} PDF’e hazır · ${items.length} görsel`
            : 'Henüz görsel kanıt yok'}
        </p>
      </div>
      {!items.length ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
          Onaydan önce burada F1 / F2 gibi AI kanıt görselleri görünür. Sol panelden “Kabul et” + “PDF’e ekle”
          işaretleyin.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <FigureCard
              key={item.evidence.evidence_id}
              item={item}
              caseId={caseId}
              frames={frames}
            />
          ))}
        </div>
      )}
    </section>
  )
}
