import type { ReactNode } from 'react'

type Accent = 'teal' | 'emerald' | 'sky' | 'indigo' | 'violet' | 'slate'

const ACCENT: Record<Accent, string> = {
  teal: 'bg-[radial-gradient(ellipse_at_15%_0%,rgba(45,212,191,0.35),transparent_50%),radial-gradient(ellipse_at_100%_80%,rgba(20,184,166,0.18),transparent_45%)]',
  emerald:
    'bg-[radial-gradient(ellipse_at_15%_0%,rgba(52,211,153,0.35),transparent_50%),radial-gradient(ellipse_at_100%_80%,rgba(45,212,191,0.2),transparent_45%)]',
  sky: 'bg-[radial-gradient(ellipse_at_15%_0%,rgba(56,189,248,0.38),transparent_50%),radial-gradient(ellipse_at_100%_80%,rgba(14,165,233,0.2),transparent_45%)]',
  indigo:
    'bg-[radial-gradient(ellipse_at_15%_0%,rgba(129,140,248,0.4),transparent_50%),radial-gradient(ellipse_at_100%_80%,rgba(99,102,241,0.22),transparent_45%)]',
  violet:
    'bg-[radial-gradient(ellipse_at_15%_0%,rgba(167,139,250,0.38),transparent_50%),radial-gradient(ellipse_at_100%_80%,rgba(139,92,246,0.2),transparent_45%)]',
  slate:
    'bg-[radial-gradient(ellipse_at_15%_0%,rgba(148,163,184,0.35),transparent_50%),radial-gradient(ellipse_at_100%_80%,rgba(100,116,139,0.2),transparent_45%)]',
}

const EYEBROW: Record<Accent, string> = {
  teal: 'text-teal-300/90',
  emerald: 'text-emerald-300/90',
  sky: 'text-sky-300/90',
  indigo: 'text-indigo-300/90',
  violet: 'text-violet-300/90',
  slate: 'text-slate-300/90',
}

/** Dark energetic hero used by worklist / report / queue pages. */
export function ListPageHero({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  accent = 'teal',
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  accent?: Accent
}) {
  return (
    <section className="relative overflow-hidden rounded-[1.5rem] bg-[color:var(--vm-midnight,#0b1728)] px-5 py-6 text-white shadow-[0_20px_50px_-28px_rgba(11,23,40,0.55)] sm:px-7">
      <div aria-hidden className={`pointer-events-none absolute inset-0 ${ACCENT[accent]}`} />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${EYEBROW[accent]}`}>{eyebrow}</p>
          ) : null}
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          {subtitle ? <p className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-300">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="relative mt-5">{children}</div> : null}
    </section>
  )
}
