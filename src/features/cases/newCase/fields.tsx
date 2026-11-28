import type { ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { NOT_EVALUATED } from '../../../shared/lib/neuroExam'

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

export function Pills<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          aria-pressed={value === o}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
            value === o
              ? o === NOT_EVALUATED
                ? 'bg-amber-50 text-amber-900 ring-amber-300'
                : 'bg-navy-900 text-white ring-navy-900'
              : 'bg-white text-navy-700 ring-slate-300 hover:bg-slate-50'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

export function Checks({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${
              on ? 'bg-teal-600 text-white ring-teal-600' : 'bg-white text-navy-700 ring-slate-300 hover:bg-slate-50'
            }`}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

export function Summary({ title, rows, onEdit }: { title: string; rows: string[][]; onEdit: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <p className="text-sm font-semibold text-navy-900">{title}</p>
        <button onClick={onEdit} className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"><Pencil className="h-3 w-3" /> Düzenle</button>
      </div>
      <dl className="divide-y divide-slate-50 px-4 py-1">
        {rows.map(([k, v], i) => (
          <div key={i} className="grid grid-cols-5 gap-3 py-2 text-sm">
            <dt className="col-span-2 text-slate-500">{k}</dt>
            <dd className="col-span-3 text-navy-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
