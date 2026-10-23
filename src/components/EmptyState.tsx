import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  text,
  action,
  compact = false,
}: {
  icon: ReactNode
  title: string
  text?: string
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center text-center ${compact ? 'px-4 py-8' : 'px-6 py-14'}`}
    >
      <div className={`mb-3 rounded-full bg-slate-100 text-slate-500 ${compact ? 'p-2' : 'p-3'}`}>{icon}</div>
      <p className={`font-semibold text-navy-900 ${compact ? 'text-sm' : ''}`}>{title}</p>
      {text && <p className={`mt-1 max-w-sm text-slate-500 ${compact ? 'text-xs' : 'text-sm'}`}>{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
