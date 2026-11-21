import type { ReactNode } from 'react'
import { useLocale } from '../shell/LocaleContext'

export function EmptyState({
  icon,
  title,
  text,
  action,
  compact = false,
}: {
  icon: ReactNode
  title?: string
  text?: string
  action?: ReactNode
  compact?: boolean
}) {
  const { t } = useLocale()
  const displayTitle = title ?? t('empty.defaultTitle')
  const displayText = text

  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center text-center ${compact ? 'px-4 py-8' : 'px-6 py-16'}`}
    >
      <div
        className={`mb-4 rounded-2xl bg-gradient-to-br from-accent-soft to-white text-accent shadow-sm ring-1 ring-inset ring-teal-200/50 ${
          compact ? 'p-2.5' : 'p-4'
        }`}
      >
        {icon}
      </div>
      <p className={`font-display font-bold tracking-tight text-navy-900 ${compact ? 'text-sm' : 'text-xl'}`}>
        {displayTitle}
      </p>
      {displayText !== undefined ? (
        <p className={`mt-2 max-w-md leading-relaxed text-slate-500 ${compact ? 'text-xs' : 'text-sm'}`}>{displayText}</p>
      ) : null}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
