import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { VetCase } from '../types'
import { PriorityBadge, StatusBadge } from './StatusBadge'
import { fmtDate } from '../lib/format'

export function SpeciesIcon({ species }: { species: string }) {
  return <span className="text-base leading-none">{species === 'Kedi' ? '🐈' : '🐕'}</span>
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
            <th className="th">Tür</th>
            <th className="th">Irk</th>
            <th className="th">Modül</th>
            {showPriority && <th className="th">Öncelik</th>}
            <th className="th">Durum</th>
            <th className="th">Tarih</th>
            <th className="th" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {cases.map((c) => (
            <tr key={c.id} onClick={() => nav(`/vakalar/${c.id}`)} className="cursor-pointer transition hover:bg-teal-50/40">
              <td className="td font-mono text-xs text-slate-600">{c.no}</td>
              <td className="td">
                <div className="flex items-center gap-2 font-medium text-navy-900">
                  <SpeciesIcon species={c.patient.species} /> {c.patient.name}
                </div>
                <div className="text-xs text-slate-500">{c.patient.ownerName}</div>
              </td>
              <td className="td">{c.patient.species}</td>
              <td className="td">{c.patient.breed}</td>
              <td className="td">
                <span className="rounded-md bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-700">{c.module}</span>
              </td>
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
                <ChevronRight className="ml-auto h-4 w-4 text-slate-400" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
