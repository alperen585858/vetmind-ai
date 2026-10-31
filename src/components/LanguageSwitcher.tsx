import { useLocale } from '../context/LocaleContext'
import type { Locale } from '../i18n/types'

export function LanguageSwitcher({
  className = '',
  persistRemote = false,
  size = 'md',
}: {
  className?: string
  /** When true (authenticated), also PUT language to backend settings. */
  persistRemote?: boolean
  size?: 'sm' | 'md'
}) {
  const { locale, setLocale, t } = useLocale()
  const pad = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'

  const pick = (next: Locale) => {
    if (next === locale) return
    setLocale(next, { persistRemote })
  }

  return (
    <div
      className={`inline-flex items-center rounded-full border border-slate-200/80 bg-white/90 p-0.5 shadow-sm ${className}`}
      role="group"
      aria-label={t('common.language')}
    >
      {(['tr', 'en'] as Locale[]).map((code) => {
        const active = locale === code
        const label = code === 'tr' ? 'TR' : 'EN'
        return (
          <button
            key={code}
            type="button"
            onClick={() => pick(code)}
            aria-pressed={active}
            className={`${pad} rounded-full font-semibold tracking-wide transition ${
              active
                ? 'bg-navy-900 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-50 hover:text-navy-900'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
