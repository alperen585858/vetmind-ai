import type { ReactNode } from 'react'
import { useLocale } from '../context/LocaleContext'

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
      className={`flex flex-col items-center justify-center text-center ${compact ? 'px-4 py-8' : 'px-6 py-14'}`}
    >
      <div className={`mb-3 rounded-full bg-accent-soft text-accent ${compact ? 'p-2' : 'p-3'}`}>{icon}</div>
      <p className={`font-display font-semibold text-navy-900 ${compact ? 'text-sm' : 'text-lg'}`}>{displayTitle}</p>
      {displayText !== undefined ? (
        <p className={`text-caption mt-1 max-w-sm ${compact ? '' : 'text-sm text-slate-500'}`}>{displayText}</p>
      ) : null}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
