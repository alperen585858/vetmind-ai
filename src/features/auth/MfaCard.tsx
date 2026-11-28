import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Copy, Download, ShieldCheck, ShieldOff } from 'lucide-react'
import { Button } from '../../shared/ui/Button'
import { Card, CardHeader } from '../../shared/ui/Card'
import { useApp } from '../../shared/shell/AppContext'
import { useLocale } from '../../shared/shell/LocaleContext'
import { setBackendTokens } from '../../shared/auth/session'
import { userErrorMessage } from '../../shared/lib/apiErrors'
import {
  disableMfa,
  enableMfa,
  getMfaStatus,
  regenerateMfaBackupCodes,
  startMfaSetup,
  type BackendMfaStatus,
} from '../../shared/api'

type View =
  | { kind: 'idle' }
  | { kind: 'setup'; secret: string; uri: string; qr: string | null }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'disable' }
  | { kind: 'regenerate' }

/** Groups a base32 secret for typing by hand: ABCD EFGH … */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim()
}

/**
 * Issue #107 — Settings: turn two-step sign-in on/off, see and renew backup codes.
 * Demo accounts get an explanation instead (they always sign in with the password only).
 */
export function MfaCard() {
  const { t } = useLocale()
  const { authMode, pushToast } = useApp()
  const [params] = useSearchParams()
  const ref = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<BackendMfaStatus | null>(null)
  const [view, setView] = useState<View>({ kind: 'idle' })
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => getMfaStatus().then(setStatus).catch(() => setStatus(null))

  useEffect(() => {
    if (authMode.authEnabled) void load()
  }, [authMode.authEnabled])

  useEffect(() => {
    // Sent here after sign-in when the role requires 2FA.
    if (params.get('mfa') === 'kurulum') ref.current?.scrollIntoView({ block: 'start' })
  }, [params, status])

  const reset = () => {
    setCode('')
    setPassword('')
    setError(null)
  }

  const run = async (action: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(userErrorMessage(err, t))
    } finally {
      setBusy(false)
    }
  }

  const beginSetup = () =>
    run(async () => {
      const res = await startMfaSetup()
      let qr: string | null
      try {
        const QR = await import('qrcode')
        qr = await QR.toDataURL(res.otpauth_uri, { margin: 1, width: 192 })
      } catch {
        qr = null // the manual key still works
      }
      reset()
      setView({ kind: 'setup', secret: res.secret, uri: res.otpauth_uri, qr })
    })

  const confirmSetup = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const res = await enableMfa(code)
      setBackendTokens(res.session) // other sessions ended; this one continues
      reset()
      setSaved(false)
      setView({ kind: 'codes', codes: res.backup_codes })
      pushToast({ tone: 'success', title: t('settings.mfaEnabledToast') })
      void load()
    })
  }

  const confirmDisable = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      setBackendTokens(await disableMfa(password, code))
      reset()
      setView({ kind: 'idle' })
      pushToast({ tone: 'success', title: t('settings.mfaDisabledToast') })
      void load()
    })
  }

  const confirmRegenerate = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const res = await regenerateMfaBackupCodes(password, code)
      reset()
      setSaved(false)
      setView({ kind: 'codes', codes: res.backup_codes })
      void load()
    })
  }

  const copyCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      pushToast({ tone: 'success', title: t('settings.mfaCodesCopied') })
    } catch {
      /* clipboard blocked: the codes are on screen */
    }
  }

  const downloadCodes = (codes: string[]) => {
    const blob = new Blob([`VetMind — ${t('settings.mfaBackupTitle')}\n\n${codes.join('\n')}\n`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'vetmind-yedek-kodlar.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const codeInput = (
    <label className="label">
      {t('settings.mfaCodeLabel')}
      <input
        className="input mt-1 font-mono tracking-widest"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={9}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="123 456"
        required
      />
    </label>
  )
  const passwordInput = (
    <label className="label">
      {t('settings.currentPassword')}
      <input
        className="input mt-1"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
    </label>
  )
  const errorBox = error && (
    <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
      {error}
    </p>
  )

  return (
    <div ref={ref}>
      <Card className="p-5">
        <CardHeader title={t('settings.mfaTitle')} icon={<ShieldCheck className="h-5 w-5" />} />
        {!authMode.authEnabled ? (
          <p className="mt-2 text-sm text-slate-600">{t('settings.mfaUnavailable')}</p>
        ) : !status ? (
          <p className="mt-2 text-sm text-slate-500">{t('common.loading')}</p>
        ) : status.demo_account ? (
          <p className="mt-2 text-sm text-slate-600">{t('settings.mfaDemoAccount')}</p>
        ) : view.kind === 'codes' ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-slate-700">{t('settings.mfaBackupIntro')}</p>
            <ul className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 font-mono text-sm sm:grid-cols-5" aria-label={t('settings.mfaBackupTitle')}>
              {view.codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copyCodes(view.codes)}>
                {t('settings.mfaCopy')}
              </Button>
              <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadCodes(view.codes)}>
                {t('settings.mfaDownload')}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              {t('settings.mfaSavedCheck')}
            </label>
            <Button disabled={!saved} onClick={() => setView({ kind: 'idle' })}>
              {t('settings.mfaDone')}
            </Button>
          </div>
        ) : view.kind === 'setup' ? (
          <form onSubmit={confirmSetup} noValidate className="mt-2 space-y-3">
            <p className="text-sm text-slate-700">{t('settings.mfaScan')}</p>
            {view.qr ? (
              <img src={view.qr} alt={t('settings.mfaQrAlt')} width={192} height={192} className="rounded-lg border border-slate-200" />
            ) : null}
            <p className="text-xs text-slate-500">{t('settings.mfaManual')}</p>
            <p className="select-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm tracking-wider" data-testid="mfa-secret">
              {groupSecret(view.secret)}
            </p>
            {codeInput}
            {errorBox}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || code.replace(/\D/g, '').length !== 6}>
                {busy ? t('common.loading') : t('settings.mfaConfirm')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setView({ kind: 'idle' })}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        ) : view.kind === 'disable' || view.kind === 'regenerate' ? (
          <form onSubmit={view.kind === 'disable' ? confirmDisable : confirmRegenerate} noValidate className="mt-2 space-y-3">
            <p className="text-sm text-slate-700">
              {view.kind === 'disable' ? t('settings.mfaDisableHint') : t('settings.mfaRegenerateHint')}
            </p>
            {passwordInput}
            {codeInput}
            {errorBox}
            <div className="flex gap-2">
              <Button type="submit" variant={view.kind === 'disable' ? 'danger' : 'primary'} disabled={busy || !password || !code}>
                {busy ? t('common.loading') : view.kind === 'disable' ? t('settings.mfaDisable') : t('settings.mfaRegenerate')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setView({ kind: 'idle' })}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        ) : status.enabled ? (
          <div className="mt-2 space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-800" role="status">
              <ShieldCheck className="h-4 w-4" /> {t('settings.mfaOn', { n: status.backup_codes_left })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => { reset(); setView({ kind: 'regenerate' }) }}>
                {t('settings.mfaRegenerate')}
              </Button>
              {!status.required_for_role && (
                <Button size="sm" variant="ghost" icon={<ShieldOff className="h-3.5 w-3.5" />} onClick={() => { reset(); setView({ kind: 'disable' }) }}>
                  {t('settings.mfaDisable')}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            {status.required_for_role && (
              <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
                {t('settings.mfaRequired')}
              </p>
            )}
            <p className="text-sm text-slate-600">{t('settings.mfaOffHint')}</p>
            {errorBox}
            <Button disabled={busy} onClick={() => void beginSetup()}>
              {busy ? t('common.loading') : t('settings.mfaTurnOn')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
