import { useEffect, useState, type FormEvent } from 'react'
import { MailCheck, Send } from 'lucide-react'
import { Button } from '../../shared/ui/Button'
import { authInputClass } from '../../shared/ui/AuthCard'
import { useLocale } from '../../shared/shell/LocaleContext'
import { userErrorMessage } from '../../shared/lib/apiErrors'
import { BackendUnavailableError, backendResendVerification } from '../../shared/api'

const COOLDOWN_SECONDS = 60

/**
 * "Send the verification link again" (issue #41). The backend answers the same for every
 * address, so the confirmation never says whether the account exists.
 * With ``email`` (right after sign-up) only the button shows; otherwise the user types it.
 */
export function ResendVerification({ email: knownEmail }: { email?: string }) {
  const { t } = useLocale()
  const [email, setEmail] = useState(knownEmail ?? '')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const target = email.trim()
    if (!target) return setError(t('auth.verifyEmailRequired'))
    setBusy(true)
    try {
      await backendResendVerification(target)
      setSent(true)
      setCooldown(COOLDOWN_SECONDS)
    } catch (err) {
      setError(err instanceof BackendUnavailableError ? t('auth.backendUnreachable') : userErrorMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-5">
      {!knownEmail && (
        <label className="block text-xs font-medium text-navy-300">
          {t('auth.email')}
          <input
            className={`${authInputClass} mt-1.5`}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
      )}
      {sent && (
        <p role="status" className="mt-3 flex items-start gap-2 text-sm text-teal-200">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
          {t('auth.verifyResent')}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-200 ring-1 ring-inset ring-rose-400/30">
          {error}
        </p>
      )}
      <Button
        type="submit"
        variant="secondary"
        className="mt-3"
        disabled={busy || cooldown > 0}
        icon={<Send className="h-4 w-4" />}
      >
        {busy
          ? t('common.loading')
          : cooldown > 0
            ? t('auth.verifyResendWait', { seconds: cooldown })
            : t('auth.verifyResend')}
      </Button>
    </form>
  )
}
