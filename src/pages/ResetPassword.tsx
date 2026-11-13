import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, KeyRound, ShieldAlert } from 'lucide-react'
import { AuthCard, AuthError, authInputClass } from '../components/AuthCard'
import { Button } from '../components/Button'
import { LocalizedLink } from '../components/LocalizedLink'
import { PasswordStrength, usePasswordError } from '../components/PasswordStrength'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { useLocalizedNavigate } from '../hooks/useLocalizedNavigate'
import { BackendUnavailableError, backendResetPassword } from '../lib/backend'

// Kept in memory (not storage) so the page survives a remount, e.g. when signing out
// re-renders the route tree after the token was already removed from the address bar.
let rememberedToken = ''
let finished = false

/**
 * Opened from the emailed link (/sifre-sifirla?token=…). The token is read once and then
 * removed from the address bar so it doesn't linger in history or leak via Referer.
 */
export default function ResetPassword() {
  const { t } = useLocale()
  const { role, signOut } = useApp()
  const nav = useLocalizedNavigate()
  const passwordError = usePasswordError()
  const [params] = useSearchParams()
  const [token] = useState(() => {
    const fromUrl = params.get('token')
    if (fromUrl) {
      rememberedToken = fromUrl
      finished = false
    }
    return rememberedToken
  })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the backend refusing the link (used/expired/unknown) should offer a new one.
  const [linkRejected, setLinkRejected] = useState(false)
  const [done, setDone] = useState(finished)

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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLinkRejected(false)
    const weak = passwordError(password)
    if (weak) return setError(weak)
    if (password !== confirm) return setError(t('auth.passwordsDontMatch'))
    setBusy(true)
    try {
      await backendResetPassword(token, password)
      rememberedToken = ''
      finished = true
      setDone(true)
    } catch (err) {
      setLinkRejected(!(err instanceof BackendUnavailableError))
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

  const goToLogin = () => {
    finished = false
    // The reset ended every session, including one open in this browser.
    if (role) signOut()
    nav('/giris')
  }

  if (done) {
    return (
      <AuthCard icon={<CheckCircle2 className="h-5 w-5" />} title={t('auth.resetDoneTitle')}>
        <p className="text-sm text-navy-600" role="status">
          {t('auth.resetDoneBody')}
        </p>
        <button type="button" onClick={goToLogin} className="mt-5 inline-flex text-sm font-semibold text-sky-600 hover:underline">
          {t('auth.backToLogin')}
        </button>
      </AuthCard>
    )
  }

  if (!token) {
    return (
      <AuthCard icon={<ShieldAlert className="h-5 w-5" />} title={t('auth.resetTitle')}>
        <p className="text-sm text-navy-600" role="alert">
          {t('auth.resetMissingToken')}
        </p>
        <LocalizedLink to="/sifremi-unuttum" className="mt-5 inline-flex text-sm font-semibold text-sky-600 hover:underline">
          {t('auth.requestNewLink')}
        </LocalizedLink>
      </AuthCard>
    )
  }

  return (
    <AuthCard icon={<KeyRound className="h-5 w-5" />} title={t('auth.resetTitle')} subtitle={t('auth.resetSubtitle')}>
      <form onSubmit={onSubmit} noValidate>
        <label className="block text-xs font-medium text-navy-700">
          {t('auth.newPassword')}
          <input
            className={`${authInputClass} mt-1.5`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
        </label>
        <PasswordStrength password={password} />
        <label className="mt-4 block text-xs font-medium text-navy-700">
          {t('auth.confirmPassword')}
          <input
            className={`${authInputClass} mt-1.5`}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>
        <AuthError message={error} />
        {error && linkRejected && (
          <p className="mt-2 text-xs">
            <LocalizedLink to="/sifremi-unuttum" className="font-medium text-sky-600 hover:underline">
              {t('auth.requestNewLink')}
            </LocalizedLink>
          </p>
        )}
        <Button
          type="submit"
          className="mt-5 w-full !bg-sky-500 hover:!bg-sky-600"
          size="lg"
          disabled={busy}
          icon={<ArrowRight className="h-4 w-4" />}
        >
          {busy ? t('common.loading') : t('auth.resetSubmit')}
        </Button>
      </form>
    </AuthCard>
  )
}
