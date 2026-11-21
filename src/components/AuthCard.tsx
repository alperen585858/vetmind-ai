import type { ReactNode } from 'react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { LocalizedLink } from './LocalizedLink'
import { Logo } from './Logo'
import { useLocale } from '../context/LocaleContext'

/** Centered card for the small public auth pages (forgot / reset password / report link). */
export function AuthCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode
  title: string
  subtitle?: string
  children: ReactNode
}) {
  const { t } = useLocale()
  return (
    <div className="relative min-h-screen overflow-hidden bg-navy-950">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 top-10 h-[420px] w-[420px] rounded-full bg-teal-600/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 bottom-0 h-[320px] w-[320px] rounded-full bg-sky-600/10 blur-3xl"
      />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <LocalizedLink to="/" aria-label={t('landing.homeAria')}>
            <Logo dark />
          </LocalizedLink>
          <LanguageSwitcher persistRemote={false} size="sm" />
        </div>
        <main className="vm-page-enter mt-10 rounded-2xl border border-navy-800 bg-navy-900/80 p-7 shadow-xl backdrop-blur">
          <div className="flex items-center gap-3 text-teal-300">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500/15 ring-1 ring-inset ring-teal-400/30">
              {icon}
            </span>
            <h1 className="font-display text-xl font-bold tracking-tight text-white">{title}</h1>
          </div>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-navy-300">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </main>
      </div>
    </div>
  )
}

export const authInputClass =
  'input w-full border-navy-700 bg-navy-950 text-white placeholder:text-navy-500 focus:border-teal-500 focus:ring-teal-500/20'

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-3 rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-200 ring-1 ring-inset ring-rose-400/30">
      {message}
    </p>
  )
}
