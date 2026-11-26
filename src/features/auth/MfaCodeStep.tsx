import { useState, type FormEvent } from 'react'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { Button } from '../../shared/ui/Button'
import { useLocale } from '../../shared/shell/LocaleContext'
import { userErrorMessage } from '../../shared/lib/apiErrors'
import {
  BackendUnavailableError,
  backendMfaVerify,
  type BackendMfaChallenge,
  type BackendTokenResponse,
} from '../../shared/api'

/**
 * Issue #107: second sign-in step for accounts with two-step sign-in. Accepts the 6-digit
 * authenticator code (pasted with spaces is fine) or a backup code.
 */
export function MfaCodeStep({
  challenge,
  onDone,
  onCancel,
}: {
  challenge: BackendMfaChallenge
  onDone: (tokens: BackendTokenResponse) => void
  onCancel: () => void
}) {
  const { t } = useLocale()
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      onDone(await backendMfaVerify(challenge.mfa_token, code))
    } catch (err) {
      setCode('')
      setError(err instanceof BackendUnavailableError ? t('auth.backendUnreachable') : userErrorMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  const digits = code.replace(/\D/g, '')
  const ready = useBackup ? code.replace(/[^a-z0-9]/gi, '').length === 10 : digits.length === 6

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="rounded-2xl border border-sky-100 bg-white p-6 shadow-[0_12px_40px_rgba(14,165,233,0.12)] sm:p-7"
    >
      <div className="flex items-center gap-2 text-sky-600">
        <ShieldCheck className="h-5 w-5" />
        <h2 className="text-lg font-semibold text-navy-900">{t('auth.mfaTitle')}</h2>
      </div>
      <p className="mt-1 text-sm text-navy-500">
        {useBackup ? t('auth.mfaBackupHint') : t('auth.mfaHint')} <span className="font-medium">{challenge.email}</span>
      </p>
      <label className="mt-5 block text-xs font-medium text-navy-700">
        {useBackup ? t('auth.mfaBackupLabel') : t('auth.mfaCodeLabel')}
        <input
          className="input mt-1.5 w-full border-sky-100 bg-sky-50/50 text-center font-mono text-xl tracking-[0.4em] focus:border-sky-500 focus:ring-sky-500/20"
          inputMode={useBackup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoFocus
          maxLength={useBackup ? 14 : 9}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={useBackup ? 'xxxxx-xxxxx' : '123 456'}
        />
      </label>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-inset ring-rose-200">
          {error}
        </p>
      )}
      <Button type="submit" className="mt-5 w-full" size="lg" disabled={busy || !ready}>
        {busy ? t('common.loading') : t('auth.mfaSubmit')}
      </Button>
      <div className="mt-4 flex items-center justify-between text-xs">
        <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 font-medium text-navy-500 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> {t('auth.mfaBack')}
        </button>
        <button
          type="button"
          className="font-medium text-sky-600 hover:underline"
          onClick={() => {
            setUseBackup((v) => !v)
            setCode('')
            setError(null)
          }}
        >
          {useBackup ? t('auth.mfaUseApp') : t('auth.mfaUseBackup')}
        </button>
      </div>
    </form>
  )
}
