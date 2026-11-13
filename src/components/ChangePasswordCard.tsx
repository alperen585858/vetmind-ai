import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from './Button'
import { Card, CardHeader } from './Card'
import { PasswordStrength, usePasswordError } from './PasswordStrength'
import { useApp } from '../context/AppContext'
import { useLocale } from '../context/LocaleContext'
import { setBackendTokens } from '../lib/auth'
import { BackendUnavailableError, backendChangePassword } from '../lib/backend'

/** Settings card: change your own password (POST /auth/password/change). */
export function ChangePasswordCard() {
  const { t } = useLocale()
  const { authMode, pushToast } = useApp()
  const passwordError = usePasswordError()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const weak = passwordError(next)
    if (weak) return setError(weak)
    if (next !== confirm) return setError(t('auth.passwordsDontMatch'))
    setBusy(true)
    try {
      // Other sessions end; the new pair keeps this one signed in.
      setBackendTokens(await backendChangePassword(current, next))
      setCurrent('')
      setNext('')
      setConfirm('')
      pushToast({ tone: 'success', title: t('settings.passwordChanged'), body: t('settings.passwordChangedBody') })
    } catch (err) {
      setError(
        err instanceof BackendUnavailableError
          ? t('auth.backendUnreachable')
          : err instanceof Error
            ? err.message
            : t('settings.saveFailed'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-5">
      <CardHeader title={t('settings.changePassword')} icon={<KeyRound className="h-5 w-5" />} />
      {!authMode.authEnabled ? (
        <p className="mt-2 text-sm text-slate-600">{t('settings.changePasswordUnavailable')}</p>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-2 space-y-3">
          <p className="text-sm text-slate-600">{t('settings.changePasswordHint')}</p>
          <label className="label">
            {t('settings.currentPassword')}
            <input
              className="input mt-1"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </label>
          <label className="label">
            {t('auth.newPassword')}
            <input
              className="input mt-1"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
            <PasswordStrength password={next} />
          </label>
          <label className="label">
            {t('auth.confirmPassword')}
            <input
              className="input mt-1"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </label>
          {error && (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !current || !next}>
            {busy ? t('common.loading') : t('settings.changePasswordSubmit')}
          </Button>
        </form>
      )}
    </Card>
  )
}
