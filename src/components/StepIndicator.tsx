import { Check } from 'lucide-react'

export function StepIndicator({ steps, current, onSelect }: { steps: string[]; current: number; onSelect?: (i: number) => void }) {
  return (
    <ol className="flex w-full items-center overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={s} className={`flex items-center ${i < steps.length - 1 ? 'flex-1' : ''}`}>
            <button
              type="button"
              disabled={!done || !onSelect}
              onClick={() => onSelect?.(i)}
              className="flex shrink-0 items-center gap-2 disabled:cursor-default"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition ${
                  done ? 'bg-teal-600 text-white' : active ? 'bg-navy-900 text-white ring-4 ring-navy-100' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className={`hidden whitespace-nowrap text-sm font-medium md:inline ${active ? 'text-navy-900' : done ? 'text-teal-700' : 'text-slate-500'}`}>{s}</span>
            </button>
            {i < steps.length - 1 && <span className={`mx-3 h-0.5 min-w-[1rem] flex-1 rounded ${done ? 'bg-teal-500' : 'bg-slate-200'}`} />}
          </li>
        )
      })}
    </ol>
  )
}
