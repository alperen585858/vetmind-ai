import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createTranslator, isLocaleLoaded, loadLocale, type TranslateFn } from '../../i18n'
import { isLocale, LOCALE_STORAGE_KEY, type Locale } from '../../i18n/types'
import { updateUserSettings } from '../api'

type LocaleContextValue = {
  locale: Locale
  setLocale: (locale: Locale, opts?: { persistRemote?: boolean }) => void
  t: TranslateFn
  intlLocale: string
}

const Ctx = createContext<LocaleContextValue | null>(null)

export function readStoredLocale(): Locale {
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

  // Switch only once the catalog is in memory, so the UI never flashes Turkish texts
  // while the English file downloads. If loading fails, switch anyway (Turkish fallback).
  const applyLocale = useCallback((next: Locale) => {
    writeStoredLocale(next)
    document.documentElement.lang = next
    if (isLocaleLoaded(next)) {
      setLocaleState(next)
      return
    }
    void loadLocale(next).then(
      () => setLocaleState(next),
      () => setLocaleState(next),
    )
  }, [])

  const setLocale = useCallback((next: Locale, opts?: { persistRemote?: boolean }) => {
    applyLocale(next)
    if (opts?.persistRemote) {
      void updateUserSettings({ language: next }).catch(() => {
        /* guest or backend down — local preference still applies */
      })
    }
  }, [applyLocale])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (isLocale(detail)) applyLocale(detail)
    }
    window.addEventListener('vetmind-locale', handler)
    return () => window.removeEventListener('vetmind-locale', handler)
  }, [applyLocale])

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
