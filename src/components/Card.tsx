import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-vm border border-slate-200/80 bg-surface-elevated shadow-soft ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 text-accent">{icon}</div>}
        <div>
          <h3 className="text-title text-[15px]">{title}</h3>
          {subtitle && <p className="text-caption mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

export function StatCard({
  label,
  value,
  icon,
  hint,
  tone = 'teal',
  className = '',
  to,
}: {
  label: string
  value: ReactNode
  icon: ReactNode
  hint?: string
  tone?: 'teal' | 'navy' | 'amber' | 'emerald' | 'violet' | 'sky'
  className?: string
  /** When set, the whole card navigates to this path. */
  to?: string
}) {
  const tones = {
    teal: 'bg-accent-soft text-teal-700',
    navy: 'bg-navy-50 text-navy-700',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    violet: 'bg-violet-50 text-violet-700',
    sky: 'bg-sky-50 text-sky-700',
  }
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <div className={`shrink-0 rounded-lg p-1.5 [&_svg]:h-4 [&_svg]:w-4 ${tones[tone]}`}>{icon}</div>
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-navy-900 tabular-nums sm:text-[1.75rem]">
        {value}
      </p>
      {hint && <p className="text-caption mt-auto pt-1 text-[11px] leading-snug">{hint}</p>}
    </>
  )
  const shell = `flex h-full flex-col p-4 ${className}`
  if (to) {
    return (
      <Link
        to={to}
        aria-label={`${label}: ${typeof value === 'string' || typeof value === 'number' ? value : ''} — ilgili sayfaya git`}
        className={`rounded-vm border border-slate-200/80 bg-surface-elevated shadow-soft transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${shell}`}
      >
        {body}
      </Link>
    )
  }
  return <Card className={shell}>{body}</Card>
}
