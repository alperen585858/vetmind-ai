import type { Locale } from './types'
import tr from './tr.json'

type Dict = Record<string, unknown>

// Turkish is the default locale and the fallback for missing keys, so it ships in the entry
// bundle. English (~33 KB gzip) is loaded on demand: most sessions never need it.
const catalogs: Partial<Record<Locale, Dict>> = { tr }
let enLoading: Promise<void> | null = null

/** True when ``locale``'s catalog is in memory (Turkish always is). */
export function isLocaleLoaded(locale: Locale): boolean {
  return catalogs[locale] != null
}

/** Load a locale's catalog (no-op if already loaded). Until it resolves, texts fall back to Turkish. */
export function loadLocale(locale: Locale): Promise<void> {
  if (isLocaleLoaded(locale)) return Promise.resolve()
  enLoading ??= import('./en.json').then(
    (mod) => {
      catalogs.en = mod.default as Dict
    },
    (err) => {
      enLoading = null // allow a retry (e.g. a flaky network)
      throw err
    },
  )
  return enLoading
}

function lookup(dict: Dict | undefined, path: string): string | undefined {
  const parts = path.split('.')
  let cur: unknown = dict
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Dict)[p]
  }
  return typeof cur === 'string' ? cur : undefined
}

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string

export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  let text = lookup(catalogs[locale], key) ?? lookup(catalogs.tr, key)
  if (text == null) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] missing key: ${key}`)
    }
    return key
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return text
}

export function createTranslator(locale: Locale): TranslateFn {
  return (key, params) => translate(locale, key, params)
}

export { tr }
