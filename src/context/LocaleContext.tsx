import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createTranslator, type TranslateFn } from '../i18n'
import { isLocale, LOCALE_STORAGE_KEY, type Locale } from '../i18n/types'
import { updateUserSettings } from '../lib/backend'

type LocaleContextValue = {
  locale: Locale
  setLocale: (locale: Locale, opts?: { persistRemote?: boolean }) => void
  t: TranslateFn
  intlLocale: string
}

const Ctx = createContext<LocaleContextValue | null>(null)

function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isLocale(raw)) return raw
  } catch {
    /* ignore */
  }
  return 'tr'
}

function writeStoredLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* ignore */
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale())

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale, opts?: { persistRemote?: boolean }) => {
    setLocaleState(next)
    writeStoredLocale(next)
    document.documentElement.lang = next
    if (opts?.persistRemote) {
      void updateUserSettings({ language: next }).catch(() => {
        /* guest or backend down — local preference still applies */
      })
    }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (isLocale(detail)) {
        setLocaleState(detail)
        writeStoredLocale(detail)
        document.documentElement.lang = detail
      }
    }
    window.addEventListener('vetmind-locale', handler)
    return () => window.removeEventListener('vetmind-locale', handler)
  }, [])

  const t = useMemo(() => createTranslator(locale), [locale])
  const intlLocale = locale === 'en' ? 'en-US' : 'tr-TR'

  const value = useMemo(
    () => ({ locale, setLocale, t, intlLocale }),
    [locale, setLocale, t, intlLocale],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Apply language from backend user settings (login / refresh). */
export function applyLocaleFromSettings(language: string | undefined | null) {
  if (!isLocale(language)) return
  writeStoredLocale(language)
  document.documentElement.lang = language
  window.dispatchEvent(new CustomEvent('vetmind-locale', { detail: language }))
}

export function useLocale() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useLocale must be used within LocaleProvider')
  return v
}
