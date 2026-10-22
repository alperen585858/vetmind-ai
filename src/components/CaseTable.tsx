import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { VetCase } from '../types'
import { PriorityBadge, StatusBadge } from './StatusBadge'
import { analysisStatusLabel, expertReviewLabel } from '../lib/caseMapper'
import { fmtDate } from '../lib/format'

export function SpeciesIcon({ species }: { species: string }) {
  return <span className="text-base leading-none">{species === 'Kedi' ? '🐈' : '🐕'}</span>
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

export function CaseTable({ cases, showPriority = false }: { cases: VetCase[]; showPriority?: boolean }) {
  const nav = useNavigate()
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100">
        <thead className="bg-slate-50/70">
          <tr>
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
            <th className="th" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {cases.map((c) => (
            <tr
              key={c.id}
              onClick={() => nav(`/vakalar/${c.id}`)}
              className="cursor-pointer transition hover:bg-teal-50/40"
            >
              <td className="td font-mono text-xs text-slate-600">{c.no}</td>
              <td className="td">
                <div className="flex items-center gap-2 font-medium text-navy-900">
                  <SpeciesIcon species={c.patient.species} /> {c.patient.name}
                </div>
                {c.fromBackend && (
                  <div className="text-[10px] font-medium uppercase tracking-wide text-teal-700">Backend</div>
                )}
              </td>
              <td className="td">
                <div>{c.patient.species}</div>
                <div className="text-xs text-slate-500">{c.patient.breed}</div>
              </td>
              <td className="td">
                <span className="rounded-md bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-700">
                  {c.modality ?? '—'}
                  {c.anatomicalRegion ? ` · ${c.anatomicalRegion}` : ''}
                </span>
              </td>
              <td className="td text-xs text-slate-600" title={c.studyInstanceUid}>
                {studyCell(c)}
              </td>
              <td className="td text-xs text-slate-700">{analysisStatusLabel(c.status)}</td>
              <td className="td text-xs text-slate-700">{expertReviewLabel(c.status)}</td>
              {showPriority && (
                <td className="td">
                  <PriorityBadge priority={c.priority} />
                </td>
              )}
              <td className="td">
                <StatusBadge status={c.status} />
              </td>
              <td className="td text-slate-500">{fmtDate(c.createdAt)}</td>
              <td className="td text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                  onClick={(e) => {
                    e.stopPropagation()
                    nav(`/vakalar/${c.id}`)
                  }}
                >
                  Aç <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
