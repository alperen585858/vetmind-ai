export type Locale = 'tr' | 'en'

export const LOCALES: Locale[] = ['tr', 'en']

export const LOCALE_STORAGE_KEY = 'vetmind.locale'

export function isLocale(value: unknown): value is Locale {
  return value === 'tr' || value === 'en'
}
