import { Fragment } from 'react'
import { LocalizedLink } from './LocalizedLink'
import { ChevronRight } from 'lucide-react'

export type Crumb = { label: string; to?: string }

/** Consistent breadcrumb trail for PageHeader.breadcrumb */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (!items.length) return null
  return (
    <nav aria-label="Sayfa konumu" className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
      {items.map((item, i) => {
        const last = i === items.length - 1
        return (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-slate-300" aria-hidden />}
            {item.to && !last ? (
              <LocalizedLink to={item.to} className="rounded font-medium text-teal-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
                {item.label}
              </LocalizedLink>
            ) : (
              <span className={last ? 'font-medium text-slate-700' : undefined} aria-current={last ? 'page' : undefined}>
                {item.label}
              </span>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}
