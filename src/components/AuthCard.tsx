import type { ReactNode } from 'react'
import { LanguageSwitcher } from './LanguageSwitcher'
import { LocalizedLink } from './LocalizedLink'
import { Logo } from './Logo'
import { useLocale } from '../context/LocaleContext'

/** Centered card for the small public auth pages (forgot / reset password). */
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
    <div className="min-h-screen bg-[radial-gradient(900px_420px_at_90%_-10%,rgba(14,165,233,0.16),transparent_55%),radial-gradient(700px_360px_at_0%_0%,rgba(15,39,68,0.08),transparent_50%),linear-gradient(180deg,#eef6fc_0%,#f8fafc_100%)]">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <LocalizedLink to="/" aria-label={t('landing.homeAria')}>
            <Logo />
          </LocalizedLink>
          <LanguageSwitcher persistRemote={false} size="sm" />
        </div>
        <main className="vm-page-enter mt-10 rounded-2xl border border-sky-100/90 bg-white/95 p-7 shadow-[0_8px_32px_rgba(15,39,68,0.08)] backdrop-blur">
          <div className="flex items-center gap-3 text-sky-600">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 ring-1 ring-inset ring-sky-100">
              {icon}
            </span>
            <h1 className="font-display text-xl font-bold tracking-tight text-navy-900">{title}</h1>
          </div>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-navy-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </main>
      </div>
    </div>
  )
}

export const authInputClass =
  'input w-full border-sky-100 bg-sky-50/50 focus:border-sky-500 focus:ring-sky-500/20'

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-inset ring-rose-200">
      {message}
    </p>
  )
}
