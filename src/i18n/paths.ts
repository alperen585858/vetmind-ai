import type { Locale } from './types'

/**
 * Canonical app paths are Turkish. English segment aliases live here.
 * Dynamic IDs (case-…, UUIDs) pass through unchanged.
 */
const TR_TO_EN: Record<string, string> = {
  giris: 'login',
  kayit: 'register',
  vakalar: 'cases',
  yeni: 'new',
  'dicom-yukle': 'dicom-upload',
  isleme: 'processing',
  inceleme: 'review',
  calisma: 'workspace',
  kuyruk: 'queue',
  'ai-tekrar': 'ai-resend',
  hayvanlar: 'pets',
  basvurular: 'submissions',
  mesajlar: 'messages',
  kullanicilar: 'users',
  raporlar: 'reports',
  moduller: 'modules',
  'bilgi-tabani': 'knowledge-base',
  sistem: 'system',
  'model-performansi': 'model-performance',
  ayarlar: 'settings',
}

const EN_TO_TR: Record<string, string> = Object.fromEntries(
  Object.entries(TR_TO_EN).map(([tr, en]) => [en, tr]),
)

function splitPath(pathname: string): { segments: string[]; search: string; hash: string } {
  const hashIdx = pathname.indexOf('#')
  const hash = hashIdx >= 0 ? pathname.slice(hashIdx) : ''
  const withoutHash = hashIdx >= 0 ? pathname.slice(0, hashIdx) : pathname
  const qIdx = withoutHash.indexOf('?')
  const search = qIdx >= 0 ? withoutHash.slice(qIdx) : ''
  const pathOnly = qIdx >= 0 ? withoutHash.slice(0, qIdx) : withoutHash
  const segments = pathOnly.split('/').filter(Boolean)
  return { segments, search, hash }
}

function mapSegments(segments: string[], table: Record<string, string>): string[] {
  return segments.map((seg) => table[seg] ?? seg)
}

/** Convert a path (TR or EN) into the path for the target locale. */
export function localizePath(path: string, locale: Locale): string {
  if (!path || path === '/') return path.startsWith('/') ? path : `/${path}`
  const absolute = path.startsWith('/') || path.startsWith('?') || path.startsWith('#')
  const { segments, search, hash } = splitPath(path)
  if (segments.length === 0) return `/${search}${hash}` || '/'

  // Normalize to TR first, then to target — works for either source locale.
  const canonical = mapSegments(segments, EN_TO_TR)
  const localized = locale === 'en' ? mapSegments(canonical, TR_TO_EN) : canonical
  const joined = `/${localized.join('/')}${search}${hash}`
  return absolute || path.startsWith('/') ? joined : joined.slice(1)
}

/** Always return the Turkish canonical path (for comparisons / dual-route keys). */
export function toCanonicalPath(path: string): string {
  return localizePath(path, 'tr')
}

/** Route path pairs for react-router registration (relative, no leading slash). */
export const APP_ROUTE_PAIRS: { tr: string; en: string }[] = [
  { tr: 'vakalar', en: 'cases' },
  { tr: 'vakalar/yeni', en: 'cases/new' },
  { tr: 'dicom-yukle', en: 'dicom-upload' },
  { tr: 'vakalar/:id', en: 'cases/:id' },
  { tr: 'vakalar/:id/isleme', en: 'cases/:id/processing' },
  { tr: 'vakalar/:id/inceleme', en: 'cases/:id/review' },
  { tr: 'vakalar/:id/calisma', en: 'cases/:id/workspace' },
  { tr: 'kuyruk', en: 'queue' },
  { tr: 'ai-tekrar', en: 'ai-resend' },
  { tr: 'hayvanlar', en: 'pets' },
  { tr: 'basvurular', en: 'submissions' },
  { tr: 'basvurular/:submissionId', en: 'submissions/:submissionId' },
  { tr: 'mesajlar', en: 'messages' },
  { tr: 'mesajlar/:threadId', en: 'messages/:threadId' },
  { tr: 'kullanicilar', en: 'users' },
  { tr: 'raporlar', en: 'reports' },
  { tr: 'raporlar/:id', en: 'reports/:id' },
  { tr: 'moduller', en: 'modules' },
  { tr: 'bilgi-tabani', en: 'knowledge-base' },
  { tr: 'sistem', en: 'system' },
  { tr: 'model-performansi', en: 'model-performance' },
  { tr: 'ayarlar', en: 'settings' },
]

export const PUBLIC_ROUTE_PAIRS: { tr: string; en: string }[] = [
  { tr: '/giris', en: '/login' },
  { tr: '/kayit', en: '/register' },
]
