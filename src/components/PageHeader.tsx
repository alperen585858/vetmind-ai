import type { ReactNode } from 'react'
import { Breadcrumbs, type Crumb } from './Breadcrumbs'

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
  crumbs,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** Legacy slot — prefer `crumbs` for linked trails. */
  breadcrumb?: ReactNode
  crumbs?: Crumb[]
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {crumbs?.length ? (
          <div className="mb-1">
            <Breadcrumbs items={crumbs} />
          </div>
        ) : (
          breadcrumb && <div className="mb-1 text-xs text-slate-500">{breadcrumb}</div>
        )}
        <h1 className="text-display">{title}</h1>
        {subtitle && <p className="text-caption mt-1 sm:text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}
