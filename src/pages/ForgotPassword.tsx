import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, KeyRound, MailCheck } from 'lucide-react'
import { AuthCard, AuthError, authInputClass } from '../components/AuthCard'
import { Button } from '../components/Button'
import { LocalizedLink } from '../components/LocalizedLink'
import { useLocale } from '../context/LocaleContext'
import { BackendUnavailableError, backendAuthStatus, backendForgotPassword } from '../lib/backend'

export default function ForgotPassword() {
  const { t } = useLocale()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [demoMode, setDemoMode] = useState(false)

  useEffect(() => {
    void backendAuthStatus()
      .then((s) => setDemoMode((s.deployment_mode || 'demo') === 'demo'))
      .catch(() => undefined)
  }, [])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await backendForgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      setError(
        err instanceof BackendUnavailableError
          ? t('auth.backendUnreachable')
          : err instanceof Error
            ? err.message
            : t('auth.loginFailed'),
      )
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <AuthCard icon={<MailCheck className="h-5 w-5" />} title={t('auth.forgotSentTitle')}>
        <p className="text-sm leading-relaxed text-navy-600" role="status">
          {t('auth.forgotSentBody')}
        </p>
        {demoMode && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
            {t('auth.forgotDemoNote')}
          </p>
        )}
        <LocalizedLink to="/giris" className="mt-5 inline-flex text-sm font-semibold text-sky-600 hover:underline">
          {t('auth.backToLogin')}
        </LocalizedLink>
      </AuthCard>
    )
  }

  return (
    <AuthCard icon={<KeyRound className="h-5 w-5" />} title={t('auth.forgotTitle')} subtitle={t('auth.forgotSubtitle')}>
      <form onSubmit={onSubmit}>
        <label className="block text-xs font-medium text-navy-700">
          {t('auth.email')}
          <input
            className={`${authInputClass} mt-1.5`}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <AuthError message={error} />
        <Button
          type="submit"
          className="mt-5 w-full !bg-sky-500 hover:!bg-sky-600"
          size="lg"
          disabled={busy || !email.includes('@')}
          icon={<ArrowRight className="h-4 w-4" />}
        >
          {busy ? t('common.loading') : t('auth.forgotSubmit')}
        </Button>
        <p className="mt-4 text-center text-sm">
          <LocalizedLink to="/giris" className="font-semibold text-sky-600 hover:underline">
            {t('auth.backToLogin')}
          </LocalizedLink>
        </p>
      </form>
    </AuthCard>
  )
}
