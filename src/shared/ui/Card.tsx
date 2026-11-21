import type { CSSProperties, ReactNode } from 'react'
import { LocalizedLink } from '../../components/LocalizedLink'

export function Card({
  children,
  className = '',
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={`vm-card-surface rounded-vm ${className}`} style={style}>
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
    <div className="flex items-start justify-between gap-3 border-b border-slate-100/90 bg-gradient-to-r from-slate-50/80 to-transparent px-5 py-4">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent ring-1 ring-inset ring-teal-200/50">
            {icon}
          </div>
        )}
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
    teal: 'bg-gradient-to-br from-teal-50 to-teal-100/80 text-teal-700 ring-teal-200/60',
    navy: 'bg-gradient-to-br from-navy-50 to-navy-100/80 text-navy-700 ring-navy-200/60',
    amber: 'bg-gradient-to-br from-amber-50 to-amber-100/80 text-amber-700 ring-amber-200/60',
    emerald: 'bg-gradient-to-br from-emerald-50 to-emerald-100/80 text-emerald-700 ring-emerald-200/60',
    violet: 'bg-gradient-to-br from-violet-50 to-violet-100/80 text-violet-700 ring-violet-200/60',
    sky: 'bg-gradient-to-br from-sky-50 to-sky-100/80 text-sky-700 ring-sky-200/60',
  }
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <div className={`shrink-0 rounded-xl p-2 ring-1 ring-inset [&_svg]:h-4 [&_svg]:w-4 ${tones[tone]}`}>{icon}</div>
      </div>
      <p className="mt-3 font-display text-2xl font-bold tracking-tight text-navy-900 tabular-nums sm:text-[1.85rem]">
        {value}
      </p>
      {hint && <p className="text-caption mt-auto pt-2 text-[11px] leading-snug">{hint}</p>}
    </>
  )
  const shell = `flex h-full flex-col p-4 ${className}`
  if (to) {
    return (
      <LocalizedLink
        to={to}
        aria-label={`${label}: ${typeof value === 'string' || typeof value === 'number' ? value : ''} — ilgili sayfaya git`}
        className={`vm-card-surface rounded-vm transition duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${shell}`}
      >
        {body}
      </LocalizedLink>
    )
  }
  return <Card className={shell}>{body}</Card>
}
