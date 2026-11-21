import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText, ShieldAlert } from 'lucide-react'
import { AuthCard, AuthError } from '../../components/AuthCard'
import { LocalizedLink } from '../../components/LocalizedLink'
import { useLocale } from '../../context/LocaleContext'
import { presentApiError } from '../../lib/apiErrors'
import { BackendUnavailableError, fetchPublicReportView, type PublicReportView } from '../../lib/backend'

/**
 * Public single-use report view opened from an emailed magic link
 * (`/rapor-baglanti?token=…`). Token is stripped from the address bar after read.
 */
export default function ReportLink() {
  const { t } = useLocale()
  const [params] = useSearchParams()
  const [token] = useState(() => params.get('token') || '')
  const [view, setView] = useState<PublicReportView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)
    if (window.location.search.includes('token=')) {
      window.history.replaceState(window.history.state, '', window.location.pathname)
    }
    return () => meta.remove()
  }, [])

  useEffect(() => {
    if (!token) {
      setError(t('apiErrors.report_link_invalid'))
      setLoading(false)
      return
    }
    let cancelled = false
    void fetchPublicReportView(token, true)
      .then((res) => {
        if (!cancelled) setView(res)
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof BackendUnavailableError) {
          setError(t('auth.backendUnreachable'))
          return
        }
        setError(presentApiError(err, t).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, t])

  if (loading) {
    return (
      <AuthCard
        icon={<FileText className="h-6 w-6" />}
        title={t('reportLink.loadingTitle')}
        subtitle={t('reportLink.loadingBody')}
      >
        <p className="text-sm text-navy-300">{t('common.loading')}</p>
      </AuthCard>
    )
  }

  if (error || !view) {
    return (
      <AuthCard
        title={t('reportLink.errorTitle')}
        subtitle={t('reportLink.errorBody')}
        icon={<ShieldAlert className="h-6 w-6 text-rose-300" />}
      >
        <AuthError message={error || t('apiErrors.report_link_invalid')} />
        <p className="mt-4 text-sm text-navy-300">
          <LocalizedLink to="/kayit" className="font-medium text-teal-300 hover:underline">
            {t('reportLink.registerCta')}
          </LocalizedLink>
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={t('reportLink.title', { patient: view.patient_name })}
      subtitle={t('reportLink.subtitle', { version: String(view.report_version) })}
      icon={<FileText className="h-6 w-6" />}
    >
      <div className="space-y-4 text-sm text-navy-100">
        {view.technique ? (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-teal-300/90">
              {t('sections.klinikOzet')}
            </h2>
            <p className="mt-1 whitespace-pre-wrap">{view.technique}</p>
          </section>
        ) : null}
        {view.findings ? (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-teal-300/90">
              {t('sections.bulgular')}
            </h2>
            <p className="mt-1 whitespace-pre-wrap text-navy-100">{view.findings}</p>
          </section>
        ) : null}
        {view.impression ? (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-teal-300/90">
              {t('sections.degerlendirme')}
            </h2>
            <p className="mt-1 whitespace-pre-wrap text-navy-100">{view.impression}</p>
          </section>
        ) : null}
        {view.recommendations ? (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-teal-300/90">
              {t('sections.oneriler')}
            </h2>
            <p className="mt-1 whitespace-pre-wrap text-navy-100">{view.recommendations}</p>
          </section>
        ) : null}
        {view.note ? (
          <p className="rounded-lg bg-white/5 px-3 py-2 text-xs text-navy-200 ring-1 ring-inset ring-white/10">{view.note}</p>
        ) : null}
        <p className="text-sm text-navy-300">
          <LocalizedLink to="/kayit" className="font-medium text-teal-300 hover:underline">
            {t('reportLink.registerCta')}
          </LocalizedLink>
        </p>
      </div>
    </AuthCard>
  )
}
