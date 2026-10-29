import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  MoreHorizontal,
  XCircle,
} from 'lucide-react'
import type { VetCase } from '../types'
import { PriorityBadge, StatusBadge } from './StatusBadge'
import { analysisStatusLabel, expertReviewLabel } from '../lib/caseMapper'
import { fmtDate } from '../lib/format'

const SPECIES_EMOJI: Record<string, string> = { Kedi: '🐱', Köpek: '🐶' }

const MODALITY_CLS: Record<string, string> = {
  MR: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  CT: 'bg-violet-50 text-violet-700 ring-violet-200',
  XR: 'bg-sky-50 text-sky-700 ring-sky-200',
  OTHER: 'bg-slate-100 text-slate-700 ring-slate-200',
}

export function SpeciesIcon({ species }: { species: string }) {
  return (
    <span className="text-base leading-none" role="img" aria-label={species}>
      {SPECIES_EMOJI[species] ?? '🐾'}
    </span>
  )
}

function studyCell(c: VetCase): string {
  if (c.instanceCount != null || c.seriesCount != null) {
    const parts = [
      c.seriesCount != null ? `${c.seriesCount} seri` : null,
      c.instanceCount != null ? `${c.instanceCount} görüntü` : null,
    ].filter(Boolean)
    return parts.join(' · ') || '—'
  }
  if (c.studyInstanceUid) return `UID …${c.studyInstanceUid.slice(-8)}`
  if (c.documents.some((d) => d.name.toUpperCase().includes('DICOM'))) return 'DICOM'
  return '—'
}

function modalityLabel(c: VetCase): string {
  if (!c.modality) return '—'
  return c.anatomicalRegion ? `${c.modality}-${c.anatomicalRegion}` : c.modality
}

function AnalysisCell({ c }: { c: VetCase }) {
  const label = analysisStatusLabel(c.status)
  if (c.status === 'analiz_basarisiz') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700">
        <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Analiz Başarısız
      </span>
    )
  }
  if (
    c.status === 'uzman_incelemesinde' ||
    c.status === 'onaylandi' ||
    c.status === 'reddedildi' ||
    c.status === 'revizyon'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        AI Analizi Tamamlandı
      </span>
    )
  }
  return <span className="text-xs text-slate-600">{label}</span>
}

function expertDisplay(c: VetCase): string {
  if (c.assignedReviewerId) {
    const id = c.assignedReviewerId
    if (id.includes('@')) return id.split('@')[0]
    return id
  }
  const review = expertReviewLabel(c.status)
  return review === '—' ? 'Atanmadı' : review
}

export function CaseTable({
  cases,
  showPriority = false,
  selectable = true,
}: {
  cases: VetCase[]
  showPriority?: boolean
  selectable?: boolean
}) {
  const nav = useNavigate()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const allIds = useMemo(() => cases.map((c) => c.id), [cases])
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))

  const toggleAll = () => {
    setSelected((prev) => {
      if (allIds.every((id) => prev.has(id))) return new Set()
      return new Set(allIds)
    })
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50/80">
          <tr>
            {selectable && (
              <th className="th w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Tümünü seç"
                />
              </th>
            )}
            <th className="th">Vaka No</th>
            <th className="th">Hasta</th>
            <th className="th">Tür / Irk</th>
            <th className="th">Modalite</th>
            <th className="th">Study</th>
            <th className="th">Analiz</th>
            <th className="th">Uzman</th>
            {showPriority && <th className="th">Öncelik</th>}
            <th className="th">Durum</th>
            <th className="th">Tarih</th>
            <th className="th text-right">İşlemler</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {cases.map((c) => (
            <tr
              key={c.id}
              onClick={() => nav(`/vakalar/${c.id}`)}
              className="cursor-pointer transition hover:bg-teal-50/40"
            >
              {selectable && (
                <td className="td" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    checked={selected.has(c.id)}
                    onChange={() => toggleOne(c.id)}
                    aria-label={`${c.no} seç`}
                  />
                </td>
              )}
              <td className="td font-mono text-[11px] font-semibold text-slate-500" title={c.id}>
                {c.no}
              </td>
              <td className="td">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-50 to-sky-50 text-lg ring-1 ring-slate-200/80">
                    <SpeciesIcon species={c.patient.species} />
                  </span>
                  <span className="font-semibold text-navy-900">{c.patient.name}</span>
                </div>
              </td>
              <td className="td">
                <div className="text-sm text-navy-800">{c.patient.species}</div>
                <div className="text-xs text-slate-500">{c.patient.breed}</div>
              </td>
              <td className="td">
                <span
                  className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                    MODALITY_CLS[c.modality ?? 'OTHER'] ?? MODALITY_CLS.OTHER
                  }`}
                >
                  {modalityLabel(c)}
                </span>
              </td>
              <td className="td" title={c.studyInstanceUid}>
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                  <FolderOpen className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  {studyCell(c)}
                </span>
              </td>
              <td className="td">
                <AnalysisCell c={c} />
              </td>
              <td className="td text-xs text-slate-700">{expertDisplay(c)}</td>
              {showPriority && (
                <td className="td">
                  <PriorityBadge priority={c.priority} />
                </td>
              )}
              <td className="td">
                <StatusBadge status={c.status} />
              </td>
              <td className="td text-xs text-slate-500">{fmtDate(c.createdAt)}</td>
              <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                    onClick={() => nav(`/vakalar/${c.id}`)}
                  >
                    Aç <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700"
                    aria-label="Diğer işlemler"
                    onClick={() => nav(`/vakalar/${c.id}`)}
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
