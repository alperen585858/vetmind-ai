import { useEffect, useRef } from 'react'
import { BookOpen, FileText, X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { kbLicenseLabel, kbSourceText, kbTypeLabel } from '../data/mock'

export function SourcePanel() {
  const { t, locale } = useLocale()
  const { sourceId, closeSource, kbSources } = useApp()
  const panelRef = useRef<HTMLElement>(null)
  const s = kbSources.find((x) => x.id === sourceId)

  useEffect(() => {
    if (!s) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSource()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [s, closeSource])

  if (!s) return null
  const text = kbSourceText(s, locale)
  return (
    <div className="fixed inset-0 z-40 no-print" role="presentation">
      <div className="absolute inset-0 bg-navy-950/20" onClick={closeSource} aria-hidden />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('kb.sourcePanelTitle', { id: s.id })}
        className="absolute right-0 top-0 flex h-full w-full max-w-md animate-slide-in flex-col bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-navy-900">
            <BookOpen className="h-4 w-4 text-teal-600" aria-hidden /> {t('kb.sourcePanelTitle', { id: s.id })}
          </div>
          <button
            type="button"
            onClick={closeSource}
            aria-label={t('common.close')}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div>
            <p className="text-lg font-semibold leading-snug text-navy-900">{text.title}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-navy-50 px-2 py-0.5 font-medium text-navy-700">
                {kbTypeLabel(s.type, locale)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  s.license === 'İzinli' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                }`}
              >
                {t('kb.licenseLabel', { license: kbLicenseLabel(s.license, locale) })}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('kb.section')}</p>
            <p className="mt-1 text-sm text-navy-800">{text.section}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('kb.passage')}</p>
            <blockquote className="mt-2 rounded-lg border-l-4 border-teal-500 bg-teal-50/50 p-4 text-sm leading-relaxed text-navy-900">
              {text.passage}
            </blockquote>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="text-xs text-slate-500">{t('kb.chunks')}</p>
            <p className="font-semibold text-navy-900">{s.chunks}</p>
          </div>
          <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t('kb.demoDisclaimer')}
          </p>
        </div>
      </aside>
    </div>
  )
}
