import type { Locale } from './types'
import en from './en.json'
import tr from './tr.json'

type Dict = Record<string, unknown>

const catalogs: Record<Locale, Dict> = { tr, en }

function lookup(dict: Dict, path: string): string | undefined {
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

export { en, tr }
