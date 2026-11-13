import { Link } from 'react-router-dom'
import { useLocale } from '../context/LocaleContext'

export function NotFound() {
  const { locale } = useLocale()
  const turkish = locale === 'tr'

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold text-teal-700">404</p>
      <h1 className="text-2xl font-semibold text-slate-900">
        {turkish ? 'Sayfa bulunamadı' : 'Page not found'}
      </h1>
      <p className="text-slate-600">
        {turkish
          ? 'Aradığınız adres mevcut değil veya taşınmış olabilir.'
          : 'The address you requested does not exist or may have moved.'}
      </p>
      <Link to="/" className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">
        {turkish ? 'Ana sayfaya dön' : 'Return home'}
      </Link>
    </main>
  )
}
