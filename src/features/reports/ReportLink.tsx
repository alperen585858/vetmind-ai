import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText, ShieldAlert } from 'lucide-react'
import { AuthCard, AuthError } from '../../shared/ui/AuthCard'
import { useLocale } from '../../shared/shell/LocaleContext'
import { presentApiError } from '../../shared/lib/apiErrors'
import { BackendUnavailableError, checkPublicReportLink, fetchPublicReportView, type PublicReportView } from '../../shared/api'
import { Button } from '../../shared/ui/Button'

/**
 * Public report view opened from a report link (`/rapor-baglanti?token=…`).
 * #84: loading the page only checks the link; the report is fetched when the reader
 * presses "Raporu görüntüle" (link scanners do not press buttons). The link can be
 * reopened until it expires or is revoked. The token is stripped from the address bar.
 */
export default function ReportLink() {
  const { t } = useLocale()
  const [params] = useSearchParams()
  const [token] = useState(() => params.get('token') || '')
  const [view, setView] = useState<PublicReportView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState<{ report_version: number; expires_at: number } | null>(null)
  const [opening, setOpening] = useState(false)

  const showError = (err: unknown) => {
    if (err instanceof BackendUnavailableError) setError(t('auth.backendUnreachable'))
    else setError(presentApiError(err, t).message)
  }

  const openReport = () => {
    setOpening(true)
    void fetchPublicReportView(token)
      .then(setView)
      .catch(showError)
      .finally(() => setOpening(false))
  }

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
    void checkPublicReportLink(token)
      .then((res) => {
        if (!cancelled) setReady(res)
      })
      .catch((err) => {
        if (!cancelled) showError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (!error && ready && !view) {
    return (
      <AuthCard
        icon={<FileText className="h-6 w-6" />}
        title={t('reportLink.readyTitle')}
        subtitle={t('reportLink.readyBody', { version: String(ready.report_version) })}
      >
        <Button className="w-full" size="lg" disabled={opening} onClick={openReport}>
          {opening ? t('common.loading') : t('reportLink.open')}
        </Button>
        <p className="mt-3 text-xs text-navy-300">
          {t('reportLink.validUntil', { date: new Date(ready.expires_at * 1000).toLocaleString('tr-TR') })}
        </p>
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
      </div>
    </AuthCard>
  )
}
