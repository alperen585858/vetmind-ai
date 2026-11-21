import type { ReactNode } from 'react'

/** Shared filter / search strip used on list pages for a consistent visual language. */
export function FilterToolbar({
  children,
  trailing,
  className = '',
}: {
  children: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-3 shadow-soft backdrop-blur-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:p-3.5 ${className}`}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {trailing ? <div className="flex shrink-0 flex-wrap items-center gap-2">{trailing}</div> : null}
    </div>
  )
}

/** Compact metric pills above tables / boards. */
export function MetricPills({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap gap-2">{children}</div>
}

export function MetricPill({
  label,
  value,
  active,
  onClick,
  tone = 'neutral',
}: {
  label: string
  value: ReactNode
  active?: boolean
  onClick?: () => void
  tone?: 'neutral' | 'teal' | 'amber' | 'rose' | 'sky' | 'violet'
}) {
  const tones = {
    neutral: active
      ? 'bg-navy-900 text-white ring-navy-900'
      : 'bg-white text-navy-800 ring-slate-200 hover:ring-slate-300',
    teal: active
      ? 'bg-teal-700 text-white ring-teal-700'
      : 'bg-teal-50 text-teal-800 ring-teal-200 hover:ring-teal-300',
    amber: active
      ? 'bg-amber-600 text-white ring-amber-600'
      : 'bg-amber-50 text-amber-900 ring-amber-200 hover:ring-amber-300',
    rose: active
      ? 'bg-rose-700 text-white ring-rose-700'
      : 'bg-rose-50 text-rose-800 ring-rose-200 hover:ring-rose-300',
    sky: active
      ? 'bg-sky-600 text-white ring-sky-600'
      : 'bg-sky-50 text-sky-900 ring-sky-200 hover:ring-sky-300',
    violet: active
      ? 'bg-violet-700 text-white ring-violet-700'
      : 'bg-violet-50 text-violet-900 ring-violet-200 hover:ring-violet-300',
  }
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition ${tones[tone]}`}
    >
      <span className="opacity-80">{label}</span>
      <span className="tabular-nums">{value}</span>
    </Comp>
  )
}
