import { Loader2 } from 'lucide-react'
import { useLocale } from '../context/LocaleContext'

/** Suspense fallback while a route page chunk downloads. */
export function PageLoader({ fullScreen = false }: { fullScreen?: boolean }) {
  const { t } = useLocale()
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2 text-sm text-slate-500 ${
        fullScreen ? 'min-h-screen' : 'min-h-[40vh]'
      }`}
    >
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      {t('common.loading')}
    </div>
  )
}
