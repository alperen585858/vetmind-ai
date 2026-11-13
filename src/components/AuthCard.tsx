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
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <LocalizedLink to="/" aria-label={t('landing.homeAria')}>
            <Logo />
          </LocalizedLink>
          <LanguageSwitcher persistRemote={false} size="sm" />
        </div>
        <main className="mt-10 rounded-2xl border border-sky-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-sky-600">
            {icon}
            <h1 className="text-lg font-semibold text-navy-900">{title}</h1>
          </div>
          {subtitle && <p className="mt-1 text-sm text-navy-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
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
