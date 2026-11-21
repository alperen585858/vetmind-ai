import type { ReactNode } from 'react'
import { Breadcrumbs, type Crumb } from '../../components/Breadcrumbs'

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
    <header className="vm-page-header flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {crumbs?.length ? (
          <div className="mb-1.5">
            <Breadcrumbs items={crumbs} />
          </div>
        ) : (
          breadcrumb && <div className="mb-1.5 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{breadcrumb}</div>
        )}
        <h1 className="text-display">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 pb-0.5">{actions}</div>}
    </header>
  )
}
